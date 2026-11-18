import { SvelteSet } from "svelte/reactivity";
import { derived, get, readable, writable, type Readable, type Writable } from "svelte/store";

import { canViewRoom, roomNamesOf } from "$lib/permissions";
import { TYPING_TIMEOUT, typersAt } from "$lib/typing";
import { customEmojiMapOf, type CustomEmojiMap } from "$lib/markdown";
import type {
	GatewaySpace,
	GatewayUser,
	MemberOnSidebar,
	Message,
	MessageReaction,
	SpaceEmoji,
	SpaceSticker,
} from "$lib/types";
import type { FriendRequest, Friend } from "$lib/api/friends";
import type { Conversation, DirectMessage } from "$lib/api/conversations";
import type { TeamInvite } from "$lib/api/developer";
import type { StorageBucket } from "$lib/api/user";

const MAX_CACHED_CHANNELS = 50;

/** The messages of a page the API gives, which a list is cut back to (#326). */
export const MESSAGE_PAGE = 100;
/** How many messages a list keeps on screen while its reader is at its bottom, before it's cut back to its newest page. */
export const LIST_ON_SCREEN_MAX = 200;

type Listed = { id: string; nonce?: string | null };

/** A list cut to its newest page: its newest MESSAGE_PAGE messages by ID, in its order, and those being sent (their ID is
 * their nonce). One of a page or less is returned as it is. */
export function newestPage<T extends Listed>(list: T[]): T[] {
	const sent = list.flatMap((m) => (m.id === m.nonce ? [] : [m.id])).sort();
	if (sent.length <= MESSAGE_PAGE) return list;
	const oldestKept = sent[sent.length - MESSAGE_PAGE]!;
	return list.filter((m) => m.id === m.nonce || m.id >= oldestKept);
}

/** The message lists of chats, by chat. Their views hold the lists they show (keep). */
export interface MessageListsStore<T> extends Writable<Record<string, T[]>> {
	/** Holds a chat's list until the function it returns is called: the store never drops a list a view holds, and the
	 * view's letting go of it counts as its last use. */
	keep(chat: string): () => void;
	/** Whether a view holds a chat's list: a live message goes only into those and the lists the store has (#326). */
	holds(chat: string): boolean;
	/** Cuts a chat's list back to its newest page when it holds more than `past` messages and no view holds it but the
	 * one asking: the older ones load again from the API. Tells onTrim's listeners, and says whether it cut. */
	trim(chat: string, past: number): boolean;
	/** Hears each list cut back, by its chat: a view that had that chat's start loaded has older messages to load again. */
	onTrim(listener: (chat: string) => void): () => void;
}

/**
 * Message lists that keep those of MAX_CACHED_CHANNELS chats at most: past that, the lists used least recently go, a
 * list's use being its last change or the last view that let go of it, never a list a view holds. A change marks only
 * the lists it changed (#320: every change marked every list, in the order the chats came in, so the store dropped
 * the lists it had seen first, the one on screen among them). A list no view holds goes too once a page of messages
 * came after its last view let go of it (#326): nobody reads them, and the next view loads its newest page.
 */
function createEvictingMessageStore<T extends Listed>(): MessageListsStore<T> {
	// The chats with a list, least recently used first.
	const used: string[] = [];
	const held = new Map<string, number>();
	// The lists no view holds, by their length as their last view let go of them.
	const released = new Map<string, number>();
	const trimListeners = new Set<(chat: string) => void>();
	const inner = writable<Record<string, T[]>>({});

	function use(chat: string) {
		const at = used.indexOf(chat);
		if (at > -1) used.splice(at, 1);
		used.push(chat);
	}

	// The lists next added or changed from before are used now, and those it dropped are forgotten.
	function note(before: Record<string, T[]>, next: Record<string, T[]>) {
		for (const chat of Object.keys(next)) if (next[chat] !== before[chat]) use(chat);
		for (let i = used.length - 1; i >= 0; i--) if (!Object.hasOwn(next, used[i]!)) used.splice(i, 1);
		for (const chat of released.keys()) if (!Object.hasOwn(next, chat)) released.delete(chat);
	}

	function drop(data: Record<string, T[]>, chat: string) {
		delete data[chat];
		const at = used.indexOf(chat);
		if (at > -1) used.splice(at, 1);
		released.delete(chat);
	}

	function evict(data: Record<string, T[]>): Record<string, T[]> {
		const grown = [...released].filter(([chat, length]) => (data[chat]?.length ?? 0) > length + MESSAGE_PAGE);
		let over = used.length - grown.length - MAX_CACHED_CHANNELS;
		if (over <= 0 && grown.length === 0) return data;
		const result = { ...data };
		for (const [chat] of grown) drop(result, chat);
		for (const chat of [...used]) {
			if (over <= 0) break;
			if (held.has(chat)) continue;
			drop(result, chat);
			over--;
		}
		return result;
	}

	return {
		subscribe: inner.subscribe,
		set(value: Record<string, T[]>) {
			note(get(inner), value);
			inner.set(evict(value));
		},
		update(fn: (value: Record<string, T[]>) => Record<string, T[]>) {
			inner.update((current) => {
				const next = fn(current);
				note(current, next);
				return evict(next);
			});
		},
		keep(chat: string) {
			held.set(chat, (held.get(chat) ?? 0) + 1);
			released.delete(chat);
			let holding = true;
			return () => {
				if (!holding) return;
				holding = false;
				const left = (held.get(chat) ?? 1) - 1;
				if (left > 0) {
					held.set(chat, left);
					return;
				}
				held.delete(chat);
				const list = get(inner)[chat];
				if (list) {
					released.set(chat, list.length);
					use(chat);
				}
			};
		},
		holds(chat: string) {
			return held.has(chat);
		},
		trim(chat: string, past: number) {
			const list = get(inner)[chat];
			if (!list || (held.get(chat) ?? 0) > 1 || list.filter((m) => m.id !== m.nonce).length <= past) return false;
			const kept = newestPage(list);
			inner.update((all) => ({ ...all, [chat]: kept }));
			if (released.has(chat)) released.set(chat, kept.length);
			for (const listener of trimListeners) listener(chat);
			return true;
		},
		onTrim(listener: (chat: string) => void) {
			trimListeners.add(listener);
			return () => trimListeners.delete(listener);
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

// The ephemeral messages a room keeps, the newest: the API keeps 50 per person and bot, for 15 minutes (#321).
const MAX_EPHEMERAL = 50;

/** Adds an ephemeral message, or replaces the one with its ID, keeping the room's newest MAX_EPHEMERAL. */
export function keepEphemeral(roomId: string, message: Message) {
	ephemeralMessages.update((all) => ({
		...all,
		[roomId]: [...(all[roomId] ?? []).filter((m) => m.id !== message.id), message].slice(-MAX_EPHEMERAL),
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
/** The emojis and stickers of each of the user's Spaces, which they may use anywhere: the session's lists bring them
 * all at once, and SPACE_EMOJI_* and SPACE_STICKER_* keep them current. */
export const spaceEmojis = writable<Record<string, SpaceEmoji[]>>({});
export const spaceStickers = writable<Record<string, SpaceSticker[]>>({});
/** Every emoji of the user's Spaces by ID: what messages, reactions and buttons draw by name, whatever room or chat
 * they're in. One it doesn't have is drawn from the API's /emojis/{id}. */
export const everyEmoji: Readable<CustomEmojiMap> = derived(spaceEmojis, ($emojis) =>
	customEmojiMapOf(Object.values($emojis).flat()),
);

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

/**
 * Where the user is typing, or recording a voice message, right now, by chat: whether they're recording. Only their
 * own row of the members column shows it (MemberList): until TYPING_TIMEOUT after their last key, or second of
 * recording, as the others' notices show, or until their message comes.
 */
export const ownTyping = writable<Record<string, boolean>>({});
const ownTypingEnds = new Map<string, ReturnType<typeof setTimeout>>();

/** The user typed in a chat, or recorded another second of a voice message there. */
export function noteOwnTyping(chatId: string, recording: boolean) {
	clearTimeout(ownTypingEnds.get(chatId));
	ownTypingEnds.set(
		chatId,
		setTimeout(() => endOwnTyping(chatId), TYPING_TIMEOUT),
	);
	// A store tells its subscribers of every object it's handed, so only a change goes in, not every key.
	if (get(ownTyping)[chatId] !== recording) ownTyping.update((all) => ({ ...all, [chatId]: recording }));
}

/** The user's typing in a chat stops showing: it got old, or their message came. */
export function endOwnTyping(chatId: string) {
	clearTimeout(ownTypingEnds.get(chatId));
	ownTypingEnds.delete(chatId);
	if (!(chatId in get(ownTyping))) return;
	ownTyping.update((all) => {
		const rest = { ...all };
		delete rest[chatId];
		return rest;
	});
}

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

/** Who reacted to a message, which its dialog (ReactionsDialog) shows: its reactions as they are, which the dialog keeps
 * up with, the one picked, and the members the view knows, which name the people. */
export interface ReactorsRequest {
	messageId: string;
	reactions: MessageReaction[];
	/** The picked reaction's key (reactionKey): its custom emoji's ID, or its Unicode emoji. */
	picked: string;
	members: MemberOnSidebar[];
	customEmojiMap: CustomEmojiMap;
}

/** Asks the dialog of who reacted to open, from a message's menu or a reaction's right click. */
export const reactorsRequest = writable<ReactorsRequest | null>(null);

/**
 * Hears each request to open something elsewhere: a jump to a message or a room, a space's invite, a bot's, who
 * reacted. What shows messages over the chat (the pins list, a thread) closes on one, which a message in it can make (a
 * reply's quote, a link's chip or card, a reaction), as it would cover what opens. Returns what stops hearing them.
 */
export function onOpenElsewhere(listener: () => void): () => void {
	const requests: Readable<unknown>[] = [jumpToMessageRequest, spaceInviteRequest, botInviteRequest, reactorsRequest];
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
	/** Whose screen share they're watching in the call (gateway#152). */
	watching?: string[];
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
/** The screen shares this client watches in its voice room or call, by user ID, in the order it opened them
 * (lib/watching.ts). VOICE_SYNC says watchingNow. */
export const watchedStreams = writable<string[]>([]);
/** This client's camera is on: its track goes out on the camera transceiver. */
export const isCameraOn = writable<boolean>(false);
/** Asks VoiceChat to turn the camera on or off in a room or call (its ID), as screenShareRequested does for the
 * screen. Only the VoiceChat of that room or call acts on it, and any other drops it: a request no VoiceChat took
 * must never turn the camera on in the next room or call. */
export const cameraRequested = writable<{ roomId: string; on: boolean } | null>(null);
/** Whether to receive others' video (cameras and screens). Off, the gateway sends none (`video_off`). */
export const incomingVideo = writable<boolean>(true);
/** The screen shares this client watches as the others see it, VOICE_SYNC's `watching`: none while incoming video is
 * off, as the gateway sends it no screen then. The list stays for when video comes back on (desktop#299). */
export const watchingNow: Readable<string[]> = derived([watchedStreams, incomingVideo], ([$watched, $incoming]) =>
	$incoming ? $watched : [],
);
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
