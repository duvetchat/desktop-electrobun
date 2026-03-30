import {
	channelMessages,
	wsSessionToken,
	gatewaySpaces,
	currentUser,
	pendingFriendRequests,
	sentFriendRequests,
	friends,
	friendsReady,
	conversations,
	dmMessages,
	typingUsers,
	activeVoiceRoomId,
	unreadChannels,
	activeTextRoomId,
	lastReadRooms,
	lastMsgRooms,
	unreadConversations,
	activeDMConvId,
	pageVisible,
	mentionCounts,
	activeCall,
	callVoiceStates,
	conversationsWithCalls,
	spaceEmojis,
	spaceStickers,
} from "$lib/stores.svelte";
import { getFriends, getPendingRequests, getSentRequests } from "$lib/api/friends";
import { getConversations } from "$lib/api/conversations";
import { getMentionCounts } from "$lib/api/messages";
import { getWSHostURL, route } from "$lib/common/common";
import { get } from "svelte/store";
import { getSpaceMembers, type SpaceMemberWithUser } from "$lib/api/spaces";

import type { GatewayEvent, GatewaySpace, GatewayMember, UserStatus } from "$lib/types";

import { gatewayMessageToMessage } from "$lib/types";

export function getStreamURL(): string {
	return `${getWSHostURL()}/gateway?token=${localStorage.getItem("duvet_session_token")}`;
}

import { audioStore } from "$lib/stores/audio.svelte";

// Active socket — module-level so sendMessage can access it
let activeSocket: WebSocket | null = null;

// Último sequence number recibido, para resume al reconectar
let lastSeq = 0;

// Cache of live user statuses received via USER_STATUS_UPDATE.
// Keyed by user ID so we can apply the correct status when a user is
// added to a space AFTER their status event already fired.
const userStatusCache = new Map<string, UserStatus>();

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
			const incomingUserIds = new Set(rows.map((r) => r.user.id));
			// Replace any placeholder members for the same users with real data
			const filteredMembers = s.members.filter((m) => !incomingUserIds.has(m.user_id));
			const newUsers = rows
				.map((r) => {
					// Apply cached live status so users don't appear offline
					// when the REST snapshot still has status_id=0.
					const liveStatus = userStatusCache.get(r.user.id);
					return liveStatus !== undefined ? { ...r.user, status_id: liveStatus } : r.user;
				})
				.filter((u) => !existingUserIds.has(u.id));
			const newMembers = rows.map(({ user: _u, max_pos: _p, ...m }) => m as GatewayMember);
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
		console.warn("[WS] Received event with no data:", event);
		return;
	}
	console.log("[WS] Received event:", event);
	const payload = event.d;
	switch (payload.type) {
		case "READY": {
			const { user, sessionToken, unread_rooms } = payload.data;
			// The connected user is always online by definition.
			// Override whatever the DB stored so every downstream consumer
			// (SPACE_CREATE's currentUserData, the sidebar, etc.) sees status=1.
			const onlineUser = { ...user, status_id: 1 as UserStatus };
			currentUser.set(onlineUser);
			wsSessionToken.set(sessionToken);
			userStatusCache.set(user.id, 1);
			unreadChannels.set(new Set(unread_rooms ?? []));
			lastReadRooms.set(payload.data.last_read_rooms ?? {});
			lastMsgRooms.set(payload.data.last_msg_rooms ?? {});
			const { unread_convs } = payload.data;
			unreadConversations.set(new Set(unread_convs ?? []));
			// Fetch friends, pending/sent requests, and conversations eagerly
			// so they are available before FriendsView mounts.
			Promise.all([getPendingRequests(), getSentRequests(), getFriends(), getConversations()])
				.then(([pending, sent, friendList, convList]) => {
					pendingFriendRequests.set(pending);
					sentFriendRequests.set(sent);
					friends.set(friendList);
					conversations.set(convList);
					friendsReady.set(true);
				})
				.catch((err) => {
					console.error("[WS] Failed to load friends/conversations on READY:", err);
					friendsReady.set(true); // show the app even on error
				});
			getMentionCounts()
				.then((counts) => mentionCounts.set(counts))
				.catch(() => {});
			// Restore active calls
			const readyData = payload.data;
			const activeCalls = readyData.active_calls ?? [];
			if (activeCalls.length > 0) {
				const callSet = new Set<string>();
				for (const call of activeCalls) {
					callSet.add(call.conversation_id);
					// Populate voice states for this call
					if (call.voice_states) {
						callVoiceStates.update((states) => {
							const filtered = states.filter((s) => s.room_id !== call.conversation_id);
							for (const vs of call.voice_states!) {
								filtered.push({
									room_id: call.conversation_id,
									user_id: vs.user_id,
									muted: vs.muted,
									deafened: vs.deafened,
									screen_sharing: vs.screen_sharing,
								});
							}
							return filtered;
						});
					}
				}
				conversationsWithCalls.set(callSet);
			} else {
				conversationsWithCalls.set(new Set());
				callVoiceStates.set([]);
			}

			// Reset spaces so SPACE_CREATE events that follow repopulate them
			// with fresh data (including current voice_states). Without this,
			// if the server rejects a resume and starts a new session, the
			// exists-guard in SPACE_CREATE would skip updates and voice states
			// from before the reconnect would never be shown.
			gatewaySpaces.set([]);
			friendsReady.set(false);
			break;
		}
		case "SPACE_CREATE": {
			const spaceCreateData = payload.data;
			const currentUserData = get(currentUser);
			const selfMember: import("$lib/types").GatewayMember | undefined = currentUserData
				? {
						id: currentUserData.id,
						space_id: spaceCreateData.space.id,
						user_id: currentUserData.id,
						alias: null,
						created_at: spaceCreateData.space.created_at,
						updated_at: spaceCreateData.space.updated_at,
						deleted_at: null,
					}
				: undefined;
			const space: GatewaySpace = {
				...spaceCreateData.space,
				rooms: Object.values(spaceCreateData.rooms),
				roles: Object.values(spaceCreateData.roles_permissions),
				member_roles: spaceCreateData.member_roles,
				room_overwrites: spaceCreateData.overwrites ? Object.values(spaceCreateData.overwrites).flat() : [],
				member: selfMember,
				members: selfMember ? [selfMember] : [],
				users: currentUserData ? [currentUserData] : [],
				voice_states: spaceCreateData.voice_states ?? [],
			};
			gatewaySpaces.update((spaces) => {
				const exists = spaces.some((s) => s.id === space.id);
				if (exists) {
					return spaces;
				}
				return [...spaces, space];
			});
			break;
		}
		case "SPACE_DELETE": {
			const { id } = payload.data;
			gatewaySpaces.update((spaces) => spaces.filter((s) => s.id !== id));
			break;
		}
		case "SPACE_UPDATE": {
			const updated = payload.data;
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
			const room = payload.data;
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
			const raw = payload.data;
			const spaces = get(gatewaySpaces);
			const message = gatewayMessageToMessage(raw, spaces);
			if (raw.room_id && raw.room_id !== get(activeTextRoomId)) {
				unreadChannels.update((s) => {
					s.add(raw.room_id);
					return s;
				});
			}
			typingUsers.update((all) => {
				const key = raw.room_id;
				if (!all[key]) return all;
				return { ...all, [key]: all[key].filter((u) => u.user_id !== raw.author_id) };
			});
			channelMessages.update((all) => {
				const existing = all[raw.room_id] ?? [];

				// If it matches a pending message by nonce, replace it
				if (message.nonce) {
					const pendingIndex = existing.findIndex((m) => m.nonce === message.nonce);
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
			const raw = payload.data;
			const spaces = get(gatewaySpaces);
			const updatedMessage = gatewayMessageToMessage(raw, spaces);
			channelMessages.update((all) => {
				const result: typeof all = {};
				for (const [roomId, msgs] of Object.entries(all)) {
					result[roomId] = msgs.map((m) => {
						if (m.id === updatedMessage.id)
							return {
								...updatedMessage,
								referenced_message: updatedMessage.referenced_message ?? m.referenced_message,
							};
						if (m.referenced_message?.message_id === updatedMessage.id) {
							return {
								...m,
								referenced_message: { ...m.referenced_message, content: updatedMessage.content },
							};
						}
						return m;
					});
				}
				return result;
			});
			break;
		}
		case "MESSAGE_DELETE": {
			const raw = payload.data;
			channelMessages.update((all) => {
				const existing = all[raw.room_id] ?? [];
				return {
					...all,
					[raw.room_id]: existing.filter((m) => m.id !== raw.id),
				};
			});
			break;
		}
		case "MENTION_CREATE": {
			const { room_id, conversation_id } = payload.data;
			const key = room_id ?? conversation_id;
			if (key) {
				mentionCounts.update((all) => ({ ...all, [key]: (all[key] ?? 0) + 1 }));
				const isActive = key === get(activeTextRoomId) || key === get(activeDMConvId);
				if (!isActive || !get(pageVisible)) {
					audioStore.play("notification");
				}
			}
			break;
		}
		case "USER_UPDATE": {
			const raw = payload.data;
			currentUser.update((u) =>
				u?.id === raw.id
					? {
							...u,
							username: raw.username,
							alias: raw.alias,
							avatar: raw.avatar,
							banner: raw.banner,
						}
					: u,
			);
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => ({
					...s,
					users: s.users.map((u) =>
						u.id === raw.id
							? {
									...u,
									username: raw.username,
									alias: raw.alias,
									avatar: raw.avatar,
									banner: raw.banner,
								}
							: u,
					),
				})),
			);
			const newName = raw.alias ?? raw.username;
			const newAvatar = raw.avatar ?? null;
			channelMessages.update((rooms) => {
				const result: typeof rooms = {};
				for (const [roomId, msgs] of Object.entries(rooms)) {
					result[roomId] = msgs.map((m) =>
						m.author_id === raw.id ? { ...m, author_name: newName, author_avatar_url: newAvatar } : m,
					);
				}
				return result;
			});
			dmMessages.update((convs) => {
				const result: typeof convs = {};
				for (const [convId, msgs] of Object.entries(convs)) {
					result[convId] = msgs.map((m) => {
						if (m.author_id !== raw.id || !m.user) return m;
						return {
							...m,
							user: {
								...m.user,
								username: raw.username,
								alias: raw.alias,
								avatar: raw.avatar,
								banner: raw.banner,
							},
						};
					});
				}
				return result;
			});
			conversations.update((list) =>
				list.map((c) => ({
					...c,
					members: c.members.map((m) =>
						m.user_id === raw.id
							? {
									...m,
									user: {
										...m.user,
										username: raw.username,
										alias: raw.alias,
										avatar: raw.avatar,
										banner: raw.banner,
									},
								}
							: m,
					),
				})),
			);
			break;
		}
		case "USER_STATUS_UPDATE": {
			console.log("[WS] Received status update:", payload.data);
			const raw = payload.data;
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
			conversations.update((convs) =>
				convs.map((c) => ({
					...c,
					members: c.members.map((m) => {
						if (m.user_id === raw.user_id) {
							return { ...m, user: { ...m.user, status_id: raw.status_id } };
						}
						return m;
					}),
				})),
			);
			break;
		}
		case "VOICE_STATE_UPDATE": {
			const raw = payload.data;

			// Update call voice states for conversation calls
			const currentCall = get(activeCall);
			if (currentCall && raw.room_id === currentCall.conversationId) {
				callVoiceStates.update((states) => {
					if (raw.joined) {
						const idx = states.findIndex((s) => s.user_id === raw.user_id && s.room_id === raw.room_id);
						if (idx === -1) {
							// New user joined the call
							if (raw.user_id !== get(currentUser)?.id) {
								audioStore.play("join_vc");
							}
							return [
								...states,
								{
									room_id: raw.room_id,
									user_id: raw.user_id,
									muted: raw.muted,
									deafened: raw.deafened,
									screen_sharing: raw.screen_sharing,
								},
							];
						}
						const copy = [...states];
						copy[idx] = {
							...copy[idx],
							muted: raw.muted,
							deafened: raw.deafened,
							screen_sharing: raw.screen_sharing,
						};
						return copy;
					}
					// User left the call
					if (raw.user_id !== get(currentUser)?.id) {
						audioStore.play("leave_vc");
					}
					return states.filter((s) => !(s.user_id === raw.user_id && s.room_id === raw.room_id));
				});
			}

			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					const isRoomInSpace = s.rooms.some((r) => r.id === raw.room_id);
					if (!isRoomInSpace) {
						return s;
					}

					const currentStates = s.voice_states ?? [];
					let nextStates = [...currentStates];

					if (raw.joined) {
						const existingIdx = nextStates.findIndex((vs) => vs.user_id === raw.user_id && vs.room_id === raw.room_id);
						if (existingIdx === -1) {
							if (raw.room_id === get(activeVoiceRoomId)) {
								audioStore.play("join_vc");
							}
							nextStates.push({
								room_id: raw.room_id,
								user_id: raw.user_id,
								muted: raw.muted,
								deafened: raw.deafened,
								screen_sharing: raw.screen_sharing,
							});
						} else {
							nextStates[existingIdx] = {
								...nextStates[existingIdx],
								muted: raw.muted,
								deafened: raw.deafened,
								screen_sharing: raw.screen_sharing,
							};
						}
					} else {
						if (raw.room_id === get(activeVoiceRoomId)) {
							audioStore.play("leave_vc");
						}
						nextStates = nextStates.filter((vs) => !(vs.user_id === raw.user_id && vs.room_id === raw.room_id));
					}

					return {
						...s,
						voice_states: nextStates,
					};
				}),
			);
			webrtcListeners.forEach((cb) => {
				cb(payload.type, payload.data);
			});

			break;
		}
		case "VOICE_JOINED":
		case "WEBRTC_ICE_CANDIDATE":
		case "WEBRTC_RENEGOTIATE":
		case "WEBRTC_RENEGOTIATE_ANSWER":
			webrtcListeners.forEach((cb) => {
				cb(payload.type, payload.data);
			});
			break;
		case "ROLE_CREATE": {
			const role = payload.data;
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
			const role = payload.data;
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
			const role = payload.data;
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
			const raw = payload.data;
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
			const raw = payload.data;
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
			const raw = payload.data;
			// Refresh the member list so the newly joined user appears.
			// The new member is definitely online (they just connected and joined),
			// so force status=1 on their row to avoid the DB snapshot returning 0.
			getSpaceMembers(raw.space_id)
				.then((rows) => {
					const patched = rows.map((r) =>
						r.id === raw.member_id ? { ...r, users: { ...r.user, status_id: 1 as UserStatus } } : r,
					);
					addMembersToSpace(raw.space_id, patched);
				})
				.catch((err) => console.error("[WS] Failed to refresh members after join:", err));
			break;
		}
		case "SPACE_MEMBER_REMOVE": {
			const raw = payload.data;
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id !== raw.space_id) return s;
					const removedMember = s.members.find((m) => m.id === raw.member_id);
					return {
						...s,
						members: s.members.filter((m) => m.id !== raw.member_id),
						users: removedMember ? s.users.filter((u) => u.id !== removedMember.user_id) : s.users,
					};
				}),
			);
			break;
		}
		case "ROOM_DELETE": {
			const raw = payload.data;
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
			const room = payload.data;
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
			const ow = payload.data;
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					const hasRoom = s.rooms.some((r) => r.id === ow.room_id);
					if (!hasRoom) return s;
					const existing = s.room_overwrites.findIndex((o) => o.room_id === ow.room_id && o.target_id === ow.target_id);
					const updated =
						existing >= 0 ? s.room_overwrites.map((o, i) => (i === existing ? ow : o)) : [...s.room_overwrites, ow];
					return { ...s, room_overwrites: updated };
				}),
			);
			break;
		}
		case "ROOM_OVERWRITE_DELETE": {
			const raw = payload.data;
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
		case "SPACE_EMOJI_CREATE": {
			const raw = payload.data;
			spaceEmojis.update((m) => {
				const list = m[raw.space_id] ?? [];
				return { ...m, [raw.space_id]: [...list, raw] };
			});
			break;
		}
		case "SPACE_EMOJI_UPDATE": {
			const raw = payload.data;
			spaceEmojis.update((m) => {
				const list = (m[raw.space_id] ?? []).map((e) => (e.id === raw.id ? raw : e));
				return { ...m, [raw.space_id]: list };
			});
			break;
		}
		case "SPACE_EMOJI_DELETE": {
			const raw = payload.data;
			spaceEmojis.update((m) => {
				const list = (m[raw.space_id] ?? []).filter((e) => e.id !== raw.id);
				return { ...m, [raw.space_id]: list };
			});
			break;
		}
		case "SPACE_STICKER_CREATE": {
			const raw = payload.data;
			spaceStickers.update((m) => {
				const list = m[raw.space_id] ?? [];
				return { ...m, [raw.space_id]: [...list, raw] };
			});
			break;
		}
		case "SPACE_STICKER_UPDATE": {
			const raw = payload.data;
			spaceStickers.update((m) => {
				const list = (m[raw.space_id] ?? []).map((s) => (s.id === raw.id ? raw : s));
				return { ...m, [raw.space_id]: list };
			});
			break;
		}
		case "SPACE_STICKER_DELETE": {
			const raw = payload.data;
			spaceStickers.update((m) => {
				const list = (m[raw.space_id] ?? []).filter((s) => s.id !== raw.id);
				return { ...m, [raw.space_id]: list };
			});
			break;
		}
		case "REACTION_ADD": {
			const raw = payload.data;
			channelMessages.update((all) => {
				const updated = { ...all };
				for (const [chId, msgs] of Object.entries(updated)) {
					const idx = msgs.findIndex((m) => m.id === raw.message_id);
					if (idx < 0) continue;
					const msg = { ...msgs[idx] };
					const reactions = [...(msg.reactions ?? [])];
					const existing = reactions.findIndex((r) => r.emoji_name === raw.emoji_name);
					if (existing >= 0) {
						const r = { ...reactions[existing] };
						if (!r.users.includes(raw.user_id)) {
							r.users = [...r.users, raw.user_id];
							r.count = r.users.length;
						}
						reactions[existing] = r;
					} else {
						reactions.push({
							emoji_name: raw.emoji_name,
							emoji_id: raw.emoji_id ?? null,
							count: 1,
							users: [raw.user_id],
						});
					}
					msg.reactions = reactions;
					updated[chId] = [...msgs.slice(0, idx), msg, ...msgs.slice(idx + 1)];
					break;
				}
				return updated;
			});
			break;
		}
		case "REACTION_REMOVE": {
			const raw = payload.data;
			channelMessages.update((all) => {
				const updated = { ...all };
				for (const [chId, msgs] of Object.entries(updated)) {
					const idx = msgs.findIndex((m) => m.id === raw.message_id);
					if (idx < 0) continue;
					const msg = { ...msgs[idx] };
					let reactions = [...(msg.reactions ?? [])];
					const existing = reactions.findIndex((r) => r.emoji_name === raw.emoji_name);
					if (existing >= 0) {
						const r = { ...reactions[existing] };
						r.users = r.users.filter((u) => u !== raw.user_id);
						r.count = r.users.length;
						if (r.count === 0) {
							reactions = reactions.filter((_, i) => i !== existing);
						} else {
							reactions[existing] = r;
						}
					}
					msg.reactions = reactions;
					updated[chId] = [...msgs.slice(0, idx), msg, ...msgs.slice(idx + 1)];
					break;
				}
				return updated;
			});
			break;
		}
		case "GUILD_MEMBER_ADD": {
			const raw = payload.data;
			// The joining user already receives SPACE_CREATE; this event
			// updates the members list for everyone else already in the space.
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id !== raw.space_id) return s;
					const alreadyHasMember = s.members.some((m) => m.id === raw.member_id);
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
						users: raw.user && !alreadyHasUser ? [...s.users, raw.user] : s.users,
					};
				}),
			);
			break;
		}
		case "GUILD_MEMBER_REMOVE": {
			const raw = payload.data;
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id !== raw.space_id) return s;
					return {
						...s,
						members: s.members.filter((m) => m.id !== raw.member_id),
						users: s.users.filter((u) => u.id !== raw.user_id),
						member_roles: Object.fromEntries(Object.entries(s.member_roles).filter(([uid]) => uid !== raw.user_id)),
					};
				}),
			);
			break;
		}
		case "FRIEND_REQUEST_CREATE": {
			const req = payload.data;
			pendingFriendRequests.update((reqs) => {
				if (reqs.some((r) => r.id === req.id)) return reqs;
				return [...reqs, req];
			});
			break;
		}
		case "FRIEND_REQUEST_ACCEPT": {
			const raw = payload.data;
			friends.update((list) => {
				if (list.some((f) => f.id === raw.id)) return list;
				return [...list, raw];
			});
			sentFriendRequests.update((reqs) => reqs.filter((r) => r.id !== raw.request_id));
			break;
		}
		case "FRIEND_REQUEST_REJECT": {
			const raw = payload.data;
			sentFriendRequests.update((reqs) => reqs.filter((r) => r.id !== raw.request_id));
			break;
		}
		case "FRIEND_REMOVE": {
			const raw = payload.data;
			friends.update((list) => list.filter((f) => f.sender_id !== raw.user_id && f.recipient_id !== raw.user_id));
			break;
		}
		case "CONVERSATION_CREATE": {
			const conv = payload.data;
			conversations.update((list) => {
				if (list.some((c) => c.id === conv.id)) return list;
				return [conv, ...list];
			});
			break;
		}
		case "CONVERSATION_UPDATE": {
			const raw = payload.data;
			conversations.update((list) => list.map((c) => (c.id === raw.id ? { ...c, name: raw.name } : c)));
			break;
		}
		case "CONVERSATION_DELETE": {
			const raw = payload.data;
			conversations.update((list) => list.filter((c) => c.id !== raw.id));
			break;
		}
		case "CONVERSATION_MEMBER_ADD": {
			const raw = payload.data;
			conversations.update((list) =>
				list.map((c) => {
					if (c.id !== raw.conversation_id) return c;
					const alreadyHas = c.members.some((m) => m.id === raw.member_id || m.user_id === raw.user_id);
					if (alreadyHas) return c;
					return {
						...c,
						members: [
							...c.members,
							{
								id: raw.member_id,
								conversation_id: raw.conversation_id,
								user_id: raw.user_id,
								created_at: new Date().toISOString(),
								updated_at: new Date().toISOString(),
								deleted_at: null,
								user: {
									id: raw.user_id,
									username: raw.username ?? "",
									alias: raw.alias ?? null,
									avatar: raw.avatar ?? null,
									banner: raw.banner ?? null,
									status_id: raw.status_id ?? 0,
								},
							},
						],
					};
				}),
			);
			break;
		}
		case "CONVERSATION_MEMBER_REMOVE": {
			const raw = payload.data;
			conversations.update((list) =>
				list.map((c) => {
					if (c.id !== raw.conversation_id) return c;
					return {
						...c,
						members: c.members.filter((m) => m.user_id !== raw.user_id),
					};
				}),
			);
			break;
		}
		case "DM_MESSAGE_CREATE": {
			const msg = payload.data;
			if (!msg.conversation_id) {
				return;
			}
			const conversationId = msg.conversation_id;
			const isActiveConv = conversationId === get(activeDMConvId);
			if (!isActiveConv) {
				unreadConversations.update((s) => {
					s.add(conversationId);
					return s;
				});
			}
			typingUsers.update((all) => {
				if (!all[conversationId]) return all;
				return {
					...all,
					[conversationId]: all[conversationId].filter((u) => u.user_id !== msg.author_id),
				};
			});
			dmMessages.update((all) => {
				const existing = all[conversationId] ?? [];
				if (msg.nonce) {
					const pendingIdx = existing.findIndex((m) => m.nonce === msg.nonce);
					if (pendingIdx !== -1) {
						const updated = [...existing];
						updated[pendingIdx] = msg;
						return { ...all, [conversationId]: updated };
					}
				}
				if (existing.some((m) => m.id === msg.id)) return all;
				return { ...all, [conversationId]: [...existing, msg] };
			});
			// Move conversation to top
			conversations.update((list) =>
				list
					.map((c) => ({ ...c, updated_at: msg.created_at }))
					.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
			);
			break;
		}
		case "DM_MESSAGE_UPDATE": {
			const msg = payload.data;
			if (!msg.conversation_id) {
				return;
			}
			const conversationId = msg.conversation_id;
			dmMessages.update((all) => {
				const existing = all[conversationId] ?? [];
				return {
					...all,
					[conversationId]: existing.map((m) => (m.id === msg.id ? msg : m)),
				};
			});
			break;
		}
		case "DM_MESSAGE_DELETE": {
			const raw = payload.data;
			dmMessages.update((all) => {
				const existing = all[raw.conversation_id] ?? [];
				return {
					...all,
					[raw.conversation_id]: existing.filter((m) => m.id !== raw.id),
				};
			});
			break;
		}
		case "DM_REACTION_ADD": {
			const raw = payload.data;
			dmMessages.update((all) => {
				const updated = { ...all };
				for (const [convId, msgs] of Object.entries(updated)) {
					const idx = msgs.findIndex((m) => m.id === raw.message_id);
					if (idx < 0) continue;
					const msg = { ...msgs[idx] };
					const reactions = [...(msg.reactions ?? [])];
					const existing = reactions.findIndex((r) => r.emoji_name === raw.emoji_name);
					if (existing >= 0) {
						const r = { ...reactions[existing] };
						if (!r.users.includes(raw.user_id)) {
							r.users = [...r.users, raw.user_id];
							r.count = r.users.length;
						}
						reactions[existing] = r;
					} else {
						reactions.push({
							emoji_name: raw.emoji_name,
							emoji_id: raw.emoji_id ?? null,
							count: 1,
							users: [raw.user_id],
						});
					}
					msg.reactions = reactions;
					updated[convId] = [...msgs.slice(0, idx), msg, ...msgs.slice(idx + 1)];
					break;
				}
				return updated;
			});
			break;
		}
		case "DM_REACTION_REMOVE": {
			const raw = payload.data;
			dmMessages.update((all) => {
				const updated = { ...all };
				for (const [convId, msgs] of Object.entries(updated)) {
					const idx = msgs.findIndex((m) => m.id === raw.message_id);
					if (idx < 0) continue;
					const msg = { ...msgs[idx] };
					let reactions = [...(msg.reactions ?? [])];
					const existing = reactions.findIndex((r) => r.emoji_name === raw.emoji_name);
					if (existing >= 0) {
						const r = { ...reactions[existing] };
						r.users = r.users.filter((uid: string) => uid !== raw.user_id);
						r.count = r.users.length;
						if (r.count === 0) {
							reactions = reactions.filter((_: unknown, i: number) => i !== existing);
						} else {
							reactions[existing] = r;
						}
					}
					msg.reactions = reactions;
					updated[convId] = [...msgs.slice(0, idx), msg, ...msgs.slice(idx + 1)];
					break;
				}
				return updated;
			});
			break;
		}
		case "TYPING": {
			const raw = payload.data;
			const me = get(currentUser);
			if (raw.user_id === me?.id) break;
			typingUsers.update((all) => {
				const key = raw.room_id;
				const filtered = (all[key] ?? []).filter((u) => u.user_id !== raw.user_id);
				return { ...all, [key]: [...filtered, { ...raw, timestamp: Date.now() }] };
			});
			break;
		}
		case "DM_TYPING": {
			const raw = payload.data;
			const me = get(currentUser);
			if (raw.user_id === me?.id) break;
			typingUsers.update((all) => {
				const key = raw.conversation_id;
				const filtered = (all[key] ?? []).filter((u) => u.user_id !== raw.user_id);
				return { ...all, [key]: [...filtered, { ...raw, timestamp: Date.now() }] };
			});
			break;
		}
		case "CALL_INCOMING": {
			const d = payload.data;
			// Track that this conversation has an active call
			conversationsWithCalls.update((s) => {
				s.add(d.conversation_id);
				return new Set(s);
			});
			// Show ringing modal if not already in a call
			if (!get(activeCall)) {
				activeCall.set({
					conversationId: d.conversation_id,
					initiatorId: d.initiator_id,
					initiatorName: d.initiator_name,
					initiatorAvatar: d.initiator_avatar,
					state: "ringing",
					memberIds: d.member_ids,
				});
			}
			break;
		}
		case "CALL_ACCEPTED": {
			const d = payload.data;
			activeCall.update((c) => {
				if (c && c.conversationId === d.conversation_id && c.state === "calling") {
					return { ...c, state: "connected" };
				}
				return c;
			});
			// Start VoiceChat with conversation_id as room
			activeVoiceRoomId.set(d.conversation_id);
			break;
		}
		case "CALL_DECLINED": {
			// If all declined, end call (gateway sends CALL_ENDED)
			break;
		}
		case "CALL_ENDED": {
			const d = payload.data;
			conversationsWithCalls.update((s) => {
				s.delete(d.conversation_id);
				return new Set(s);
			});
			const current = get(activeCall);
			if (current && current.conversationId === d.conversation_id) {
				// Only disconnect voice if still in this conversation's call, not a different voice channel
				if (get(activeVoiceRoomId) === d.conversation_id) {
					activeVoiceRoomId.set(null);
				}
				activeCall.set(null);
				callVoiceStates.set([]);
			}
			break;
		}
		default:
			console.log("[WS] Unhandled event:", event);
	}
}

export interface GatewayConnection {
	/** Permanently close the connection and stop reconnecting. */
	destroy(): void;
}

const HEARTBEAT_INTERVAL_MS = 45_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 2500;

export function createWebSocketConnection(): GatewayConnection {
	let destroyed = false;
	let currentSocket: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	let heartbeatAckTimeout: ReturnType<typeof setTimeout> | null = null;
	let reconnectAttempts = 0;
	let awaitingHeartbeatAck = false;

	function startHeartbeat(socket: WebSocket) {
		heartbeatTimer = setInterval(() => {
			if (socket.readyState === WebSocket.OPEN) {
				if (awaitingHeartbeatAck) {
					console.warn("[WS] No heartbeat ACK received, reconnecting...");
					socket.close();
					return;
				}
				awaitingHeartbeatAck = true;
				socket.send(JSON.stringify({ type: "heartbeat", data: {} }));
				heartbeatAckTimeout = setTimeout(() => {
					if (awaitingHeartbeatAck) {
						console.warn("[WS] Heartbeat ACK timed out, closing connection");
						socket.close();
					}
				}, HEARTBEAT_TIMEOUT_MS);
			}
		}, HEARTBEAT_INTERVAL_MS);
	}

	function onHeartbeatAck() {
		awaitingHeartbeatAck = false;
		if (heartbeatAckTimeout !== null) {
			clearTimeout(heartbeatAckTimeout);
			heartbeatAckTimeout = null;
		}
	}

	function stopHeartbeat() {
		if (heartbeatTimer !== null) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
		if (heartbeatAckTimeout !== null) {
			clearTimeout(heartbeatAckTimeout);
			heartbeatAckTimeout = null;
		}
		awaitingHeartbeatAck = false;
	}

	function connect() {
		if (destroyed) {
			return;
		}

		let socket: WebSocket;
		try {
			socket = new WebSocket(getStreamURL());
		} catch (error) {
			console.error("[WS] Failed to create WebSocket:", error);

			const sessionToken = localStorage.getItem("duvet_session_token");
			if (!sessionToken) {
				console.warn("[WS] No session token, will not attempt to reconnect");
			} else {
				localStorage.removeItem("duvet_session_token");
			}

			window.location.replace(route("/sign-in.html"));
			return;
		}

		currentSocket = socket;
		activeSocket = socket;

		socket.onopen = () => {
			console.log("[WS] Connected");
			reconnectAttempts = 0;
			const identifyData: Record<string, unknown> = {
				token: localStorage.getItem("duvet_session_token"),
			};
			if (lastSeq > 0) {
				identifyData.last_seq = lastSeq;
			}
			socket.send(JSON.stringify({ type: "identify", data: identifyData }));
			startHeartbeat(socket);
		};

		socket.onmessage = (rawEvent) => {
			try {
				const msg: GatewayEvent = JSON.parse(rawEvent.data);
				if (msg.event === "heartbeat_ack") {
					onHeartbeatAck();
					return;
				}
				if (msg.event === "payload") {
					console.log("[WS] Payload:", msg);
					handleEvent(msg);
				}
			} catch (err) {
				console.error("[WS] Failed to parse message:", err);
			}
		};

		socket.onerror = (err) => {
			console.error("[WS] Error:", err);
			const sessionToken = localStorage.getItem("duvet_session_token");
			if (!sessionToken) {
				console.warn("[WS] No session token, will not attempt to reconnect");
				destroyed = true;
				socket.close();
				window.location.replace(route("/sign-in.html"));
				return;
			}

			switch (socket.readyState) {
				case WebSocket.CONNECTING:
					console.warn("[WS] Connection failed during handshake");
					break;
				case WebSocket.OPEN:
					console.warn("[WS] Connection error after established");
					break;
				case WebSocket.CLOSING:
				case WebSocket.CLOSED:
					console.warn("[WS] Connection closed due to error");
					break;
			}

			if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
				console.error("[WS] Maximum reconnect attempts reached. Please refresh the page.");
				destroyed = true;
				socket.close();
				localStorage.removeItem("duvet_session_token");
				window.location.replace(route("/sign-in.html"));
			}
		};

		socket.onclose = () => {
			console.log("[WS] Disconnected");
			stopHeartbeat();
			currentSocket = null;
			activeSocket = null;
			if (!destroyed) {
				reconnectAttempts++;
				reconnectTimer = setTimeout(connect, MAX_RECONNECT_DELAY_MS);
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
