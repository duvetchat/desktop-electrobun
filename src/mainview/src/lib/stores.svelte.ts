import { SvelteSet } from "svelte/reactivity";
import { writable, type Writable } from "svelte/store";

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

function getSafeStorage(): SafeStorage | null {
	const candidate =
		typeof globalThis !== "undefined" ? ((globalThis as { localStorage?: unknown }).localStorage ?? null) : null;

	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const maybeStorage = candidate as Partial<Storage>;
	if (
		typeof maybeStorage.getItem !== "function" ||
		typeof maybeStorage.setItem !== "function" ||
		typeof maybeStorage.removeItem !== "function"
	) {
		return null;
	}

	return maybeStorage as SafeStorage;
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
export const mentionCounts = writable<Record<string, number>>({});

export const unreadConversations = writable<Set<string>>(new Set());
export const activeDMConvId = writable<string | null>(null);

export const jumpToMessageRequest = writable<{
	id: string; // unique request id to prevent duplicate handling
	spaceId: string;
	roomId: string;
	messageId: string;
	conversationId?: string;
} | null>(null);

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

export interface CallVoiceState {
	room_id: string;
	user_id: string;
	muted?: boolean;
	deafened?: boolean;
	screen_sharing?: boolean;
}
export const callVoiceStates = writable<CallVoiceState[]>([]);

export const isMuted = writable<boolean>(false);
export const isDeafened = writable<boolean>(false);
export const activeVoiceRoomId = writable<string | null>(null);
export const voiceConnectionState = writable<RTCPeerConnectionState>("new");
export const screenShareRequested = writable<{ active: boolean; withAudio: boolean }>({
	active: false,
	withAudio: false,
});
export const voiceRemoteVideoStreams = writable<Record<string, MediaStream>>({});
export const voiceLocalVideoStream = writable<MediaStream | null>(null);
export const isScreenSharing = writable<boolean>(false);

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

// Signal from connection.ts when all SPACE_CREATE events have been received
export const allSpacesReady = writable(false);
