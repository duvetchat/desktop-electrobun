import { SvelteSet } from "svelte/reactivity";
import { writable } from "svelte/store";

import type { GatewaySpace, GatewayUser, Message } from "$lib/types";
import type { FriendRequest, Friend } from "$lib/api/friends";
import type { Conversation, DirectMessage } from "$lib/api/conversations";

const SESSION_KEY = "duvet_session_token";

type SafeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getSafeStorage(): SafeStorage | null {
	const candidate =
		typeof globalThis !== "undefined"
			? ((globalThis as { localStorage?: unknown }).localStorage ?? null)
			: null;

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
export const channelMessages = writable<Record<string, Message[]>>({});
export const speakingUsers = writable<SvelteSet<string>>(new SvelteSet());

export const pendingFriendRequests = writable<FriendRequest[]>([]);
export const sentFriendRequests = writable<FriendRequest[]>([]);
export const friends = writable<Friend[]>([]);
export const friendsReady = writable<boolean>(false);

export const conversations = writable<Conversation[]>([]);
export const dmMessages = writable<Record<string, DirectMessage[]>>({});

export interface TypingUser {
	user_id: string;
	username: string;
	alias: string | null;
	avatar: string | null;
	timestamp: number;
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
} | null>(null);

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
export const screenShareRequested = writable<boolean>(false);
export const voiceRemoteVideoStreams = writable<Record<string, MediaStream>>({});
export const voiceLocalVideoStream = writable<MediaStream | null>(null);
export const isScreenSharing = writable<boolean>(false);

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
