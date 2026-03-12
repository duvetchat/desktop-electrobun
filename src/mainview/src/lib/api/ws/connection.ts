import {
	channelMessages,
	wsSessionToken,
	gatewaySpaces,
	currentUser,
} from "$lib/stores.svelte";
import { getWSHostURL } from "$lib/common/common";
import { get } from "svelte/store";
import { getSpaceMembers, type SpaceMemberWithUser } from "$lib/api/spaces";

import type {
	GatewayMessage as GatewayMessageCreate,
	GatewayUserStatusUpdate,
	GatewayMessageDelete,
	GatewayReadyData,
	GatewayEvent,
	GatewaySpace,
	GatewaySpaceCreatePayload,
	GatewayRoom,
	GatewayRole,
	GatewayMember,
	UserStatus,
} from "$lib/types";

import { gatewayMessageToMessage } from "$lib/types";

export function getStreamURL(): string {
	return `${getWSHostURL()}/gateway?token=${localStorage.getItem("duvet_session_token") || "none"}`;
}

// Active socket — module-level so sendMessage can access it
let activeSocket: WebSocket | null = null;

// Último sequence number recibido, para resume al reconectar
let lastSeq = 0;

// Cache of live user statuses received via USER_STATUS_UPDATE.
// Keyed by user ID so we can apply the correct status when a user is
// added to a space AFTER their status event already fired.
const userStatusCache = new Map<string, number>();

type WebRTCEventListener = (type: string, data: unknown) => void;
const webrtcListeners: WebRTCEventListener[] = [];

export function onWebRTCEvent(cb: WebRTCEventListener) {
	webrtcListeners.push(cb);
	return () => {
		const idx = webrtcListeners.indexOf(cb);
		if (idx > -1) {
			webrtcListeners.splice(idx, 1);
		}
	};
}

export async function sendEventMessage(type: string, data: unknown) {
	if (activeSocket?.readyState === WebSocket.OPEN) {
		activeSocket.send(JSON.stringify({ type, data }));
	} else {
		console.warn("[WS] Cannot send message, socket not open:", type);
	}
}

function addMembersToSpace(spaceId: string, rows: SpaceMemberWithUser[]) {
	gatewaySpaces.update((spaces) =>
		spaces.map((s) => {
			if (s.id !== spaceId) return s;
			const existingUserIds = new Set(s.users.map((u) => u.id));
			const incomingUserIds = new Set(rows.map((r) => r.users.id));
			// Replace any placeholder members for the same users with real data
			const filteredMembers = s.members.filter(
				(m) => !incomingUserIds.has(m.user_id),
			);
			const newUsers = rows
				.map((r) => {
					// Apply cached live status so users don't appear offline
					// when the REST snapshot still has status_id=0.
					const liveStatus = userStatusCache.get(r.users.id);
					return liveStatus !== undefined
						? { ...r.users, status_id: liveStatus as UserStatus }
						: r.users;
				})
				.filter((u) => !existingUserIds.has(u.id));
			const newMembers = rows.map(
				({ users: _u, max_pos: _p, ...m }) => m as GatewayMember,
			);
			return {
				...s,
				users: [...s.users, ...newUsers],
				members: [...filteredMembers, ...newMembers],
			};
		}),
	);
}

function handleEvent(event: GatewayEvent) {
	if (event.s) {
		lastSeq = event.s;
	}
	if (!event.d) {
		console.warn("[SSE] Received event with no data:", event);
		return;
	}
	console.log("[SSE] Received event:", event);
	const { type, data } = event.d;
	switch (type) {
		case "READY": {
			const { user, sessionToken } = data as GatewayReadyData;
			// The connected user is always online by definition.
			// Override whatever the DB stored so every downstream consumer
			// (SPACE_CREATE's currentUserData, the sidebar, etc.) sees status=1.
			const onlineUser = { ...user, status_id: 1 as UserStatus };
			currentUser.set(onlineUser);
			wsSessionToken.set(sessionToken);
			userStatusCache.set(user.id, 1);
			break;
		}
		case "SPACE_CREATE": {
			const payload = data as GatewaySpaceCreatePayload;
			const currentUserData = get(currentUser);
			const selfMember: import("$lib/types").GatewayMember | undefined =
				currentUserData
					? {
						id: currentUserData.id,
						space_id: payload.space.id,
						user_id: currentUserData.id,
						alias: null,
						created_at: payload.space.created_at,
						updated_at: payload.space.updated_at,
						deleted_at: null,
					}
					: undefined;
			const space: GatewaySpace = {
				...payload.space,
				rooms: Object.values(payload.rooms),
				roles: Object.values(payload.roles_permissions),
				member_roles: payload.member_roles,
				room_overwrites: payload.overwrites
					? Object.values(payload.overwrites).flat()
					: [],
				member: selfMember,
				members: selfMember ? [selfMember] : [],
				users: currentUserData ? [currentUserData] : [],
				voice_states: [],
			};
			gatewaySpaces.update((spaces) => {
				const exists = spaces.some((s) => s.id === space.id);
				if (exists) {
					return spaces;
				}
				return [...spaces, space];
			});
			// Fetch the real member list so the sidebar shows the creator immediately
			getSpaceMembers(payload.space.id)
				.then((rows) => addMembersToSpace(payload.space.id, rows))
				.catch((err) =>
					console.error("[WS] Failed to load members for new space:", err),
				);
			break;
		}
		case "SPACE_DELETE": {
			const { id } = data as { id: string };
			gatewaySpaces.update((spaces) => spaces.filter((s) => s.id !== id));
			break;
		}
		case "SPACE_UPDATE": {
			const updated = data as GatewaySpace;
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id !== updated.id) {
						return s;
					}
					return updated;
				}),
			);
			break;
		}
		case "ROOM_CREATE": {
			const room = data as GatewayRoom;
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id === room.space_id) {
						const exists = s.rooms.some((r) => r.id === room.id);
						if (!exists) {
							return {
								...s,
								rooms: [...s.rooms, room],
							};
						}
					}
					return s;
				}),
			);
			break;
		}
		case "MESSAGE_CREATE": {
			const raw = data as GatewayMessageCreate;
			const spaces = get(gatewaySpaces);
			const message = gatewayMessageToMessage(raw, spaces);
			channelMessages.update((all) => {
				const existing = all[raw.room_id] ?? [];

				// If it matches a pending message by nonce, replace it
				if (message.nonce) {
					const pendingIndex = existing.findIndex(
						(m) => m.nonce === message.nonce,
					);
					if (pendingIndex !== -1) {
						const newMessages = [...existing];
						newMessages[pendingIndex] = message;
						return {
							...all,
							[raw.room_id]: newMessages,
						};
					}
				}

				// Prevent duplicates (e.g., from hot-reloads or double socket connections)
				if (existing.some((m) => m.id === message.id)) {
					return all;
				}
				return {
					...all,
					[raw.room_id]: [...existing, message],
				};
			});
			break;
		}
		case "MESSAGE_UPDATE": {
			const raw = data as GatewayMessageCreate;
			const spaces = get(gatewaySpaces);
			const updatedMessage = gatewayMessageToMessage(raw, spaces);
			channelMessages.update((all) => {
				const existing = all[raw.room_id] ?? [];
				return {
					...all,
					[raw.room_id]: existing.map((m) =>
						m.id === updatedMessage.id ? updatedMessage : m,
					),
				};
			});
			break;
		}
		case "MESSAGE_DELETE": {
			const raw = data as GatewayMessageDelete;
			channelMessages.update((all) => {
				const existing = all[raw.room_id] ?? [];
				return {
					...all,
					[raw.room_id]: existing.filter((m) => m.id !== raw.id),
				};
			});
			break;
		}
		case "USER_STATUS_UPDATE": {
			console.log("[SSE] Received status update:", data);
			const raw = data as GatewayUserStatusUpdate;
			// Always persist the latest live status so it can be applied
			// to users who are added to the store later.
			userStatusCache.set(raw.user_id, raw.status_id);
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => ({
					...s,
					users: s.users.map((u) => {
						if (u.id === raw.user_id) {
							return {
								...u,
								status_id: raw.status_id,
							};
						}
						return u;
					}),
				})),
			);
			break;
		}
		case "VOICE_STATE_UPDATE": {
			const raw = data as {
				room_id: string;
				user_id: string;
				joined: boolean;
				muted?: boolean;
				deafened?: boolean;
			};
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					const isRoomInSpace = s.rooms.some((r) => r.id === raw.room_id);
					if (!isRoomInSpace) {
						return s;
					}

					const currentStates = s.voice_states ?? [];
					let nextStates = [...currentStates];

					if (raw.joined) {
						const existingIdx = nextStates.findIndex(
							(vs) => vs.user_id === raw.user_id && vs.room_id === raw.room_id,
						);
						if (existingIdx === -1) {
							nextStates.push({
								room_id: raw.room_id,
								user_id: raw.user_id,
								muted: raw.muted,
								deafened: raw.deafened,
							});
						} else {
							nextStates[existingIdx] = {
								...nextStates[existingIdx],
								muted: raw.muted,
								deafened: raw.deafened,
							};
						}
					} else {
						nextStates = nextStates.filter(
							(vs) =>
								!(vs.user_id === raw.user_id && vs.room_id === raw.room_id),
						);
					}

					return {
						...s,
						voice_states: nextStates,
					};
				}),
			);
			webrtcListeners.forEach((cb) => {
				cb(type, data);
			});

			break;
		}
		case "VOICE_JOINED":
		case "WEBRTC_ICE_CANDIDATE":
		case "WEBRTC_RENEGOTIATE":
		case "WEBRTC_RENEGOTIATE_ANSWER":
			webrtcListeners.forEach((cb) => {
				cb(type, data);
			});
			break;
		case "ROLE_CREATE": {
			const role = data as GatewayRole;
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id !== role.space_id) {
						return s;
					}
					const exists = s.roles.some((r) => r.id === role.id);
					if (exists) {
						return s;
					}
					return {
						...s,
						roles: [...s.roles, role],
					};
				}),
			);
			break;
		}
		case "ROLE_UPDATE": {
			const role = data as GatewayRole;
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id !== role.space_id) {
						return s;
					}
					return {
						...s,
						roles: s.roles.map((r) => (r.id === role.id ? role : r)),
					};
				}),
			);
			break;
		}
		case "ROLE_DELETE": {
			const role = data as {
				id: string;
				space_id: string;
			};
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id !== role.space_id) {
						return s;
					}
					return {
						...s,
						roles: s.roles.filter((r) => r.id !== role.id),
					};
				}),
			);
			break;
		}
		case "MEMBER_ROLE_ADD": {
			const raw = data as {
				member_id: string;
				role_id: string;
			};
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					const member = s.members.find((m) => m.id === raw.member_id);
					if (!member) {
						return s;
					}
					const userId = member.user_id;
					const current = s.member_roles[userId] ?? [];
					if (current.includes(raw.role_id)) {
						return s;
					}
					return {
						...s,
						member_roles: {
							...s.member_roles,
							[userId]: [...current, raw.role_id],
						},
					};
				}),
			);
			break;
		}
		case "MEMBER_ROLE_REMOVE": {
			const raw = data as {
				member_id: string;
				role_id: string;
			};
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					const member = s.members.find((m) => m.id === raw.member_id);
					if (!member) {
						return s;
					}
					const userId = member.user_id;
					const current = s.member_roles[userId] ?? [];
					return {
						...s,
						member_roles: {
							...s.member_roles,
							[userId]: current.filter((id) => id !== raw.role_id),
						},
					};
				}),
			);
			break;
		}
		case "SPACE_MEMBER_ADD": {
			const raw = data as { member_id: string; space_id: string };
			// Refresh the member list so the newly joined user appears.
			// The new member is definitely online (they just connected and joined),
			// so force status=1 on their row to avoid the DB snapshot returning 0.
			getSpaceMembers(raw.space_id)
				.then((rows) => {
					const patched = rows.map((r) =>
						r.id === raw.member_id
							? { ...r, users: { ...r.users, status_id: 1 as UserStatus } }
							: r,
					);
					addMembersToSpace(raw.space_id, patched);
				})
				.catch((err) =>
					console.error("[WS] Failed to refresh members after join:", err),
				);
			break;
		}
		case "SPACE_MEMBER_REMOVE": {
			const raw = data as { member_id: string; space_id: string };
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id !== raw.space_id) return s;
					const removedMember = s.members.find((m) => m.id === raw.member_id);
					return {
						...s,
						members: s.members.filter((m) => m.id !== raw.member_id),
						users: removedMember
							? s.users.filter((u) => u.id !== removedMember.user_id)
							: s.users,
					};
				}),
			);
			break;
		}
		case "ROOM_DELETE": {
			const raw = data as {
				id: string;
				space_id: string;
			};
			gatewaySpaces.update((spaces) =>
				spaces?.map((s) => {
					if (s.id !== raw.space_id) {
						return s;
					}
					return {
						...s,
						rooms: s.rooms.filter((r) => r.id !== raw.id),
					};
				}),
			);
			break;
		}
		case "ROOM_UPDATE": {
			const room = data as GatewayRoom;
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id !== room.space_id) return s;
					return {
						...s,
						rooms: s.rooms.map((r) => (r.id === room.id ? room : r)),
					};
				}),
			);
			break;
		}
		case "ROOM_OVERWRITE_UPDATE": {
			const ow = data as import("$lib/types").GatewayRoomOverwrite;
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					const hasRoom = s.rooms.some((r) => r.id === ow.room_id);
					if (!hasRoom) return s;
					const existing = s.room_overwrites.findIndex(
						(o) => o.room_id === ow.room_id && o.target_id === ow.target_id,
					);
					const updated =
						existing >= 0
							? s.room_overwrites.map((o, i) => (i === existing ? ow : o))
							: [...s.room_overwrites, ow];
					return { ...s, room_overwrites: updated };
				}),
			);
			break;
		}
		case "ROOM_OVERWRITE_DELETE": {
			const raw = data as { room_id: string; target_id: string };
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					const hasRoom = s.rooms.some((r) => r.id === raw.room_id);
					if (!hasRoom) return s;
					return {
						...s,
						room_overwrites: s.room_overwrites.filter(
							(o) => !(o.room_id === raw.room_id && o.target_id === raw.target_id),
						),
					};
				}),
			);
			break;
		}
		case "GUILD_MEMBER_ADD": {
			const raw = data as {
				space_id: string;
				user_id: string;
				member_id: string;
				user?: import("$lib/types").GatewayUser;
			};
			// The joining user already receives SPACE_CREATE; this event
			// updates the members list for everyone else already in the space.
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id !== raw.space_id) return s;
					const alreadyHasMember = s.members.some(
						(m) => m.id === raw.member_id,
					);
					if (alreadyHasMember) return s;
					const newMember: import("$lib/types").GatewayMember = {
						id: raw.member_id,
						space_id: raw.space_id,
						user_id: raw.user_id,
						alias: null,
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
						deleted_at: null,
					};
					const alreadyHasUser = s.users.some((u) => u.id === raw.user_id);
					return {
						...s,
						members: [...s.members, newMember],
						users:
							raw.user && !alreadyHasUser ? [...s.users, raw.user] : s.users,
					};
				}),
			);
			break;
		}
		case "GUILD_MEMBER_REMOVE": {
			const raw = data as {
				space_id: string;
				user_id: string;
				member_id: string;
			};
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id !== raw.space_id) return s;
					return {
						...s,
						members: s.members.filter((m) => m.id !== raw.member_id),
						users: s.users.filter((u) => u.id !== raw.user_id),
						member_roles: Object.fromEntries(
							Object.entries(s.member_roles).filter(
								([uid]) => uid !== raw.user_id,
							),
						),
					};
				}),
			);
			break;
		}
		default:
			console.log("[SSE] Unhandled event:", event);
	}
}

export interface GatewayConnection {
	/** Permanently close the connection and stop reconnecting. */
	destroy(): void;
}

const HEARTBEAT_INTERVAL_MS = 45_000;

export function createWebSocketConnection(): GatewayConnection {
	let destroyed = false;
	let currentSocket: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

	function startHeartbeat(socket: WebSocket) {
		heartbeatTimer = setInterval(() => {
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ type: "heartbeat", data: {} }));
			}
		}, HEARTBEAT_INTERVAL_MS);
	}

	function stopHeartbeat() {
		if (heartbeatTimer !== null) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
	}

	function connect() {
		if (destroyed) {
			return;
		}

		const socket = new WebSocket(getStreamURL());
		currentSocket = socket;
		activeSocket = socket;

		socket.onopen = () => {
			console.log("[WS] Connected");
			const identifyData: Record<string, unknown> = {
				token: localStorage.getItem("duvet_session_token") || "",
			};
			if (lastSeq > 0) {
				identifyData.last_seq = lastSeq;
			}
			socket.send(JSON.stringify({ type: "identify", data: identifyData }));
			startHeartbeat(socket);
		};

		socket.onmessage = (rawEvent) => {
			try {
				const msg = JSON.parse(rawEvent.data as string);
				if (msg.event === "heartbeat_ack") {
					// Heartbeat acknowledged by server
					return;
				}
				if (msg.event === "payload") {
					console.log("[WS] Payload:", msg);
					handleEvent(msg as GatewayEvent);
				}
			} catch (err) {
				console.error("[WS] Failed to parse message:", err);
			}
		};

		socket.onerror = (err) => {
			console.error("[WS] Error:", err);
		};

		socket.onclose = () => {
			console.log("[WS] Disconnected");
			stopHeartbeat();
			currentSocket = null;
			activeSocket = null;
			if (!destroyed) {
				reconnectTimer = setTimeout(connect, 3000);
			}
		};
	}

	connect();

	return {
		destroy() {
			destroyed = true;
			stopHeartbeat();
			if (reconnectTimer !== null) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			currentSocket?.close();
			currentSocket = null;
			activeSocket = null;
		},
	};
}
