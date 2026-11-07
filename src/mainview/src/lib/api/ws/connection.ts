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
	lastReadConvs,
	unreadConversations,
	activeDMConvId,
	pageVisible,
	mentionCounts,
	activeCall,
	callVoiceStates,
	conversationsWithCalls,
	ownCallsRinging,
	dropVoiceRequests,
	spaceEmojis,
	spaceStickers,
	userActivities,
	shareSpotify,
	pendingTeamInvites,
	myBuckets,
	allSpacesReady,
} from "$lib/stores.svelte";
import { getFriends, getPendingRequests, getSentRequests, type Friend } from "$lib/api/friends";
import { getConversations, getDirectMessageById, type Conversation } from "$lib/api/conversations";
import { listMyTeamInvites } from "$lib/api/developer";
import { getMyBuckets, me as fetchMe } from "$lib/api/user";
import { getMentionCounts, getMessageById } from "$lib/api/messages";
import { getWSHostURL, getAvatarURL, isUuid, route } from "$lib/common/common";
import { derived, get, type Writable } from "svelte/store";
import { getSpaceMembers, type SpaceMemberWithUser } from "$lib/api/spaces";
import { forgetSpaceCommands } from "$lib/api/interactions";

import type {
	CallNotice,
	DMTypingEvent,
	GatewayEvent,
	GatewaySpace,
	MessageReaction,
	Presence,
	ReactionEvent,
	ReferencedMessage,
	RoomReadState,
	TypingEvent,
	UserStatus,
} from "$lib/types";

import {
	gatewayMessageToMessage,
	isEphemeral,
	MessageType,
	readySpacesArrived,
	spaceWithoutRoom,
	withoutRoomMessages,
	withCreatedRole,
	withRoomReadStates,
	withSpaceCreate,
} from "$lib/types";
import { CallAnswers, callNoticeSeen, newestBesidesNotice, readAfterCallNotice } from "$lib/call-notices";

// Token is passed via query string because the WebSocket API does not support
// custom headers during the handshake. Ideally the gateway would accept a
// short-lived ticket instead so the long-lived session token is not logged in
// server access logs or browser history.
export function getStreamURL(): string {
	return `${getWSHostURL()}/gateway?token=${localStorage.getItem("duvet_session_token")}`;
}

import { audioStore } from "$lib/stores/audio.svelte";
import {
	applyStatusUpdate,
	forgetMemberStatus,
	forgetSpaceStatuses,
	isMobileOnly,
	mentionSound,
	noteConversationMemberStatus,
	noteMemberStatus,
	rememberConversationPresences,
	rememberFriendPresences,
} from "$lib/status";
import {
	callAcceptedAction,
	callDeclinedAction,
	callDeclinedNotice,
	callOngoingAction,
	callOnReady,
	callToRingOnReady,
	callVoiceStatesOf,
	missedCallNotice,
	ownCallsRingingOnReady,
	placeAgain,
	voiceEndedNotice,
	withCallVoiceState,
	type PlacedCall,
} from "$lib/calls";
import { withUserUpdate } from "$lib/friends";
import { sendAgain } from "$lib/resend";
import { dropReplyTo, takeBack } from "$lib/drafts";
import { SENT_BEFORE_CANCEL } from "$lib/uploads";
import { knowMessage, newestKnownIn } from "$lib/jumps";
import { reactionChanged, withReaction, type ReactionChange } from "$lib/reactions";
import { customEmojiMapOf } from "$lib/markdown";
import {
	conversationPlace,
	directMessageAuthor,
	dropMentionNotice,
	mentionNoticeOf,
	roomPlace,
	showMentionNotice,
} from "$lib/mention-notices";
import { storageTransfers } from "$lib/stores/storage-transfers.svelte";
import { toast } from "$lib/stores/toast.svelte";
import { getElectrobunRpc, type ActivityPayload } from "$lib/electrobun-rpc";
import { identifyData } from "$lib/api/ws/identify";

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

// Cache of live user presences: each one's status, with their client status (the platforms they're on). Keys:
// "userId" for a user's global presence, "userId:spaceId" for their presence in a space (SPACE_CREATE, a bot's
// SPACE_MEMBER_ADD, and a sharded bot's USER_STATUS_UPDATE with that space_id), which goes with SPACE_MEMBER_REMOVE
// and SPACE_DELETE. A space shows a bot with its status there alone, and anyone else with their global one
// (memberStatus).
export const userStatusCache = new Map<string, Presence>();

// Returns the global status for a user.
// Used for contexts without a specific space (e.g., conversations).
export function getUserOnlineStatus(userId: string): UserStatus {
	return userStatusCache.get(userId)?.status_id ?? 0;
}

/** Whether a user is connected only from the mobile app, by their global presence, as getUserOnlineStatus: their
 * status then shows as a phone. */
export function getUserMobileOnly(userId: string): boolean {
	return isMobileOnly(userStatusCache.get(userId)?.client_status);
}

/** Whether the gateway shows the user themself only on mobile, for their own entries (the user panel, their card in
 * Settings), which aren't drawn from a space's members. The cache isn't reactive: this reads it again whenever
 * gatewaySpaces changes, which every event that writes a presence of theirs re-references (READY empties it). */
export const ownMobileOnly = derived([gatewaySpaces, currentUser], ([, me]) => !!me && getUserMobileOnly(me.id));

/** Takes the presences a friends list gives for the friends the gateway hasn't told us about yet
 * (rememberFriendPresences). Friends hear each other's changes from then on, also with no space in common. */
export function rememberFriendStatuses(list: Friend[]) {
	const learned = rememberFriendPresences(userStatusCache, list, get(currentUser)?.id);
	// The DM list shows them too.
	if (learned.size > 0) {
		conversations.update((convs) => convs.map((c) => (c.members.some((m) => learned.has(m.user_id)) ? { ...c } : c)));
	}
}

/** Takes the presences a conversations list gives their members for those the gateway hasn't told us about yet
 * (rememberConversationPresences): someone who is neither the user's friend nor in a space with them is known only
 * from there, and their changes reach the user from then on. */
export function rememberConversationStatuses(list: Conversation[]) {
	rememberConversationPresences(userStatusCache, list, get(currentUser)?.id);
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

// The CALL_ACCEPT still waiting for the gateway's CALL_ACCEPTED, and the connection it went out on.
let pendingAccept: { conversationId: string; sentOn: number | null } | null = null;

/** Accepts the call ringing here, or joins one going on: a CALL_ACCEPT, kept until the gateway's CALL_ACCEPTED for
 * this user answers it. The connection it goes out on can drop before the gateway gets it, so the next session,
 * resumed or new, sends it again (sendAgain). */
export function acceptCall(conversationId: string) {
	pendingAccept = { conversationId, sentOn: gatewayConnection() };
	sendEventMessage("CALL_ACCEPT", { conversation_id: conversationId });
}

// Sends a CALL_ACCEPT the gateway may not have got again, for the call this client is still in.
function resendCallAccept() {
	const pending = pendingAccept;
	const connection = gatewayConnection();
	if (!pending || connection === null) return;
	if (get(activeCall)?.conversationId !== pending.conversationId) {
		pendingAccept = null;
		return;
	}
	if (sendAgain({ sentOn: pending.sentOn, answered: false }, connection)) acceptCall(pending.conversationId);
}

// The CALL_INITIATE of the call this client places, until the gateway shows it has the call.
let placedCall: PlacedCall | null = null;

/** Places a call: a CALL_INITIATE, kept until the gateway shows it has the call (its CALL_OUTGOING, a decline or an
 * answer). The connection it goes out on can drop before the gateway gets it, which would leave the caller on
 * "Calling…" until they cancel, so a resumed session sends it again (placeAgain). */
export function placeCall(conversationId: string, memberIds: string[]) {
	placedCall = { conversationId, memberIds, sentOn: gatewayConnection(), answered: false };
	sendEventMessage("CALL_INITIATE", { conversation_id: conversationId, member_ids: memberIds });
}

// The gateway has the call in this conversation: if it's the one this client places, its CALL_INITIATE got there.
function gatewayHasCall(conversationId: string) {
	if (placedCall?.conversationId === conversationId) placedCall = { ...placedCall, answered: true };
}

/** Cancels the call this client places: a CALL_CANCEL. If it's the user's own call, still ringing the others, it no
 * longer rings them: the gateway ends it, and CALL_ENDED follows. One they called back into after hanging up goes on
 * without them (decision 64), and wasn't ringing anyone: it was answered. */
export function cancelCall(conversationId: string) {
	sendEventMessage("CALL_CANCEL", { conversation_id: conversationId });
	stopOwnCallRinging(conversationId);
	if (placedCall?.conversationId === conversationId) placedCall = null;
}

// Sends a CALL_INITIATE the gateway may not have got again, for the call this client still places.
function resendPlacedCall() {
	const connection = gatewayConnection();
	if (connection === null) return;
	const placed = placedCall;
	const action = placeAgain(placed, get(activeCall), connection);
	if (action === "drop") placedCall = null;
	else if (action === "again" && placed) placeCall(placed.conversationId, placed.memberIds);
}

// Whether this client's CALL_INITIATE or CALL_ACCEPT for the call in that conversation went out on the open
// connection, after its identify.
function sentOnThisConnection(conversationId: string): boolean {
	const connection = gatewayConnection();
	return (
		connection !== null &&
		[placedCall, pendingAccept].some((send) => send?.conversationId === conversationId && send.sentOn === connection)
	);
}

// The calls the user answered from one of their devices, whose notices then leave the conversation read for them, as the
// API does.
const callAnswers = new CallAnswers();

// A call notice that comes (DM_MESSAGE_CREATE) leaves its conversation read, up to it, for a user who saw the call: they
// were in it, or answered it (callAnswers). For one who missed it, it's news like any message. The open conversation
// shows its own unread state: only its read position moves, which keeps the divider off a call it saw (MessageList).
function readCallNotice(conversationId: string, noticeId: string, call: CallNotice, open: boolean) {
	const answered = callAnswers.take(conversationId);
	const me = get(currentUser)?.id;
	const seen = !!me && callNoticeSeen(call, me, answered);
	const positions = get(lastReadConvs);
	// The newest message known besides the notice, which can be newer: the API can post a notice late, and that message
	// may never have loaded here.
	const newest = newestBesidesNotice(noticeId, get(dmMessages)[conversationId] ?? [], newestKnownIn(conversationId));
	const read = readAfterCallNotice(
		{ unread: get(unreadConversations).has(conversationId), lastRead: positions?.[conversationId] },
		noticeId,
		seen,
		newest,
	);
	if (positions && read.lastRead !== undefined && read.lastRead !== positions[conversationId]) {
		lastReadConvs.set({ ...positions, [conversationId]: read.lastRead });
	}
	if (open) return;
	unreadConversations.update((s) => {
		if (read.unread) s.add(conversationId);
		else s.delete(conversationId);
		return s;
	});
	// Read, its mentions are too: the API counts only those after the read position.
	if (!read.unread && conversationId in get(mentionCounts)) {
		mentionCounts.update((all) => {
			const copy = { ...all };
			delete copy[conversationId];
			return copy;
		});
	}
}

// The user's own call in that conversation, if it was ringing the others, no longer does: someone answered it, or it
// ended.
function stopOwnCallRinging(conversationId: string) {
	ownCallsRinging.update((s) => {
		if (!s.has(conversationId)) return s;
		const next = new Set(s);
		next.delete(conversationId);
		return next;
	});
}

// The call in that conversation is over, or it is for the user, who left its group: whatever it rang, placed or connected
// here ends.
function callOver(conversationId: string) {
	if (pendingAccept?.conversationId === conversationId) pendingAccept = null;
	if (placedCall?.conversationId === conversationId) placedCall = null;
	conversationsWithCalls.update((s) => {
		s.delete(conversationId);
		return new Set(s);
	});
	stopOwnCallRinging(conversationId);
	callVoiceStates.update((states) => states.filter((s) => s.room_id !== conversationId));
	const current = get(activeCall);
	if (current && current.conversationId === conversationId) {
		// Only disconnect voice if still in this conversation's call, not a different voice channel
		if (get(activeVoiceRoomId) === conversationId) {
			activeVoiceRoomId.set(null);
		}
		activeCall.set(null);
		// The call's VoiceChat may already be gone (its connection failed): a camera or screen request it
		// didn't take goes with the call.
		dropVoiceRequests();
	}
}

/** The user left a group, or was removed from it, as the API answered or the gateway told (CONVERSATION_MEMBER_REMOVE):
 * it goes from the list, and its view and tabs with it (FriendsView, the page), and so does its unread dot, which nothing
 * could clear any more. Its call ends here at once, rather than when the gateway's CALL_ENDED comes: the group's view,
 * which has the call's controls, has gone. */
export function conversationLeft(conversationId: string) {
	conversations.update((list) => list.filter((c) => c.id !== conversationId));
	unreadConversations.update((s) => {
		s.delete(conversationId);
		return s;
	});
	// An answer kept there goes too: its call notices no longer reach them, and one would count for a later call's
	// if they came back.
	callAnswers.drop(conversationId);
	callOver(conversationId);
}

/** The session resumed: what the gateway got before the old socket dropped, it answered in the replay just handled.
 * What it didn't get was lost with that socket: VoiceChat joins again (RESUMED), and a CALL_INITIATE or a CALL_ACCEPT
 * goes again. */
function onResumed() {
	resendPlacedCall();
	resendCallAccept();
	webrtcListeners.forEach((cb) => {
		cb("RESUMED", {});
	});
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

/** The newest message the client has of a room, but one still being sent, which has its nonce for an id until its
 * MESSAGE_CREATE. */
function newestLoaded(roomId: string): string | undefined {
	return (get(channelMessages)[roomId] ?? [])
		.filter((m) => m.id !== m.nonce)
		.reduce<string | undefined>((max, m) => (max === undefined || m.id > max ? m.id : max), undefined);
}

/** Takes rooms' read states from the gateway (a ROOM_CREATE's, a SPACE_CREATE's) in place of what READY had of those
 * rooms: a newer message the client already has keeps its room unread (withRoomReadStates). */
function applyRoomReadStates(states: Record<string, RoomReadState>) {
	for (const [roomId, state] of Object.entries(states)) knowMessage(roomId, state.last_msg);
	const read = withRoomReadStates(
		{ unread: get(unreadChannels), lastRead: get(lastReadRooms), lastMsg: get(lastMsgRooms) },
		states,
		newestLoaded,
	);
	unreadChannels.set(read.unread);
	lastReadRooms.set(read.lastRead);
	lastMsgRooms.set(read.lastMsg);
}

/** A reply's reference once the message it quotes is deleted: only the reference itself stays,
 * as the API sends it from then on, and the reply shows the original as deleted. */
function deletedReference(ref: ReferencedMessage): ReferencedMessage {
	return {
		type: ref.type,
		message_id: ref.message_id,
		room_id: ref.room_id,
		space_id: ref.space_id,
		mention_author: ref.mention_author,
	};
}

/** A reaction event (REACTION_ADD, REACTION_REMOVE, and their DM_ ones) as the change it makes. */
function reactionChange(event: ReactionEvent, added: boolean): ReactionChange {
	const { message_id, user_id, emoji_name, emoji_id } = event;
	return { message_id, user_id, emoji_name, emoji_id, added };
}

/** One user's reaction added to a message or taken back: the message shows it in the list that has it, a room's or a
 * conversation's, and so does whatever else shows it (onReactionChange): a pin, a search result, who reacted. */
function applyReaction<T extends { id: string; reactions?: MessageReaction[] | null }>(
	messages: Writable<Record<string, T[]>>,
	change: ReactionChange,
) {
	messages.update((all) => {
		for (const [chatId, list] of Object.entries(all)) {
			const at = list.findIndex((m) => m.id === change.message_id);
			if (at < 0) continue;
			const message = { ...list[at], reactions: withReaction(list[at].reactions, change) };
			return { ...all, [chatId]: [...list.slice(0, at), message, ...list.slice(at + 1)] };
		}
		return all;
	});
	reactionChanged(change);
}

// Whether a room or a conversation is on screen: open in the focused pane, in a window that's visible and focused.
const roomOnScreen = (roomId: string) => roomId === get(activeTextRoomId) && get(pageVisible);
const conversationOnScreen = (conversationId: string) => conversationId === get(activeDMConvId) && get(pageVisible);

// The people a mention's text can name, by the names the app knows, as a bio's mentions are: the spaces' members, the
// conversations', and the user.
function knownPeople() {
	const me = get(currentUser);
	return [
		...get(gatewaySpaces).flatMap((s) => s.users),
		...get(conversations).flatMap((c) => c.members.flatMap((m) => m.user ?? [])),
		...(me ? [me] : []),
	];
}

/**
 * A mention in a room that isn't on screen shows a notice (lib/mention-notices.ts) with its message. The room's
 * MESSAGE_CREATE has usually brought it already, but it comes over another subscription, in no set order: one that isn't
 * there yet is fetched, by its IDs alone (isUuid), which go into the request's path. A message deleted first, which
 * the API no longer has, or one that can't be fetched, shows nothing, and so does one whose room came on screen
 * meanwhile, or whose reader chose do not disturb.
 */
async function noticeRoomMention(roomId: string, messageId: string) {
	let message = get(channelMessages)[roomId]?.find((m) => m.id === messageId);
	if (!message) {
		if (!isUuid(roomId) || !isUuid(messageId)) return;
		try {
			message = gatewayMessageToMessage(await getMessageById(roomId, messageId), get(gatewaySpaces));
		} catch {
			return;
		}
	}
	const place = roomPlace(get(gatewaySpaces), roomId, messageId);
	if (!place || !mentionSound(get(currentUser)?.status, roomOnScreen(roomId))) return;
	const emojis = get(spaceEmojis)[place.link.spaceId] ?? [];
	showMentionNotice(mentionNoticeOf(message, place, knownPeople(), customEmojiMapOf(emojis)));
}

/** A mention in a conversation that isn't on screen, as one in a room (noticeRoomMention). */
async function noticeConversationMention(conversationId: string, messageId: string) {
	let message = get(dmMessages)[conversationId]?.find((m) => m.id === messageId);
	if (!message) {
		if (!isUuid(conversationId) || !isUuid(messageId)) return;
		try {
			message = await getDirectMessageById(conversationId, messageId);
		} catch {
			return;
		}
	}
	if (!mentionSound(get(currentUser)?.status, conversationOnScreen(conversationId))) return;
	const conversation = get(conversations).find((c) => c.id === conversationId);
	const author = directMessageAuthor(message, conversation);
	const place = conversationPlace(conversation, conversationId, messageId, get(currentUser)?.id);
	const shown = { ...message, author_name: author.name, author_avatar_url: author.avatar };
	showMentionNotice(mentionNoticeOf(shown, place, knownPeople(), {}));
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
			// And the statuses, without those of whoever went offline meanwhile.
			userStatusCache.clear();
			unreadChannels.set(new Set(unread_rooms ?? []));
			lastReadRooms.set(payload.data.last_read_rooms ?? {});
			lastMsgRooms.set(payload.data.last_msg_rooms ?? {});
			const { unread_convs } = payload.data;
			unreadConversations.set(new Set(unread_convs ?? []));
			lastReadConvs.set(payload.data.last_read_convs ?? null);
			// Each room's and conversation's newest message, which a message being sent records (withPresent).
			for (const [roomId, id] of Object.entries(payload.data.last_msg_rooms ?? {})) knowMessage(roomId, id);
			for (const [convId, id] of Object.entries(payload.data.last_msg_convs ?? {})) knowMessage(convId, id);
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
					rememberFriendStatuses(friendList);
					friends.set(friendList);
					rememberConversationStatuses(convList);
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
			// The calls going on in the user's conversations, and who is in each, as the new session has them.
			const activeCalls = payload.data.active_calls ?? [];
			// A call it lists still ringing the user, they haven't answered: an answer kept there was to an earlier one.
			callAnswers.ready(activeCalls);
			conversationsWithCalls.set(new Set(activeCalls.map((c) => c.conversation_id)));
			ownCallsRinging.set(ownCallsRingingOnReady(activeCalls, user.id));
			for (const call of activeCalls) {
				for (const vs of call.voice_states ?? []) {
					noteVoiceStateVersion(call.conversation_id, vs.user_id, vs.version);
				}
			}
			callVoiceStates.set(activeCalls.flatMap((c) => callVoiceStatesOf(c.conversation_id, c.voice_states)));
			const ownCall = get(activeCall);
			const ownCallNow = callOnReady(ownCall, activeCalls, {
				silentMs: silenceBeforeLast,
				sentOnThisConnection: !!ownCall && sentOnThisConnection(ownCall.conversationId),
			});
			if (ownCall && ownCallNow === "end") {
				// The call this client is in is over when the new session doesn't list it: the gateway keeps calls in
				// memory, so its restart ends them.
				if (get(activeVoiceRoomId) === ownCall.conversationId) activeVoiceRoomId.set(null);
				activeCall.set(null);
				dropVoiceRequests();
			} else if (ownCall && ownCallNow === "keep") {
				// Placed or answered on this connection, which READY was built before the gateway got: the call stays.
				conversationsWithCalls.update((s) => new Set(s).add(ownCall.conversationId));
			} else if (ownCallNow === "dismiss") {
				// It rang here, and no longer rings the user: they answered or declined it on another device while this one
				// was away, or its ring window passed. Or this client was placing it, someone answered it meanwhile, and
				// the gateway was silent too long to join it now. It shows as a call going on, with Join.
				activeCall.set(null);
			} else if (ownCall && ownCallNow === "join") {
				// This client was placing it, and someone answered it while this client was away: it joins, as on the
				// CALL_ACCEPTED it missed.
				activeCall.update((c) => (c ? { ...c, state: "connected" } : c));
				activeVoiceRoomId.set(ownCall.conversationId);
			}
			// A call that still rings the user rings here too, with its caller as READY has them, unless this client shows
			// another one.
			const ringing = get(activeCall) ? null : callToRingOnReady(activeCalls);
			if (ringing) {
				activeCall.set({
					conversationId: ringing.conversation_id,
					initiatorId: ringing.initiator_id,
					initiatorName: ringing.initiator_name ?? "",
					initiatorAvatar: ringing.initiator_avatar ?? null,
					state: "ringing",
					memberIds: [],
				});
			}
			// The call this client places, if the new session lists it, is one the gateway has.
			for (const call of activeCalls) gatewayHasCall(call.conversation_id);
			// A CALL_ACCEPT the old session may never have got goes to this one, for a call that goes on.
			resendCallAccept();

			// The SPACE_CREATEs that follow bring the spaces again, as the new session has them (their voice states
			// included): one the user is no longer in doesn't come back.
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
			// member_statuses are keyed by userId: a bot's status in this space, anyone else's global status. A bot
			// whose shard holding the space is down is left out, and shows offline here. member_client_status has
			// the platforms of each of them.
			const memberStatuses = spaceCreateData.member_statuses;
			if (memberStatuses) {
				const clientStatuses = spaceCreateData.member_client_status;
				for (const [uid, status] of Object.entries(memberStatuses)) {
					noteMemberStatus(userStatusCache, uid, space.id, {
						status_id: status,
						client_status: clientStatuses?.[uid],
					});
				}
				// The DM list shows them too, and may have loaded before this space did.
				const me = currentUserData?.id;
				const hasMember = (c: { members: { user_id: string }[] }) =>
					c.members.some((m) => m.user_id !== me && m.user_id in memberStatuses);
				if (get(conversations).some(hasMember)) {
					conversations.update((convs) => convs.map((c) => (hasMember(c) ? { ...c } : c)));
				}
				// And so does the friends list.
				const isListed = (f: { sender_id: string; recipient_id: string }) =>
					[f.sender_id, f.recipient_id].some((id) => id !== me && id in memberStatuses);
				if (get(friends).some(isListed)) {
					friends.update((all) => all.map((f) => (isListed(f) ? { ...f } : f)));
				}
			}

			// A later one of a space replaces the earlier one: the gateway goes by the last it sent.
			gatewaySpaces.update((spaces) => withSpaceCreate(spaces, space));
			for (const vs of space.voice_states ?? []) noteVoiceStateVersion(vs.room_id, vs.user_id, vs.version);

			// The read states of its rooms, in one sent after READY: the unread marks of a space the user just joined.
			if (spaceCreateData.read_states) applyRoomReadStates(spaceCreateData.read_states);

			// Only READY's spaces count: one it didn't list, or a second of one, mustn't pass for one still to come.
			receivedGuildIds.add(space.id);
			if (expectedGuildIds && readySpacesArrived(expectedGuildIds, receivedGuildIds)) {
				allSpacesReady.set(true);
			}
			break;
		}
		case "SPACE_DELETE": {
			const { id } = payload.data;
			gatewaySpaces.update((spaces) => spaces.filter((s) => s.id !== id));
			// Its members' statuses there go with it: a bot's would outlive it otherwise.
			forgetSpaceStatuses(userStatusCache, id);
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
			// The read state is the user's, not the room's: the space keeps the room without it.
			const { read_state: readState, ...room } = payload.data;
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
			if (readState) applyRoomReadStates({ [room.id]: readState });
			break;
		}
		case "MESSAGE_CREATE": {
			const raw = payload.data;
			const roomId = raw.room_id;
			if (!roomId) break;
			knowMessage(roomId, raw.id);
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

				// If it matches a pending message by nonce, replace it. A page that listed the message meanwhile (the newest
				// one, as a send takes a jump's list to the present) has a copy without the nonce: that one goes.
				if (message.nonce) {
					const pendingIndex = existing.findIndex((m) => m.nonce === message.nonce);
					if (pendingIndex !== -1) {
						const newMessages = existing.flatMap((m, i) =>
							i === pendingIndex ? [message] : m.id === message.id ? [] : [m],
						);
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
			// A message this window cancelled, which the API posted all the same: what the Cancel put back in the room's
			// draft leaves it, and a notice says so.
			if (raw.nonce && raw.author_id === get(currentUser)?.id && takeBack(roomId, raw.nonce)) toast(SENT_BEFORE_CANCEL);
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
			dropReplyTo(raw.room_id, raw.id);
			dropMentionNotice(raw.id);
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
			const { room_id, message_id } = payload.data;
			mentionCounts.update((all) => ({ ...all, [room_id]: (all[room_id] ?? 0) + 1 }));
			if (mentionSound(get(currentUser)?.status, roomOnScreen(room_id))) {
				audioStore.play("notification");
				void noticeRoomMention(room_id, message_id);
			}
			break;
		}
		case "DM_MENTION_CREATE": {
			const { conversation_id, message_id } = payload.data;
			mentionCounts.update((all) => ({ ...all, [conversation_id]: (all[conversation_id] ?? 0) + 1 }));
			if (mentionSound(get(currentUser)?.status, conversationOnScreen(conversation_id))) {
				audioStore.play("notification");
				void noticeConversationMention(conversation_id, message_id);
			}
			break;
		}
		case "USER_UPDATE": {
			const raw = payload.data;
			// An API from before bios sends no custom: the one shown stays.
			const bio = raw.custom === undefined ? {} : { custom: raw.custom };
			const patch: Record<string, any> = {
				username: raw.username,
				alias: raw.alias,
				avatar: raw.avatar,
				banner: raw.banner,
				flags: raw.flags,
				badges: raw.badges,
				...bio,
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
										...bio,
									},
								}
							: m,
					),
				})),
			);
			// The friends list and the friend requests show the user too: friends get it, space in common or not.
			const me = get(currentUser)?.id;
			friends.update((list) => withUserUpdate(list, raw, me));
			pendingFriendRequests.update((list) => withUserUpdate(list, raw, me));
			sentFriendRequests.update((list) => withUserUpdate(list, raw, me));
			break;
		}
		case "USER_STATUS_UPDATE": {
			const raw = payload.data;
			// The status and the platforms the user is on. One with a space_id is a bot's status in that space (its
			// shard's): its other spaces and its global status keep theirs.
			applyStatusUpdate(userStatusCache, raw);
			if (raw.status_id === 0) {
				if (!raw.space_id && raw.user_id in get(userActivities)) {
					// Gone offline: the gateway dropped their activities too, which would show here otherwise.
					userActivities.update((all) => {
						const next = { ...all };
						delete next[raw.user_id];
						return next;
					});
				}
			} else {
				// Our own while we're connected is the status we chose, here or in another session.
				const me = get(currentUser);
				if (!raw.space_id && me?.id === raw.user_id && me.status !== raw.status_id) {
					currentUser.set({ ...me, status: raw.status_id });
				}
			}
			// Create new object references for affected spaces so Svelte detects the change
			gatewaySpaces.update((spaces) => spaces.map((s) => (s.users.some((u) => u.id === raw.user_id) ? { ...s } : s)));
			conversations.update((convs) =>
				convs.map((c) => (c.members.some((m) => m.user_id === raw.user_id) ? { ...c } : c)),
			);
			friends.update((all) =>
				all.map((f) => (f.sender_id === raw.user_id || f.recipient_id === raw.user_id ? { ...f } : f)),
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

			// Who is in each call the user knows of: the call this client shows, and those going on without it, which
			// their conversation shows with who is in them. Joins and leaves sound only in the call this client shows.
			const inShownCall = get(activeCall)?.conversationId === raw.room_id;
			if (inShownCall || get(conversationsWithCalls).has(raw.room_id)) {
				const states = get(callVoiceStates);
				if (inShownCall && raw.user_id !== get(currentUser)?.id) {
					const wasIn = states.some((s) => s.user_id === raw.user_id && s.room_id === raw.room_id);
					if (!raw.joined) audioStore.play("leave_vc");
					else if (!wasIn) audioStore.play("join_vc");
				}
				callVoiceStates.set(withCallVoiceState(states, raw));
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
				toast(voiceEndedNotice(payload.data), payload.data.reason ? "error" : "info");
				activeVoiceRoomId.set(null);
				// A call's voice that moved to another device takes the call there: this client is out of it, and can
				// join it again from its conversation, which shows who is in it, the user too. Its camera or screen
				// request goes with it, as when a call ends.
				if (get(activeCall)?.conversationId === room_id) {
					activeCall.set(null);
					dropVoiceRequests();
				}
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
						roles: withCreatedRole(s.roles, role),
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
			// A bot's is its status in this space alone: offline until a USER_STATUS_UPDATE says a shard of it holds
			// the space.
			noteMemberStatus(userStatusCache, raw.user_id, raw.space_id, raw, raw.user?.is_bot);
			// The member may be a bot, whose commands the space's list doesn't have yet.
			forgetSpaceCommands(raw.space_id);
			getSpaceMembers(raw.space_id)
				.then((rows) => addMembersToSpace(raw.space_id, rows))
				.catch((err) => console.error("[WS] Failed to refresh members after join:", err));
			break;
		}
		case "SPACE_MEMBER_REMOVE": {
			const raw = payload.data;
			forgetMemberStatus(userStatusCache, raw.user_id, raw.space_id);
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
					return spaceWithoutRoom(s, raw.id);
				}),
			);
			// Its loaded messages go too: given back, it loads what it missed (PaneView reloads it if it's on screen).
			channelMessages.update((all) => withoutRoomMessages(all, raw.id));
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
		case "REACTION_ADD":
			applyReaction(channelMessages, reactionChange(payload.data, true));
			break;
		case "REACTION_REMOVE":
			applyReaction(channelMessages, reactionChange(payload.data, false));
			break;
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
				.then((list) => {
					rememberFriendStatuses(list);
					friends.set(list);
				})
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
			// Each member with their presence, which their changes keep from now on: in a group, someone who is neither the
			// user's friend nor in a space with them.
			const me = get(currentUser)?.id;
			for (const m of conv.members) if (m.user_id !== me) noteConversationMemberStatus(userStatusCache, m.user_id, m);
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
			// The user was added to a group: the event says who joined, not what the group is, so it comes from the
			// conversations list, as READY loads it.
			if (raw.user_id === get(currentUser)?.id && !get(conversations).some((c) => c.id === raw.conversation_id)) {
				getConversations()
					.then((list) => {
						const conv = list.find((c) => c.id === raw.conversation_id);
						if (!conv) return;
						// Its members' presences, for those the gateway hasn't told us about.
						rememberConversationStatuses([conv]);
						conversations.update((all) => (all.some((c) => c.id === conv.id) ? all : [conv, ...all]));
					})
					.catch((err) => console.error("[WS] Failed to load the group the user was added to:", err));
				break;
			}
			// The member's presence, which their changes keep from now on: they may be neither the user's friend nor in a
			// space with them.
			if (raw.user_id !== get(currentUser)?.id) noteConversationMemberStatus(userStatusCache, raw.user_id, raw);
			conversations.update((list) =>
				list.map((c) => {
					if (c.id !== raw.conversation_id) return c;
					const alreadyHas = c.members.some((m) => m.id === raw.member_id || m.user_id === raw.user_id);
					// Shown again with the presence just kept.
					if (alreadyHas) return { ...c };
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
			if (raw.user_id === get(currentUser)?.id) {
				conversationLeft(raw.conversation_id);
				break;
			}
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
			knowMessage(conversationId, msg.id);
			const isActiveConv = conversationId === get(activeDMConvId);
			if (msg.type === MessageType.Call && msg.call) {
				readCallNotice(conversationId, msg.id, msg.call, isActiveConv);
			} else if (!isActiveConv) {
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
						// And a page's copy of it listed meanwhile goes (see MESSAGE_CREATE).
						const updated = existing.flatMap((m, i) => (i === pendingIdx ? [msg] : m.id === msg.id ? [] : [m]));
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
			// As a room's (MESSAGE_CREATE): a message this window cancelled, which the API posted all the same.
			if (msg.nonce && msg.author_id === get(currentUser)?.id && takeBack(conversationId, msg.nonce)) {
				toast(SENT_BEFORE_CANCEL);
			}
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
			dropReplyTo(raw.conversation_id, raw.id);
			dropMentionNotice(raw.id);
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
		case "DM_REACTION_ADD":
			applyReaction(dmMessages, reactionChange(payload.data, true));
			break;
		case "DM_REACTION_REMOVE":
			applyReaction(dmMessages, reactionChange(payload.data, false));
			break;
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
			// A new call: an answer of the user's heard before was to an earlier one.
			callAnswers.drop(d.conversation_id);
			// Track that this conversation has an active call
			conversationsWithCalls.update((s) => {
				s.add(d.conversation_id);
				return new Set(s);
			});
			const missed = missedCallNotice(get(activeCall), d);
			if (missed) toast(missed);
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
		case "CALL_OUTGOING": {
			// The user started a call, on this device or another: it rings none of theirs. The others show it as calling
			// from another device, without Join or the call button, while it rings the others (ownCallsRinging); the one
			// placing it learns the gateway has it.
			const { conversation_id } = payload.data;
			conversationsWithCalls.update((s) => new Set(s).add(conversation_id));
			ownCallsRinging.update((s) => new Set(s).add(conversation_id));
			gatewayHasCall(conversation_id);
			break;
		}
		case "CALL_ONGOING": {
			// A call goes on without ringing the user: its ring window passed before they answered it, or they joined the
			// group during it. It stops ringing here, and shows going on, with who is in it, for the user to join.
			const d = payload.data;
			conversationsWithCalls.update((s) => new Set(s).add(d.conversation_id));
			for (const vs of d.voice_states ?? []) noteVoiceStateVersion(d.conversation_id, vs.user_id, vs.version);
			callVoiceStates.update((states) => [
				...states.filter((s) => s.room_id !== d.conversation_id),
				...callVoiceStatesOf(d.conversation_id, d.voice_states),
			]);
			if (callOngoingAction(get(activeCall), d) === "dismiss") activeCall.set(null);
			break;
		}
		case "CALL_ACCEPTED": {
			const d = payload.data;
			const me = get(currentUser)?.id;
			// The user answered it, here or on another device: its notice leaves the conversation read for them.
			if (d.user_id === me) callAnswers.answered(d.conversation_id);
			// The gateway got this user's CALL_ACCEPT.
			if (d.user_id === me && pendingAccept?.conversationId === d.conversation_id) pendingAccept = null;
			// Someone answered the call, or its caller joined it again once someone had: if it's the user's own, its Join
			// shows on their other devices.
			stopOwnCallRinging(d.conversation_id);
			// Every member's sessions get it, whoever answered: the call this client placed joins, and one ringing here
			// that the user answered on another device goes.
			const action = callAcceptedAction(get(activeCall), d, me);
			if (action === "join") {
				activeCall.update((c) => (c ? { ...c, state: "connected" } : c));
				// Start VoiceChat with conversation_id as room
				activeVoiceRoomId.set(d.conversation_id);
			} else if (action === "dismiss") {
				activeCall.set(null);
			}
			break;
		}
		case "CALL_DECLINED": {
			// The gateway tells the caller, and every session of whoever declined: a call ringing here that the user
			// declined on another device stops. The call ends once everyone it rang declined it (CALL_ENDED).
			const d = payload.data;
			gatewayHasCall(d.conversation_id);
			// Declining it is answering it too (decision 143): its notice leaves the conversation read for them.
			if (d.user_id === get(currentUser)?.id) callAnswers.answered(d.conversation_id);
			const declined = callDeclinedNotice(
				get(activeCall),
				d,
				get(currentUser)?.id,
				get(conversations).find((c) => c.id === d.conversation_id)?.members,
			);
			if (declined) toast(declined);
			if (callDeclinedAction(get(activeCall), d, get(currentUser)?.id) === "dismiss") activeCall.set(null);
			break;
		}
		case "CALL_ENDED": {
			callOver(payload.data.conversation_id);
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
		// Set while this connection asked to resume and doesn't know yet whether it did.
		let resumeProbe = false;

		socket.onopen = () => {
			if (import.meta.env.DEV) console.log("[WS] Connected");
			reconnectAttempts = 0;
			const identify = identifyData(
				localStorage.getItem("duvet_session_token"),
				lastSeq > 0 && !freshSessionWanted ? { lastSeq, sessionToken: get(wsSessionToken) } : null,
			);
			connectionCount++;
			socket.send(JSON.stringify({ type: "identify", data: identify }));
			// Asking to resume, the client learns that it did from this heartbeat's answer, which the gateway queues
			// behind the session's replay; a session that can't resume sends READY before it.
			if (identify.session_token) {
				resumeProbe = true;
				socket.send(JSON.stringify({ type: "heartbeat", data: {} }));
			}
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
					// No READY before it: the session resumed, and its replay has been handled.
					if (resumeProbe) {
						resumeProbe = false;
						onResumed();
					}
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
					// The session couldn't resume: it's a new one, which READY tells the app about.
					if (msg.d?.type === "READY") resumeProbe = false;
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
