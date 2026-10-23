import {
	pinUpdates,
	channelMessages,
	ephemeralMessages,
	keepEphemeral,
	dropEphemeral,
	wsSessionToken,
	iceServers,
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
	dropVoiceRequests,
	spaceEmojis,
	spaceStickers,
	userActivities,
	shareSpotify,
	pendingTeamInvites,
	myBuckets,
	allSpacesReady,
} from "$lib/stores.svelte";
import { getFriends, getPendingRequests, getSentRequests } from "$lib/api/friends";
import { getConversations } from "$lib/api/conversations";
import { listMyTeamInvites } from "$lib/api/developer";
import { getMyBuckets, me as fetchMe } from "$lib/api/user";
import { getMentionCounts } from "$lib/api/messages";
import { getWSHostURL, getAvatarURL, route } from "$lib/common/common";
import { get } from "svelte/store";
import { getSpaceMembers, type SpaceMemberWithUser } from "$lib/api/spaces";
import { forgetSpaceCommands } from "$lib/api/interactions";

import type { DMTypingEvent, GatewayEvent, GatewaySpace, ReferencedMessage, TypingEvent, UserStatus } from "$lib/types";

import { gatewayMessageToMessage, isEphemeral } from "$lib/types";

// Token is passed via query string because the WebSocket API does not support
// custom headers during the handshake. Ideally the gateway would accept a
// short-lived ticket instead so the long-lived session token is not logged in
// server access logs or browser history.
export function getStreamURL(): string {
	return `${getWSHostURL()}/gateway?token=${localStorage.getItem("duvet_session_token")}`;
}

import { audioStore } from "$lib/stores/audio.svelte";
import { storageTransfers } from "$lib/stores/storage-transfers.svelte";
import { getElectrobunRpc, type ActivityPayload } from "$lib/electrobun-rpc";

// The user's activities as this app's Bun process reports them: the IPC apps' (VS Code, etc.) and Spotify's. The
// gateway keeps them 2 minutes and shares only a change, so they go again every 45 s, and on each new session.
let localActivities: ActivityPayload[] | null = null;
const ACTIVITY_RESEND_MS = 45_000;
// Set when they couldn't go (no socket), so that an empty list, which isn't resent, still reaches the gateway.
let activitiesUnsent = false;

function sendActivities() {
	activitiesUnsent = gatewayConnection() === null;
	sendEventMessage("ACTIVITY_UPDATE", { activities: localActivities });
}

getElectrobunRpc()
	.then((rpc) => {
		if (!rpc) return;
		rpc.on.activityUpdate((activities) => {
			const unchanged = !activities?.length && !localActivities?.length;
			localActivities = activities;
			if (!unchanged) sendActivities();
		});
		setInterval(() => {
			if (localActivities?.length || activitiesUnsent) sendActivities();
		}, ACTIVITY_RESEND_MS);
		// Spotify's reader runs in the Bun process; its setting is kept in this device's storage.
		shareSpotify.subscribe((enabled) => rpc.send.setSpotifyActivity({ enabled }));
	})
	.catch(() => {});

// Active socket — module-level so sendMessage can access it
let activeSocket: WebSocket | null = null;

// Last received sequence number, used for resume on reconnect
let lastSeq = 0;

// Set by wantFreshSession until a READY comes: identify starts a new session instead of resuming this one.
let freshSessionWanted = false;

// Counts the connections to the gateway that opened, so what was sent can be matched to the session it reached.
let connectionCount = 0;

// When the gateway last sent an event or a heartbeat ack, and how long it had gone silent before the latest one.
let lastHeardAt = 0;
let silenceBeforeLast = 0;

// Last VOICE_STATE_UPDATE version seen per room and user. Updates can arrive out of order; one
// that isn't newer than what's shown is dropped.
const voiceStateVersions = new Map<string, number>();

/** Records a version from a snapshot (READY, SPACE_CREATE) without judging it. */
function noteVoiceStateVersion(roomId: string, userId: string, version: number | undefined) {
	if (version === undefined) return;
	const key = `${roomId}:${userId}`;
	if ((voiceStateVersions.get(key) ?? 0) < version) voiceStateVersions.set(key, version);
}

/** Whether an update is older than one already applied; records it when it isn't. */
function isStaleVoiceState(roomId: string, userId: string, version: number | undefined): boolean {
	if (version === undefined) return false; // a gateway that doesn't send versions
	const key = `${roomId}:${userId}`;
	const last = voiceStateVersions.get(key);
	// Equal is the same state again (each change gets a new version), like a call's catch-up on rejoin.
	if (last !== undefined && version < last) return true;
	voiceStateVersions.set(key, version);
	return false;
}

// Track expected SPACE_CREATE events to know when all spaces are loaded
let expectedGuildIds: Set<string> | null = null;
let receivedGuildIds = new Set<string>();

// Cache of live user statuses received via USER_STATUS_UPDATE.
// Keys: "userId" for global status (regular users), "userId:spaceId" for
// per-space status (sharded bots). Lookups check space-specific key first,
// then fall back to the global key.
export const userStatusCache = new Map<string, UserStatus>();

// Returns the global status for a user.
// Used for contexts without a specific space (e.g., conversations).
export function getUserOnlineStatus(userId: string): UserStatus {
	return userStatusCache.get(userId) ?? 0;
}

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

/** The number of the open connection to the gateway, or null while there's none and a message sent would be lost.
 * What's sent on a connection reaches the session its identify started or resumed. */
export function gatewayConnection(): number | null {
	return activeSocket?.readyState === WebSocket.OPEN ? connectionCount : null;
}

/** Makes the next identify start a new session rather than resume this one. VoiceChat asks for one when it has to
 * join while the gateway is unreachable: it joins on that session's READY, which a resume doesn't send, and a
 * resume would replay what its earlier connection was sent. */
export function wantFreshSession() {
	freshSessionWanted = true;
}

function addMembersToSpace(spaceId: string, rows: SpaceMemberWithUser[]) {
	gatewaySpaces.update((spaces) =>
		spaces.map((s) => {
			if (s.id !== spaceId) return s;
			const existingUserIds = new Set(s.users.map((u) => u.id));
			const incomingUserIds = new Set(rows.map((r) => r.user.id));
			// Replace any placeholder members for the same users with real data
			const filteredMembers = s.members.filter((m) => !incomingUserIds.has(m.user_id));
			const newUsers = rows.map((r) => r.user).filter((u) => !existingUserIds.has(u.id));
			const newMembers = rows.map(({ user: _u, max_pos: _p, ...m }) => m);
			return {
				...s,
				users: [...s.users, ...newUsers],
				members: [...filteredMembers, ...newMembers],
			};
		}),
	);
}

/** A reply's reference once the message it quotes is deleted: only the reference itself stays,
 * as the API sends it from then on, and the reply shows the original as deleted. */
function deletedReference(ref: ReferencedMessage): ReferencedMessage {
	return { type: ref.type, message_id: ref.message_id, room_id: ref.room_id, space_id: ref.space_id };
}

/** Someone typing (TYPING, DM_TYPING) or recording a voice message (RECORDING, DM_RECORDING) in a room or a
 * conversation, shown until the notice gets old: either one replaces the other. */
function showNotice(key: string, raw: TypingEvent | DMTypingEvent, recording: boolean) {
	if (raw.user_id === get(currentUser)?.id) return;
	typingUsers.update((all) => {
		const filtered = (all[key] ?? []).filter((u) => u.user_id !== raw.user_id);
		return { ...all, [key]: [...filtered, { ...raw, recording, timestamp: Date.now() }] };
	});
}

function handleEvent(event: GatewayEvent) {
	if (event.s) {
		lastSeq = event.s;
	}
	if (!event.d) {
		console.warn("[WS] Received event with no data:", event);
		return;
	}
	if (import.meta.env.DEV) console.log("[WS] Received event:", event);
	const payload = event.d;
	switch (payload.type) {
		case "READY": {
			const { user, sessionToken, unread_rooms } = payload.data;
			lastSeq = 0;
			freshSessionWanted = false;
			// Per-space statuses are set via SPACE_CREATE member_statuses.
			currentUser.set(user);
			wsSessionToken.set(sessionToken);
			if (payload.data.ice_servers) iceServers.set(payload.data.ice_servers);
			voiceStateVersions.clear();
			// The SPACE_CREATEs bring them again, without those a USER_ACTIVITY_UPDATE missed while away cleared.
			userActivities.set({});
			unreadChannels.set(new Set(unread_rooms ?? []));
			lastReadRooms.set(payload.data.last_read_rooms ?? {});
			lastMsgRooms.set(payload.data.last_msg_rooms ?? {});
			const { unread_convs } = payload.data;
			unreadConversations.set(new Set(unread_convs ?? []));
			// Fetch friends, pending/sent requests, and conversations eagerly
			// so they are available before FriendsView mounts.
			Promise.all([
				getPendingRequests(),
				getSentRequests(),
				getFriends(),
				getConversations(),
				listMyTeamInvites(),
				getMyBuckets(),
			])
				.then(([pending, sent, friendList, convList, teamInvites, bucketList]) => {
					pendingFriendRequests.set(pending);
					sentFriendRequests.set(sent);
					friends.set(friendList);
					conversations.set(convList);
					pendingTeamInvites.set(teamInvites);
					myBuckets.set(bucketList);
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
								noteVoiceStateVersion(call.conversation_id, vs.user_id, vs.version);
								filtered.push({
									room_id: call.conversation_id,
									user_id: vs.user_id,
									muted: vs.muted,
									deafened: vs.deafened,
									screen_sharing: vs.screen_sharing,
									camera: vs.camera,
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
			// The call this client is in is over when the new session doesn't list it: the gateway keeps calls in
			// memory, so its restart ends them.
			const ownCall = get(activeCall);
			if (ownCall && !activeCalls.some((c) => c.conversation_id === ownCall.conversationId)) {
				if (get(activeVoiceRoomId) === ownCall.conversationId) activeVoiceRoomId.set(null);
				activeCall.set(null);
				callVoiceStates.update((states) => states.filter((s) => s.room_id !== ownCall.conversationId));
				dropVoiceRequests();
			}

			// Reset spaces so SPACE_CREATE events that follow repopulate them
			// with fresh data (including current voice_states). Without this,
			// if the server rejects a resume and starts a new session, the
			// exists-guard in SPACE_CREATE would skip updates and voice states
			// from before the reconnect would never be shown.
			gatewaySpaces.set([]);
			friendsReady.set(false);
			allSpacesReady.set(false);
			const guildIds = payload.data.guild_ids ?? [];
			expectedGuildIds = new Set(guildIds);
			receivedGuildIds = new Set();
			if (guildIds.length === 0) {
				allSpacesReady.set(true);
			}
			// A new session has no voice connection of this client's: VoiceChat joins its room or call again, unless
			// the gateway had been silent for long.
			webrtcListeners.forEach((cb) => {
				cb(payload.type, { silent_ms: silenceBeforeLast });
			});
			// Nor this app's activities, which the gateway may have let expire meanwhile.
			if (localActivities?.length || activitiesUnsent) sendActivities();
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

			// Load initial activities for this space
			const spaceActivities = spaceCreateData.activities;
			if (spaceActivities) {
				userActivities.update((all) => ({ ...all, ...spaceActivities }));
			}

			// Cache member statuses from Redis so lazy-loaded members get correct status.
			// member_statuses are keyed by userId (global status).
			const memberStatuses = spaceCreateData.member_statuses;
			if (memberStatuses) {
				for (const [uid, status] of Object.entries(memberStatuses)) {
					userStatusCache.set(uid, status);
				}
			}

			gatewaySpaces.update((spaces) => {
				const exists = spaces.some((s) => s.id === space.id);
				if (exists) {
					return spaces;
				}
				// Only for a snapshot that's kept: a skipped one mustn't hide newer updates.
				for (const vs of space.voice_states ?? []) noteVoiceStateVersion(vs.room_id, vs.user_id, vs.version);
				return [...spaces, space];
			});

			receivedGuildIds.add(space.id);
			if (expectedGuildIds && receivedGuildIds.size >= expectedGuildIds.size) {
				allSpacesReady.set(true);
			}
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
					return {
						...s,
						name: updated.name ?? s.name,
						description: updated.description ?? s.description,
						icon: updated.icon !== undefined ? updated.icon : s.icon,
						banner: updated.banner !== undefined ? updated.banner : s.banner,
						locale: updated.locale !== undefined ? updated.locale : s.locale,
						owner_id: updated.owner_id ?? s.owner_id,
						updated_at: updated.updated_at ?? s.updated_at,
					};
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
			const roomId = raw.room_id;
			if (!roomId) break;
			const spaces = get(gatewaySpaces);
			const message = gatewayMessageToMessage(raw, spaces);
			// An ephemeral message, which a bot sent this user alone, isn't one of the room's: it leaves the room read.
			const ephemeral = isEphemeral(message);
			if (roomId !== get(activeTextRoomId) && !ephemeral) {
				unreadChannels.update((s) => {
					s.add(roomId);
					return s;
				});
			}
			typingUsers.update((all) => {
				if (!all[roomId]) return all;
				return { ...all, [roomId]: all[roomId].filter((u) => u.user_id !== raw.author_id) };
			});
			if (ephemeral) {
				keepEphemeral(roomId, message);
				break;
			}
			channelMessages.update((all) => {
				const existing = all[roomId] ?? [];

				// If it matches a pending message by nonce, replace it
				if (message.nonce) {
					const pendingIndex = existing.findIndex((m) => m.nonce === message.nonce);
					if (pendingIndex !== -1) {
						const newMessages = [...existing];
						newMessages[pendingIndex] = message;
						return {
							...all,
							[roomId]: newMessages,
						};
					}
				}

				// Already listed (a history load while its files were uploading, a second socket): the
				// event has the finished message, files included, so it replaces that copy.
				const listed = existing.findIndex((m) => m.id === message.id);
				if (listed !== -1) {
					const newMessages = [...existing];
					newMessages[listed] = message;
					return { ...all, [roomId]: newMessages };
				}
				return {
					...all,
					[roomId]: [...existing, message],
				};
			});
			break;
		}
		case "MESSAGE_UPDATE": {
			const raw = payload.data;
			const spaces = get(gatewaySpaces);
			const updatedMessage = gatewayMessageToMessage(raw, spaces);
			// An ephemeral message stays so (its flag never changes), apart from the room's. One dismissed is gone.
			if (isEphemeral(updatedMessage)) {
				const roomId = raw.room_id;
				const shown = roomId ? get(ephemeralMessages)[roomId]?.find((m) => m.id === updatedMessage.id) : undefined;
				if (roomId && shown) {
					keepEphemeral(roomId, {
						...updatedMessage,
						interaction_metadata: updatedMessage.interaction_metadata ?? shown.interaction_metadata,
					});
				}
				break;
			}
			channelMessages.update((all) => {
				const result: typeof all = {};
				for (const [roomId, msgs] of Object.entries(all)) {
					result[roomId] = msgs.map((m) => {
						// The update payload carries no attachments, reactions or pin: keep the existing ones.
						if (m.id === updatedMessage.id)
							return {
								...updatedMessage,
								attachments: updatedMessage.attachments ?? m.attachments,
								reactions: updatedMessage.reactions ?? m.reactions,
								referenced_message: updatedMessage.referenced_message ?? m.referenced_message,
								interaction_metadata: updatedMessage.interaction_metadata ?? m.interaction_metadata,
								pinned_at: m.pinned_at,
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
		case "MESSAGE_PIN_UPDATE": {
			const { id, room_id, pinned_at } = payload.data;
			channelMessages.update((all) => {
				const msgs = all[room_id];
				if (!msgs) return all;
				return { ...all, [room_id]: msgs.map((m) => (m.id === id ? { ...m, pinned_at } : m)) };
			});
			pinUpdates.set({ channelId: room_id, messageId: id });
			break;
		}
		case "MESSAGE_DELETE": {
			const raw = payload.data;
			dropEphemeral(raw.room_id, raw.id);
			channelMessages.update((all) => {
				const existing = all[raw.room_id] ?? [];
				return {
					...all,
					[raw.room_id]: existing
						.filter((m) => m.id !== raw.id)
						.map((m) =>
							m.referenced_message?.message_id === raw.id
								? { ...m, referenced_message: deletedReference(m.referenced_message) }
								: m,
						),
				};
			});
			break;
		}
		case "MENTION_CREATE": {
			const { room_id } = payload.data;
			mentionCounts.update((all) => ({ ...all, [room_id]: (all[room_id] ?? 0) + 1 }));
			const isActive = room_id === get(activeTextRoomId);
			if (!isActive || !get(pageVisible)) {
				audioStore.play("notification");
			}
			break;
		}
		case "DM_MENTION_CREATE": {
			const { conversation_id } = payload.data;
			mentionCounts.update((all) => ({ ...all, [conversation_id]: (all[conversation_id] ?? 0) + 1 }));
			const isActive = conversation_id === get(activeDMConvId);
			if (!isActive || !get(pageVisible)) {
				audioStore.play("notification");
			}
			break;
		}
		case "USER_UPDATE": {
			const raw = payload.data;
			const patch: Record<string, any> = {
				username: raw.username,
				alias: raw.alias,
				avatar: raw.avatar,
				banner: raw.banner,
				flags: raw.flags,
				badges: raw.badges,
			};
			currentUser.update((u) => (u?.id === raw.id ? { ...u, ...patch } : u));
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => ({
					...s,
					users: s.users.map((u) => (u.id === raw.id ? { ...u, ...patch } : u)),
				})),
			);
			const newName = raw.alias ?? raw.username;
			const newAvatar = getAvatarURL(raw.id, raw.avatar);
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
			const raw = payload.data;
			if (raw.status_id === 0) {
				userStatusCache.delete(raw.user_id);
				if (raw.space_id) {
					userStatusCache.delete(`${raw.user_id}:${raw.space_id}`);
				} else if (raw.user_id in get(userActivities)) {
					// Gone offline: the gateway dropped their activities too, which would show here otherwise.
					userActivities.update((all) => {
						const next = { ...all };
						delete next[raw.user_id];
						return next;
					});
				}
			} else {
				userStatusCache.set(raw.user_id, raw.status_id);
				if (raw.space_id) {
					userStatusCache.set(`${raw.user_id}:${raw.space_id}`, raw.status_id);
				}
			}
			// Create new object references for affected spaces so Svelte detects the change
			gatewaySpaces.update((spaces) => spaces.map((s) => (s.users.some((u) => u.id === raw.user_id) ? { ...s } : s)));
			conversations.update((convs) =>
				convs.map((c) => (c.members.some((m) => m.user_id === raw.user_id) ? { ...c } : c)),
			);
			break;
		}
		case "USER_ACTIVITY_UPDATE": {
			const { user_id, activities } = payload.data;
			userActivities.update((all) => ({ ...all, [user_id]: activities ?? [] }));
			break;
		}
		case "VOICE_STATE_UPDATE": {
			const raw = payload.data;
			if (isStaleVoiceState(raw.room_id, raw.user_id, raw.version)) break;

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
									camera: raw.camera,
								},
							];
						}
						const copy = [...states];
						copy[idx] = {
							...copy[idx],
							muted: raw.muted,
							deafened: raw.deafened,
							screen_sharing: raw.screen_sharing,
							camera: raw.camera,
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
								camera: raw.camera,
								version: raw.version,
							});
						} else {
							nextStates[existingIdx] = {
								...nextStates[existingIdx],
								muted: raw.muted,
								deafened: raw.deafened,
								screen_sharing: raw.screen_sharing,
								camera: raw.camera,
								version: raw.version,
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
		case "VOICE_SESSION_REPLACED": {
			const { room_id } = payload.data;
			if (get(activeVoiceRoomId) === room_id) {
				activeVoiceRoomId.set(null);
			}
			break;
		}
		// VOICE_VIDEO_REFUSED goes to VoiceChat, which turns the camera off and says why.
		case "VOICE_VIDEO_REFUSED":
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
			userStatusCache.set(raw.user_id, raw.status_id);
			// The member may be a bot, whose commands the space's list doesn't have yet.
			forgetSpaceCommands(raw.space_id);
			getSpaceMembers(raw.space_id)
				.then((rows) => addMembersToSpace(raw.space_id, rows))
				.catch((err) => console.error("[WS] Failed to refresh members after join:", err));
			break;
		}
		case "SPACE_MEMBER_REMOVE": {
			const raw = payload.data;
			forgetSpaceCommands(raw.space_id);
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
		case "ROOM_REORDER": {
			const { rooms } = payload.data;
			if (!rooms || rooms.length === 0) break;
			const spaceId = rooms[0].space_id;
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => {
					if (s.id !== spaceId) return s;
					return {
						...s,
						rooms: s.rooms.map((r) => {
							const updated = rooms.find((u) => u.id === r.id);
							if (updated) {
								return { ...r, position: updated.position, parent_id: updated.parent_id };
							}
							return r;
						}),
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
		case "FRIEND_REQUEST_CREATE": {
			// Event shape differs from store type; refetch the full list. The sender's other
			// sessions get it too, for their sent requests.
			if (payload.data.sender_id === get(currentUser)?.id) {
				getSentRequests()
					.then((list) => sentFriendRequests.set(list))
					.catch((err) => console.error("[WS] Failed to refresh sent requests:", err));
			} else {
				getPendingRequests()
					.then((list) => pendingFriendRequests.set(list))
					.catch((err) => console.error("[WS] Failed to refresh pending requests:", err));
			}
			break;
		}
		case "FRIEND_REQUEST_ACCEPT": {
			const raw = payload.data;
			// Event shape differs from store type; refetch the full lists. Both sides get it.
			getFriends()
				.then((list) => friends.set(list))
				.catch((err) => console.error("[WS] Failed to refresh friends:", err));
			sentFriendRequests.update((reqs) => reqs.filter((r) => r.id !== raw.request_id));
			pendingFriendRequests.update((reqs) => reqs.filter((r) => r.id !== raw.request_id));
			break;
		}
		case "FRIEND_REQUEST_REJECT": {
			// Rejected by the recipient or cancelled by the sender; both sides get it.
			const raw = payload.data;
			sentFriendRequests.update((reqs) => reqs.filter((r) => r.id !== raw.id));
			pendingFriendRequests.update((reqs) => reqs.filter((r) => r.id !== raw.id));
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
			conversations.update((list) =>
				list.map((c) => (c.id === raw.id ? { ...c, name: raw.name, owner_id: raw.owner_id } : c)),
			);
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
								user: {
									id: raw.user_id,
									username: raw.username ?? "",
									alias: raw.alias ?? null,
									avatar: raw.avatar ?? null,
									banner: raw.banner ?? null,
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
				// Already listed: the event's copy is the finished one (see MESSAGE_CREATE).
				const listed = existing.findIndex((m) => m.id === msg.id);
				if (listed !== -1) {
					const updated = [...existing];
					updated[listed] = msg;
					return { ...all, [conversationId]: updated };
				}
				return { ...all, [conversationId]: [...existing, msg] };
			});
			// Move conversation to top
			conversations.update((list) =>
				list
					.map((c) => (c.id === conversationId ? { ...c, updated_at: msg.created_at } : c))
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
					// The update payload carries what an edit changes, not attachments, reactions or reply data.
					[conversationId]: existing.map((m) => {
						if (m.id === msg.id)
							return {
								...m,
								content: msg.content,
								updated_at: msg.updated_at,
								embeds: msg.embeds,
								sticker_attachment_id: msg.sticker_attachment_id,
							};
						if (m.referenced_message?.message_id === msg.id) {
							return { ...m, referenced_message: { ...m.referenced_message, content: msg.content } };
						}
						return m;
					}),
				};
			});
			break;
		}
		case "DM_MESSAGE_PIN_UPDATE": {
			const { id, conversation_id, pinned_at } = payload.data;
			dmMessages.update((all) => {
				const msgs = all[conversation_id];
				if (!msgs) return all;
				return { ...all, [conversation_id]: msgs.map((m) => (m.id === id ? { ...m, pinned_at } : m)) };
			});
			pinUpdates.set({ channelId: conversation_id, messageId: id });
			break;
		}
		case "DM_MESSAGE_DELETE": {
			const raw = payload.data;
			dmMessages.update((all) => {
				const existing = all[raw.conversation_id] ?? [];
				return {
					...all,
					[raw.conversation_id]: existing
						.filter((m) => m.id !== raw.id)
						.map((m) =>
							m.referenced_message?.message_id === raw.id
								? { ...m, referenced_message: deletedReference(m.referenced_message) }
								: m,
						),
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
		case "TYPING":
		case "RECORDING":
			showNotice(payload.data.room_id, payload.data, payload.type === "RECORDING");
			break;
		case "DM_TYPING":
		case "DM_RECORDING":
			showNotice(payload.data.conversation_id, payload.data, payload.type === "DM_RECORDING");
			break;
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
					memberIds: [],
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
				// The call's VoiceChat may already be gone (its connection failed): a camera or screen request it
				// didn't take goes with the call.
				dropVoiceRequests();
			}
			break;
		}
		case "TEAM_INVITE_CREATE": {
			const inv = payload.data;
			pendingTeamInvites.update((list) => [...list, inv]);
			break;
		}
		case "STORAGE_TRANSFER_UPDATE": {
			// Only who started the transfer gets it: when it's created, starts, moves and ends.
			storageTransfers.set(payload.data, true);
			break;
		}
		default:
			if (import.meta.env.DEV) console.log("[WS] Unhandled event:", event);
	}
}

export interface GatewayConnection {
	/** Permanently close the connection and stop reconnecting. */
	destroy(): void;
}

const HEARTBEAT_INTERVAL_MS = 45_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const RECONNECTS_PER_SESSION_CHECK = 5;
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_JITTER_MS = 1000;

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
			if (import.meta.env.DEV) console.log("[WS] Connected");
			reconnectAttempts = 0;
			const identifyData: Record<string, unknown> = {
				token: localStorage.getItem("duvet_session_token"),
			};
			if (lastSeq > 0 && !freshSessionWanted) {
				identifyData.last_seq = lastSeq;
				const gwToken = get(wsSessionToken);
				if (gwToken) {
					identifyData.session_token = gwToken;
				}
			}
			connectionCount++;
			socket.send(JSON.stringify({ type: "identify", data: identifyData }));
			startHeartbeat(socket);
		};

		socket.onmessage = (rawEvent) => {
			try {
				const msg: GatewayEvent = JSON.parse(rawEvent.data);
				// Not a close-with-reason: a refused identify after a sleep would hide how long it lasted.
				if (msg.event === "heartbeat_ack" || msg.event === "payload") {
					const now = Date.now();
					silenceBeforeLast = lastHeardAt ? now - lastHeardAt : 0;
					lastHeardAt = now;
				}
				if (msg.event === "heartbeat_ack") {
					onHeartbeatAck();
					return;
				}
				if (msg.event === "close-with-reason") {
					// 4004: the gateway rejected or revoked the token. Ask the API about the session now
					// rather than after a few more tries with that token: a dead session gets a 401
					// there, which signs out; a live one passes, and reconnecting uses its current token.
					if (msg.code === 4004) {
						fetchMe().catch((err) => console.warn("[WS] Session check after a 4004 failed:", err));
					}
					return;
				}
				if (msg.event === "payload") {
					if (import.meta.env.DEV) console.log("[WS] Payload:", msg);
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

			// On the first failure and every few after it, ask the API about the session: the gateway
			// may just be down, or the access token expired. The API refreshes the token, or signs out
			// only if the session is really gone; reconnecting goes on either way (the delay is capped).
			if (reconnectAttempts % RECONNECTS_PER_SESSION_CHECK === 0) {
				fetchMe().catch((checkErr) => console.warn("[WS] Session check while reconnecting failed:", checkErr));
			}
		};

		socket.onclose = () => {
			if (import.meta.env.DEV) console.log("[WS] Disconnected");
			stopHeartbeat();
			currentSocket = null;
			activeSocket = null;
			if (!destroyed) {
				reconnectAttempts++;
				const baseDelay = Math.min(INITIAL_RECONNECT_DELAY_MS * 2 ** (reconnectAttempts - 1), MAX_RECONNECT_DELAY_MS);
				const jitter = Math.random() * RECONNECT_JITTER_MS;
				reconnectTimer = setTimeout(connect, baseDelay + jitter);
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
