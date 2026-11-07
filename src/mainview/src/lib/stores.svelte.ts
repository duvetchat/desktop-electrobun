import { SvelteSet } from "svelte/reactivity";
import { get, readable, writable, type Readable, type Writable } from "svelte/store";

import { canViewRoom, roomNamesOf } from "$lib/permissions";
import { typersAt } from "$lib/typing";
import type { GatewaySpace, GatewayUser, Message, SpaceEmoji, SpaceSticker } from "$lib/types";
import type { FriendRequest, Friend } from "$lib/api/friends";
import type { Conversation, DirectMessage } from "$lib/api/conversations";
import type { TeamInvite } from "$lib/api/developer";
import type { StorageBucket } from "$lib/api/user";

const MAX_CACHED_CHANNELS = 50;

function createEvictingMessageStore<T>(): Writable<Record<string, T[]>> {
	const channelAccess: string[] = [];
	const inner = writable<Record<string, T[]>>({});

	function touchChannels(data: Record<string, T[]>) {
		for (const key of Object.keys(data)) {
			const idx = channelAccess.indexOf(key);
			if (idx > -1) channelAccess.splice(idx, 1);
			channelAccess.push(key);
		}
	}

	function evict(data: Record<string, T[]>): Record<string, T[]> {
		if (channelAccess.length <= MAX_CACHED_CHANNELS) return data;
		const toEvict = channelAccess.splice(0, channelAccess.length - MAX_CACHED_CHANNELS);
		const result = { ...data };
		for (const key of toEvict) {
			delete result[key];
		}
		return result;
	}

	return {
		subscribe: inner.subscribe,
		set(value: Record<string, T[]>) {
			touchChannels(value);
			inner.set(evict(value));
		},
		update(fn: (value: Record<string, T[]>) => Record<string, T[]>) {
			inner.update((current) => {
				const next = fn(current);
				touchChannels(next);
				return evict(next);
			});
		},
	};
}

const SESSION_KEY = "duvet_session_token";

type SafeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isSafeStorage(candidate: unknown): candidate is SafeStorage {
	return (
		typeof candidate === "object" &&
		candidate !== null &&
		"getItem" in candidate &&
		typeof candidate.getItem === "function" &&
		"setItem" in candidate &&
		typeof candidate.setItem === "function" &&
		"removeItem" in candidate &&
		typeof candidate.removeItem === "function"
	);
}

function getSafeStorage(): SafeStorage | null {
	const candidate =
		typeof globalThis !== "undefined" ? (globalThis as { localStorage?: unknown }).localStorage : undefined;
	return isSafeStorage(candidate) ? candidate : null;
}

function createUserSession() {
	const storage = getSafeStorage();
	let token = $state<string | null>(storage?.getItem(SESSION_KEY) ?? null);

	return {
		get token() {
			return token;
		},
		set token(value: string | null) {
			token = value;
			if (!storage) {
				return;
			}
			if (value === null) {
				storage.removeItem(SESSION_KEY);
			} else {
				storage.setItem(SESSION_KEY, value);
			}
		},
	};
}

export const userSession = createUserSession();

export const gatewaySpaces = writable<GatewaySpace[]>([]);
/**
 * The name a mention of each room shows (roomNamesOf the user's spaces). It changes only when one of them does, not with
 * every change of a space (someone's presence), which would render every message's text again.
 */
export const roomNames = readable<Record<string, string>>({}, (set) => {
	let last: Record<string, string> = {};
	return gatewaySpaces.subscribe((spaces) => {
		const next = roomNamesOf(spaces);
		const ids = Object.keys(next);
		if (ids.length === Object.keys(last).length && ids.every((id) => last[id] === next[id])) return;
		last = next;
		set(next);
	});
});
export const currentUser = writable<GatewayUser | null>(null);
export const wsSessionToken = writable<string | null>(null);
// ICE servers for voice peer connections; READY replaces them with the gateway's own list.
export const iceServers = writable<RTCIceServer[]>([{ urls: "stun:stun.l.google.com:19302" }]);
export const channelMessages = createEvictingMessageStore<Message>();
// The ephemeral messages bots sent this user, by room: only this user sees them, and they aren't the room's
// history, so they stay apart from it, in this window, until dismissed or the app reloads.
export const ephemeralMessages = writable<Record<string, Message[]>>({});

/** Adds an ephemeral message, or replaces the one with its ID. */
export function keepEphemeral(roomId: string, message: Message) {
	ephemeralMessages.update((all) => ({
		...all,
		[roomId]: [...(all[roomId] ?? []).filter((m) => m.id !== message.id), message],
	}));
}

/** Removes an ephemeral message: its bot deleted it, or the user dismissed it, for this window. */
export function dropEphemeral(roomId: string, messageId: string) {
	ephemeralMessages.update((all) => {
		const list = all[roomId];
		if (!list?.some((m) => m.id === messageId)) return all;
		return { ...all, [roomId]: list.filter((m) => m.id !== messageId) };
	});
}
export const speakingUsers = writable<SvelteSet<string>>(new SvelteSet());
export const userAmplitudes = writable<Record<string, number>>({});
export interface UserActivity {
	/** 0 (or none) playing, 2 listening: Spotify's, as the desktop app shares it (lib/activity.ts). */
	type?: number;
	name: string;
	details?: string;
	state?: string;
	timestamps?: { start?: number; end?: number };
	assets?: {
		large_image?: string;
		large_text?: string;
		small_image?: string;
		small_text?: string;
	};
}
export const userActivities = writable<Record<string, UserActivity[]>>({});
export const spaceEmojis = writable<Record<string, SpaceEmoji[]>>({});
export const spaceStickers = writable<Record<string, SpaceSticker[]>>({});

export const pendingFriendRequests = writable<FriendRequest[]>([]);
export const sentFriendRequests = writable<FriendRequest[]>([]);
export const friends = writable<Friend[]>([]);
export const friendsReady = writable<boolean>(false);

export const conversations = writable<Conversation[]>([]);
export const dmMessages = createEvictingMessageStore<DirectMessage>();
export const pendingTeamInvites = writable<TeamInvite[]>([]);
export const botInviteRequest = writable<string | null>(null);
export const spaceInviteRequest = writable<string | null>(null);
export const myBuckets = writable<StorageBucket[]>([]);

export interface TypingUser {
	user_id: string;
	username: string;
	alias: string | null;
	avatar: string | null;
	timestamp: number;
	/** Recording a voice message rather than typing. */
	recording?: boolean;
}

// key = roomId or conversationId
export const typingUsers = writable<Record<string, TypingUser[]>>({});
/**
 * Who shows as typing or recording in each chat right now, for the rows and tabs of chats that may not be open: the
 * user aside, and each only until their notice gets old (typersAt), which no event says.
 */
export const typingNow = readable<Record<string, TypingUser[]>>({}, (set) => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	function update() {
		clearTimeout(timer);
		const now = Date.now();
		const { typers, nextEnd } = typersAt(get(typingUsers), get(currentUser)?.id, now);
		set(typers);
		if (nextEnd !== null) timer = setTimeout(update, nextEnd - now);
	}
	const stopNotices = typingUsers.subscribe(update);
	const stopUser = currentUser.subscribe(update);
	return () => {
		clearTimeout(timer);
		stopNotices();
		stopUser();
	};
});

export const unreadChannels = writable<Set<string>>(new Set());
export const activeTextRoomId = writable<string | null>(null);

// Page visibility — true when the tab is visible AND the window is focused.
export const pageVisible = writable<boolean>(
	typeof document !== "undefined" ? document.visibilityState === "visible" && document.hasFocus() : true,
);
if (typeof document !== "undefined") {
	function updatePageVisible() {
		pageVisible.set(document.visibilityState === "visible" && document.hasFocus());
	}
	document.addEventListener("visibilitychange", updatePageVisible);
	window.addEventListener("focus", updatePageVisible);
	window.addEventListener("blur", updatePageVisible);
}
export const lastReadRooms = writable<Record<string, string>>({});
export const lastMsgRooms = writable<Record<string, string>>({});
// Each conversation's read position: READY's (last_read_convs) and this session's acks. Null when READY had none (an
// older gateway), so that a conversation missing from it can't pass for one never read.
export const lastReadConvs = writable<Record<string, string> | null>(null);
export const mentionCounts = writable<Record<string, number>>({});

export const unreadConversations = writable<Set<string>>(new Set());
export const activeDMConvId = writable<string | null>(null);

export const jumpToMessageRequest = writable<{
	id: string; // unique request id to prevent duplicate handling
	spaceId: string;
	roomId: string;
	/** Without one, the room only opens. */
	messageId?: string;
	conversationId?: string;
} | null>(null);

/**
 * A click on a room's mention in a message, which markdown gives the room's ID only when the user can view it, opens
 * that room in the focused pane. The click goes no further, so a quote or a search result around the mention doesn't
 * act on it too.
 */
export function openRoomMention(e: MouseEvent) {
	const mention = e.target instanceof Element ? e.target.closest(".msg-room-mention[data-room-id]") : null;
	if (!(mention instanceof HTMLElement)) return;
	e.preventDefault();
	e.stopPropagation();
	const roomId = mention.dataset.roomId;
	const space = get(gatewaySpaces).find((s) => s.rooms.some((r) => r.id === roomId));
	const room = space?.rooms.find((r) => r.id === roomId);
	// Gone, or out of sight, since the message was drawn.
	if (!space || !room || !canViewRoom(space, room)) return;
	jumpToMessageRequest.set({ id: crypto.randomUUID(), spaceId: space.id, roomId: room.id });
}

/**
 * Hears each request to open something elsewhere: a jump to a message or a room, a space's invite, a bot's. What shows
 * messages over the chat (the pins list, a thread) closes on one, which a message in it can make (a reply's quote, a
 * link's chip or card), as it would cover what opens. Returns what stops hearing them.
 */
export function onOpenElsewhere(listener: () => void): () => void {
	const requests: Readable<unknown>[] = [jumpToMessageRequest, spaceInviteRequest, botInviteRequest];
	const stops = requests.map((request) =>
		request.subscribe((value) => {
			if (value) listener();
		}),
	);
	return () => {
		for (const stop of stops) stop();
	};
}

/** The last pin or unpin of a message, so the open pins panel of its room or conversation reloads. */
export const pinUpdates = writable<{ channelId: string; messageId: string } | null>(null);

/** Asks the pins panel of a room or conversation to open, as a pin notice's link does. */
export const pinsPanelRequest = writable<{ id: string; channelId: string } | null>(null);

export type CallState = "idle" | "calling" | "ringing" | "connected";

export interface ActiveCallInfo {
	conversationId: string;
	initiatorId: string;
	initiatorName: string;
	initiatorAvatar: string | null;
	state: CallState;
	memberIds: string[];
}

export const activeCall = writable<ActiveCallInfo | null>(null);
// Set of conversation IDs that have an active call (even if I'm not in it)
export const conversationsWithCalls = writable<Set<string>>(new Set());
/** The conversations whose call is the user's own and still rings the others, nobody having answered it: the user's
 * other devices show it as calling from another device, without Join or the call button, until someone does. */
export const ownCallsRinging = writable<Set<string>>(new Set());

export interface CallVoiceState {
	room_id: string;
	user_id: string;
	muted?: boolean;
	deafened?: boolean;
	screen_sharing?: boolean;
	camera?: boolean;
}
/** Who is in the voice of each call going on that this client knows of (conversationsWithCalls), whether or not it's
 * in it, by room_id, the call's conversation: from READY and CALL_ONGOING, kept up with VOICE_STATE_UPDATE, and
 * dropped when the call ends. */
export const callVoiceStates = writable<CallVoiceState[]>([]);

export const isMuted = writable<boolean>(false);
export const isDeafened = writable<boolean>(false);
export const activeVoiceRoomId = writable<string | null>(null);
export const voiceConnectionState = writable<RTCPeerConnectionState>("new");
/** Asks VoiceChat to share the screen, or to stop sharing it, in a room or call (its ID): only the VoiceChat of
 * that room or call acts on it. */
export const screenShareRequested = writable<{ roomId: string; withAudio: boolean } | null>(null);
/** Screens being shared, by user ID: each user's `<user_id>` stream, which also carries their voice. */
export const voiceRemoteVideoStreams = writable<Record<string, MediaStream>>({});
/** The screen this client shares. */
export const voiceLocalVideoStream = writable<MediaStream | null>(null);
export const isScreenSharing = writable<boolean>(false);
/** This client's camera is on: its track goes out on the camera transceiver. */
export const isCameraOn = writable<boolean>(false);
/** Asks VoiceChat to turn the camera on or off in a room or call (its ID), as screenShareRequested does for the
 * screen. Only the VoiceChat of that room or call acts on it, and any other drops it: a request no VoiceChat took
 * must never turn the camera on in the next room or call. */
export const cameraRequested = writable<{ roomId: string; on: boolean } | null>(null);
/** Whether to receive others' video (cameras and screens). Off, the gateway sends none (`video_off`). */
export const incomingVideo = writable<boolean>(true);
/** The camera this client captures. */
export const voiceLocalCameraStream = writable<MediaStream | null>(null);
/** Others' cameras, by user ID: the `<user_id>.camera` streams. */
export const voiceRemoteCameraStreams = writable<Record<string, MediaStream>>({});

/** Drops the camera and screen requests no VoiceChat took, those of a room or call that's over. */
export function dropVoiceRequests() {
	cameraRequested.set(null);
	screenShareRequested.set(null);
}

const safeStorageNs = typeof window !== "undefined" ? localStorage : null;
export const noiseSuppression = writable<boolean>(safeStorageNs?.getItem("duvet_noise_suppression") !== "false");
noiseSuppression.subscribe((v) => {
	safeStorageNs?.setItem("duvet_noise_suppression", String(v));
});

/** Voice tiles show everyone's animated face, even those who have an avatar. */
export const voiceFaces = writable<boolean>(safeStorageNs?.getItem("duvet_voice_faces") === "true");
voiceFaces.subscribe((v) => {
	safeStorageNs?.setItem("duvet_voice_faces", String(v));
});

/** The desktop app shares what Spotify plays on this computer as the user's activity; on unless turned off. */
export const shareSpotify = writable<boolean>(safeStorageNs?.getItem("duvet_share_spotify") !== "false");
shareSpotify.subscribe((v) => {
	safeStorageNs?.setItem("duvet_share_spotify", String(v));
});

let initialMicId = "";
const safeStorage = getSafeStorage();
if (safeStorage) {
	initialMicId = safeStorage.getItem("duvet_mic_id") || "";
}
export const selectedMicId = writable<string>(initialMicId);

if (safeStorage) {
	selectedMicId.subscribe((value) => {
		if (value) {
			safeStorage.setItem("duvet_mic_id", value);
		}
	});
}

/** The camera picked in the camera menu; empty is the system's default. */
export const selectedCameraId = writable<string>(safeStorage?.getItem("duvet_camera_id") || "");
if (safeStorage) {
	selectedCameraId.subscribe((value) => {
		if (value) {
			safeStorage.setItem("duvet_camera_id", value);
		}
	});
}

// Signal from connection.ts when all SPACE_CREATE events have been received
export const allSpacesReady = writable(false);
