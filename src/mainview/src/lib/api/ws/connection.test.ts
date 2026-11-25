import { afterAll, beforeAll, describe, expect, jest, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import type { Conversation } from "$lib/api/conversations";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";
import { callHistory } from "$lib/call-history";
import { changeDraft, chatDrafts, draftOf, putBack } from "$lib/drafts";
import { keepList, listSession, takeList } from "$lib/jumps";
import { onReactionChange, type ReactionChange } from "$lib/reactions";
import { notificationLevels } from "$lib/notification-levels";
import { MessageType, type GatewaySpace, type Message } from "$lib/types";
import { TYPING_TIMEOUT } from "$lib/typing";
import { SENT_BEFORE_CANCEL } from "$lib/uploads";

// A message that notifies plays its sound through an <audio>, which Bun has none of.
Object.assign(globalThis, {
	Audio: class {
		volume = 1;
		currentTime = 0;
		play() {
			return Promise.resolve();
		}
	},
});

const stores = await import("$lib/stores.svelte");
const { toastStore } = await import("$lib/stores/toast.svelte");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const ALICE = "01920000-0000-7000-8000-00000000a11c";
const message = (n: number) => `01a15f8c-${String(n).padStart(4, "0")}-7000-8000-000000000000`;
const conversation = (n: number) => `01a15f8c-0000-7000-8000-${String(n).padStart(12, "0")}`;
const roomMessage = (id: string): Message => ({
	id,
	content: "the message",
	type: MessageType.Text,
	author_id: ALICE,
	author_name: "alice",
	author_avatar_url: null,
	author_is_bot: false,
	created_at: "",
	updated_at: "",
});

let gateway: TestGateway;

function deliver(type: string, data: unknown) {
	gateway.receive(type, data);
}

function ready(fields: Record<string, unknown>) {
	deliver("READY", { user: { id: ME, username: "me" }, sessionToken: "session", guild_ids: [], ...fields });
}

/** A call's notice in a conversation, of a call the user was in: its ID is minted as the call ends. */
function callNotice(id: string, conversationId: string) {
	deliver("DM_MESSAGE_CREATE", {
		id,
		conversation_id: conversationId,
		author_id: ALICE,
		content: "",
		type: 3,
		call: {
			participants: [ALICE, ME],
			started_at: "2026-11-01T12:00:00Z",
			ended_at: "2026-11-01T12:05:00Z",
		},
		created_at: "2026-11-01T12:05:00Z",
		updated_at: "2026-11-01T12:05:00Z",
	});
}

const fetchSpy = spyOn(globalThis, "fetch");

beforeAll(async () => {
	fetchSpy.mockImplementation((async (_input: string | URL | Request) => Response.json([])) as typeof fetch);
	localStorage.setItem("duvet_session_token", "access");
	gateway = await openGateway();
});

afterAll(() => {
	gateway.close();
	fetchSpy.mockRestore();
});

describe("who shows as typing outside the open chat", () => {
	const shown = (chatId: string) => (get(stores.typingNow)[chatId] ?? []).map((u) => u.user_id);
	const notice = (chatId: string, userId: string) => ({ room_id: chatId, user_id: userId, username: "someone" });

	test("anyone in any chat, a room or a conversation, once a TYPING or a RECORDING comes", () => {
		const unsubscribe = stores.typingNow.subscribe(() => {});
		const room = conversation(20);
		const conv = conversation(21);
		deliver("TYPING", notice(room, ALICE));
		deliver("DM_RECORDING", { conversation_id: conv, user_id: ALICE, username: "alice" });
		expect(shown(room)).toEqual([ALICE]);
		expect(shown(conv)).toEqual([ALICE]);
		expect(get(stores.typingNow)[conv]?.[0]?.recording).toBe(true);
		unsubscribe();
	});

	test("not the user, whose own typing the chat also notes", () => {
		const unsubscribe = stores.typingNow.subscribe(() => {});
		const room = conversation(22);
		ready({});
		stores.typingUsers.update((all) => ({
			...all,
			[room]: [{ user_id: ME, username: "me", alias: null, avatar: null, timestamp: Date.now() }],
		}));
		expect(shown(room)).toEqual([]);
		unsubscribe();
	});

	test("until they send their message", () => {
		const unsubscribe = stores.typingNow.subscribe(() => {});
		const room = conversation(23);
		const conv = conversation(24);
		deliver("TYPING", notice(room, ALICE));
		deliver("DM_TYPING", { conversation_id: conv, user_id: ALICE, username: "alice" });
		deliver("MESSAGE_CREATE", { id: message(1), room_id: room, author_id: ALICE, content: "hi" });
		deliver("DM_MESSAGE_CREATE", { id: message(1), conversation_id: conv, author_id: ALICE, content: "hi" });
		expect(shown(room)).toEqual([]);
		expect(shown(conv)).toEqual([]);
		unsubscribe();
	});

	test("or until their notice gets old, with nothing after it", () => {
		jest.useFakeTimers();
		const unsubscribe = stores.typingNow.subscribe(() => {});
		try {
			const room = conversation(25);
			deliver("TYPING", notice(room, ALICE));
			jest.advanceTimersByTime(TYPING_TIMEOUT - 1);
			expect(shown(room)).toEqual([ALICE]);
			jest.advanceTimersByTime(1);
			expect(shown(room)).toEqual([]);
		} finally {
			unsubscribe();
			jest.useRealTimers();
		}
	});
});

// The user's own typing shows on their own row of the members column, and nowhere else (ownTyping, which only MemberList
// reads).
describe("the user's own typing", () => {
	const own = (chatId: string) => get(stores.ownTyping)[chatId];

	test("shows as they type or record, kept apart from the notices the rows, tabs and chat show", () => {
		const unsubscribe = stores.typingNow.subscribe(() => {});
		ready({});
		const room = conversation(26);
		stores.noteOwnTyping(room, false);
		expect(own(room)).toBe(false);
		stores.noteOwnTyping(room, true);
		expect(own(room)).toBe(true);
		expect(get(stores.typingUsers)[room]).toBeUndefined();
		expect(get(stores.typingNow)[room]).toBeUndefined();
		stores.endOwnTyping(room);
		expect(own(room)).toBeUndefined();
		unsubscribe();
	});

	test("until TYPING_TIMEOUT after their last key", () => {
		jest.useFakeTimers();
		try {
			const room = conversation(27);
			stores.noteOwnTyping(room, false);
			jest.advanceTimersByTime(TYPING_TIMEOUT - 1);
			stores.noteOwnTyping(room, false);
			jest.advanceTimersByTime(TYPING_TIMEOUT - 1);
			expect(own(room)).toBe(false);
			jest.advanceTimersByTime(1);
			expect(own(room)).toBeUndefined();
		} finally {
			jest.useRealTimers();
		}
	});

	test("or until their own message comes, in a room or a conversation", () => {
		ready({});
		const room = conversation(28);
		const conv = conversation(29);
		stores.noteOwnTyping(room, false);
		stores.noteOwnTyping(conv, true);
		deliver("MESSAGE_CREATE", { id: message(70), room_id: room, author_id: ALICE, content: "hi" });
		deliver("DM_MESSAGE_CREATE", { id: message(71), conversation_id: conv, author_id: ALICE, content: "hi" });
		expect(own(room)).toBe(false);
		expect(own(conv)).toBe(true);
		deliver("MESSAGE_CREATE", { id: message(72), room_id: room, author_id: ME, content: "mine" });
		deliver("DM_MESSAGE_CREATE", { id: message(73), conversation_id: conv, author_id: ME, content: "mine" });
		expect(own(room)).toBeUndefined();
		expect(own(conv)).toBeUndefined();
	});
});

// A reaction event changes the message in the list that has it, a room's or a conversation's, and reaches what shows a
// message those lists don't keep (a pin, a search result, who reacted), which has its own copy to change.
describe("a reaction that comes", () => {
	const thumbs = (users: string[]) => ({ emoji_name: "👍", emoji_id: null, count: users.length, users });

	test("in a room, changes the message in its list, and reaches what hears them", () => {
		const room = conversation(30);
		stores.channelMessages.update((all) => ({
			...all,
			[room]: [{ ...roomMessage(message(40)), reactions: [thumbs([ALICE])] }],
		}));
		const heard: ReactionChange[] = [];
		const stop = onReactionChange((change) => heard.push(change));
		deliver("REACTION_ADD", { message_id: message(40), user_id: ME, emoji_name: "👍", emoji_id: null });
		deliver("REACTION_REMOVE", { message_id: message(40), user_id: ALICE, emoji_name: "👍" });
		stop();
		expect(get(stores.channelMessages)[room]![0]!.reactions).toEqual([thumbs([ME])]);
		expect(heard.map((c) => [c.message_id, c.user_id, c.emoji_name, c.added])).toEqual([
			[message(40), ME, "👍", true],
			[message(40), ALICE, "👍", false],
		]);
	});

	test("in a conversation, and for a message no list has, which only what hears them can show", () => {
		const conv = conversation(31);
		stores.dmMessages.update((all) => ({
			...all,
			[conv]: [
				{
					id: message(41),
					conversation_id: conv,
					author_id: ALICE,
					content: "hi",
					type: MessageType.Text,
					created_at: "",
					updated_at: "",
				},
			],
		}));
		const heard: ReactionChange[] = [];
		const stop = onReactionChange((change) => heard.push(change));
		deliver("DM_REACTION_ADD", { message_id: message(41), user_id: ALICE, emoji_name: "👍" });
		deliver("DM_REACTION_ADD", { message_id: message(42), user_id: ALICE, emoji_name: "🎉" });
		stop();
		expect(get(stores.dmMessages)[conv]![0]!.reactions).toEqual([thumbs([ALICE])]);
		expect(heard.map((c) => c.message_id)).toEqual([message(41), message(42)]);
	});
});

describe("the message a draft replies to is deleted", () => {
	test("in a room, the draft goes on as no reply", () => {
		const room = conversation(10);
		changeDraft(room, { text: "hello", replyTo: roomMessage(message(1)) });
		deliver("MESSAGE_DELETE", { id: message(2), room_id: room });
		expect(draftOf(get(chatDrafts), room).replyTo).not.toBeNull();
		deliver("MESSAGE_DELETE", { id: message(1), room_id: room });
		expect(draftOf(get(chatDrafts), room)).toMatchObject({ text: "hello", replyTo: null });
	});

	test("in a conversation too", () => {
		const conv = conversation(11);
		changeDraft(conv, { replyTo: roomMessage(message(1)) });
		deliver("DM_MESSAGE_DELETE", { id: message(1), conversation_id: conv });
		expect(draftOf(get(chatDrafts), conv).replyTo).toBeNull();
	});
});

// A message this window cancelled, which the API posted all the same (#211): its whole body was in as the client gave
// up. Its create event takes out of the draft what the Cancel put back, and a notice says so.
describe("a cancelled message that the API posts all the same", () => {
	const photo = new File(["png"], "photo.png", { type: "image/png" });
	const sent = { text: "fix this", files: [photo], replyTo: null, replyMention: true };
	const notices = () => toastStore.items.filter((t) => t.message === SENT_BEFORE_CANCEL).length;
	const emptied = { text: "", files: [], replyTo: null, replyMention: true };

	test("in a room, leaves the draft as it was before the Cancel, says so, and shows as sent", () => {
		ready({});
		const room = conversation(40);
		const before = notices();
		putBack(room, "nonce-40", sent);
		// The room's pane shows it, as it did the Cancel.
		const release = stores.channelMessages.keep(room);
		deliver("MESSAGE_CREATE", {
			id: message(60),
			room_id: room,
			author_id: ME,
			content: "fix this",
			nonce: "nonce-40",
		});
		expect(draftOf(get(chatDrafts), room)).toEqual(emptied);
		expect(notices()).toBe(before + 1);
		expect(get(stores.channelMessages)[room]!.map((m) => m.id)).toEqual([message(60)]);
		release();
	});

	test("in a conversation too", () => {
		ready({});
		const conv = conversation(41);
		const before = notices();
		putBack(conv, "nonce-41", sent);
		deliver("DM_MESSAGE_CREATE", {
			id: message(61),
			conversation_id: conv,
			author_id: ME,
			content: "fix this",
			nonce: "nonce-41",
		});
		expect(draftOf(get(chatDrafts), conv)).toEqual(emptied);
		expect(notices()).toBe(before + 1);
	});

	test("not for someone else's message with that nonce", () => {
		ready({});
		const room = conversation(42);
		const before = notices();
		putBack(room, "nonce-42", sent);
		deliver("MESSAGE_CREATE", {
			id: message(62),
			room_id: room,
			author_id: ALICE,
			content: "fix this",
			nonce: "nonce-42",
		});
		expect(draftOf(get(chatDrafts), room)).toMatchObject({ text: "fix this", files: [photo] });
		expect(notices()).toBe(before);
	});
});

describe("a seen call's notice that comes late", () => {
	test("leaves a conversation unread for a newer message READY names, which never loaded", () => {
		const conv = conversation(1);
		ready({ unread_convs: [conv], last_read_convs: { [conv]: message(10) }, last_msg_convs: { [conv]: message(30) } });
		expect(get(stores.dmMessages)[conv]).toBeUndefined();
		callNotice(message(20), conv);
		expect(get(stores.unreadConversations).has(conv)).toBe(true);
		expect(get(stores.lastReadConvs)?.[conv]).toBe(message(20));
	});

	test("leaves it read when READY names the notice itself", () => {
		const conv = conversation(2);
		ready({ unread_convs: [conv], last_read_convs: { [conv]: message(10) }, last_msg_convs: { [conv]: message(20) } });
		callNotice(message(20), conv);
		expect(get(stores.unreadConversations).has(conv)).toBe(false);
	});

	test("goes by the loaded messages without an entry: an older gateway's READY, or a key past its 90 days", () => {
		const conv = conversation(3);
		ready({ unread_convs: [conv], last_read_convs: { [conv]: message(10) } });
		callNotice(message(20), conv);
		expect(get(stores.unreadConversations).has(conv)).toBe(false);

		const loaded = conversation(4);
		ready({ unread_convs: [loaded], last_read_convs: { [loaded]: message(10) } });
		stores.dmMessages.update((all) => ({
			...all,
			[loaded]: [
				{
					id: message(30),
					conversation_id: loaded,
					author_id: ALICE,
					content: "newer",
					type: MessageType.Text,
					created_at: "",
					updated_at: "",
				},
			],
		}));
		callNotice(message(20), loaded);
		expect(get(stores.unreadConversations).has(loaded)).toBe(true);
	});
});

// The Calls tab's list (#196), which the gateway's events keep current once it's loaded.
describe("the call history", () => {
	const calls = () => get(callHistory)?.calls.map((c) => c.id) ?? null;
	const loaded = (conversationId: string) =>
		callHistory.set({
			calls: [
				{
					id: message(5),
					conversation_id: conversationId,
					author_id: ALICE,
					content: null,
					type: MessageType.Call,
					created_at: "",
					updated_at: "",
					call: { participants: [ALICE], started_at: "2026-11-01T11:00:00Z", ended_at: "2026-11-01T11:00:30Z" },
				},
			],
			before: message(5),
			more: false,
		});

	test("takes a call notice that comes on top, and no other message", () => {
		const conv = conversation(20);
		loaded(conv);
		callNotice(message(40), conv);
		deliver("DM_MESSAGE_CREATE", {
			id: message(41),
			conversation_id: conv,
			author_id: ALICE,
			content: "hi",
			type: MessageType.Text,
			created_at: "",
			updated_at: "",
		});
		expect(calls()).toEqual([message(40), message(5)]);
	});

	test("loses a notice that's deleted", () => {
		const conv = conversation(21);
		loaded(conv);
		deliver("DM_MESSAGE_DELETE", { id: message(5), conversation_id: conv });
		expect(calls()).toEqual([]);
	});

	test("loses the calls of a conversation the user is no longer in", () => {
		const conv = conversation(22);
		loaded(conv);
		callNotice(message(40), conversation(23));
		deliver("CONVERSATION_MEMBER_REMOVE", { conversation_id: conv, user_id: ME });
		expect(calls()).toEqual([message(40)]);
	});

	test("is forgotten by a new session, whose events of the time away never came", () => {
		loaded(conversation(24));
		ready({});
		expect(get(callHistory)).toBeNull();
		callNotice(message(40), conversation(24));
		expect(get(callHistory)).toBeNull();
	});
});

describe("a conversation's list kept for its next view", () => {
	const list = [{ id: message(1) }, { id: message(2) }];

	test("is forgotten by a new session, whose events of the time away never came", () => {
		keepList(conversation(30), list, true, listSession());
		ready({});
		expect(takeList(conversation(30), list)).toBeNull();
	});

	test("is forgotten for a conversation the user is no longer in, whose messages no longer reach them", () => {
		ready({});
		keepList(conversation(31), list, true, listSession());
		keepList(conversation(32), list, true, listSession());
		deliver("CONVERSATION_MEMBER_REMOVE", { conversation_id: conversation(31), user_id: ME });
		expect(takeList(conversation(31), list)).toBeNull();
		expect(takeList(conversation(32), list)).toEqual({ hasMore: true });
	});
});

describe("notification levels", () => {
	const SPACE = "01a15f8c-0000-7000-8000-0000000000aa";
	const ROOM = "01a15f8c-0000-7000-8000-0000000000bb";
	async function eventually(check: () => boolean) {
		for (let i = 0; i < 200 && !check(); i++) await Bun.sleep(5);
		return check();
	}

	test("READY fetches the user's levels, and NOTIFICATION_SETTINGS_UPDATE keeps them current", async () => {
		fetchSpy.mockImplementation((async (input: string | URL | Request) => {
			const url = input instanceof Request ? input.url : String(input);
			return Response.json(
				url.endsWith("/api/users/@me/notification-settings") ? [{ target_id: ROOM, target_type: 1, level: 2 }] : [],
			);
		}) as typeof fetch);
		try {
			ready({});
			expect(await eventually(() => get(notificationLevels)[ROOM] === 2)).toBe(true);
			deliver("NOTIFICATION_SETTINGS_UPDATE", { target_id: SPACE, target_type: 0, level: 0 });
			deliver("NOTIFICATION_SETTINGS_UPDATE", { target_id: ROOM, target_type: 1, level: null });
			expect(get(notificationLevels)).toEqual({ [SPACE]: 0 });
		} finally {
			fetchSpy.mockImplementation((async (_input: string | URL | Request) => Response.json([])) as typeof fetch);
		}
	});

	test("SPACE_UPDATE brings a Space's new default", () => {
		const space: GatewaySpace = {
			id: SPACE,
			name: "S",
			description: null,
			banner: null,
			owner_id: ALICE,
			locale: null,
			default_notifications: 1,
			member_roles: {},
			room_overwrites: [],
			rooms: [],
			members: [],
			roles: [],
			users: [],
			created_at: "",
			updated_at: "",
		};
		stores.gatewaySpaces.set([space]);
		deliver("SPACE_UPDATE", { id: SPACE, name: "S", default_notifications: 0 });
		expect(get(stores.gatewaySpaces)[0]!.default_notifications).toBe(0);
	});
});

// A message moves its conversation up the list, as the API orders it, whatever it notifies.
describe("a conversation's message", () => {
	test("moves its conversation to the top of the list", () => {
		const older = conversation(50);
		const newer = conversation(51);
		const listed = (id: string, updatedAt: string): Conversation => ({
			id,
			type: 1,
			name: null,
			owner_id: ME,
			created_at: updatedAt,
			updated_at: updatedAt,
			deleted_at: null,
			members: [],
		});
		stores.conversations.set([listed(newer, "2026-11-02T00:00:00Z"), listed(older, "2026-11-01T00:00:00Z")]);
		deliver("DM_MESSAGE_CREATE", {
			id: message(90),
			conversation_id: older,
			author_id: ALICE,
			content: "hi",
			created_at: "2026-11-03T00:00:00Z",
			updated_at: "2026-11-03T00:00:00Z",
		});
		expect(get(stores.conversations).map((c) => c.id)).toEqual([older, newer]);
	});
});

// #324: an edit rebuilt the list of every room kept, where only its own room holds the message and the replies that
// quote it, as a reply quotes a message of its own room.
describe("a message's edit", () => {
	test("changes its own room's list, and leaves the others' as they were", () => {
		const room = conversation(60);
		const other = conversation(61);
		stores.channelMessages.update((all) => ({
			...all,
			[room]: [
				roomMessage(message(60)),
				{
					...roomMessage(message(61)),
					referenced_message: {
						type: 0,
						message_id: message(60),
						room_id: room,
						space_id: null,
						content: "the message",
					},
				},
			],
			[other]: [roomMessage(message(62))],
		}));
		const before = get(stores.channelMessages);
		deliver("MESSAGE_UPDATE", { id: message(60), room_id: room, author_id: ALICE, content: "edited" });
		const after = get(stores.channelMessages);
		expect(after[room]![0]!.content).toBe("edited");
		expect(after[room]![1]!.referenced_message?.content).toBe("edited");
		expect(after[other]).toBe(before[other]);
	});
});

// #326: every room's and conversation's live messages went into a list, whether anyone had loaded the chat or not, and
// nothing ever cut those lists back.
describe("a live message of a chat nobody loaded", () => {
	test("makes no list of it, and neither do an edit or a deletion there", () => {
		const room = conversation(70);
		const conv = conversation(71);
		deliver("MESSAGE_CREATE", { id: message(80), room_id: room, author_id: ALICE, content: "hi" });
		deliver("MESSAGE_DELETE", { id: message(81), room_id: room });
		deliver("DM_MESSAGE_CREATE", { id: message(82), conversation_id: conv, author_id: ALICE, content: "hi" });
		deliver("DM_MESSAGE_UPDATE", { id: message(83), conversation_id: conv, author_id: ALICE, content: "edited" });
		deliver("DM_MESSAGE_DELETE", { id: message(84), conversation_id: conv });
		expect(get(stores.channelMessages)[room]).toBeUndefined();
		expect(get(stores.dmMessages)[conv]).toBeUndefined();
	});

	test("goes into the list of a chat a view holds, whose first page is still on its way", () => {
		const room = conversation(72);
		const conv = conversation(73);
		const releaseRoom = stores.channelMessages.keep(room);
		const releaseConv = stores.dmMessages.keep(conv);
		deliver("MESSAGE_CREATE", { id: message(85), room_id: room, author_id: ALICE, content: "hi" });
		deliver("DM_MESSAGE_CREATE", { id: message(86), conversation_id: conv, author_id: ALICE, content: "hi" });
		releaseRoom();
		releaseConv();
		expect(get(stores.channelMessages)[room]?.map((m) => m.id)).toEqual([message(85)]);
		expect(get(stores.dmMessages)[conv]?.map((m) => m.id)).toEqual([message(86)]);
	});
});

// The emojis and stickers of every Space the user is in, which the pickers offer and the messages draw: one call each,
// with the session's other lists, never one per Space; a Space joined later brings its own, and one left takes them.
describe("the user's custom emojis and stickers", () => {
	const A = "01a15f8c-0000-7000-8000-0000000000c1";
	const B = "01a15f8c-0000-7000-8000-0000000000c2";
	const JOINED = "01a15f8c-0000-7000-8000-0000000000c3";
	const asset = (space_id: string, id: string, name: string) => ({
		id,
		name,
		space_id,
		attachment_id: `file-${name}`,
		created_at: "",
		updated_at: "",
	});
	const wave = asset(A, "01a15f8c-0000-7000-8000-0000000000e1", "wave");
	const party = asset(B, "01a15f8c-0000-7000-8000-0000000000e2", "party");
	const emojis = [wave, party];
	const stickers = [asset(A, "01a15f8c-0000-7000-8000-0000000000f1", "cat")];
	const joinedEmojis = [asset(JOINED, "01a15f8c-0000-7000-8000-0000000000e3", "hello")];
	const joinedStickers = [asset(JOINED, "01a15f8c-0000-7000-8000-0000000000f3", "dog")];
	const spaceCreate = (id: string) => ({
		space: { id, name: "S", owner_id: ALICE, created_at: "", updated_at: "" },
		rooms: {},
		roles_permissions: {},
		member_roles: {},
		overwrites: {},
		voice_states: [],
	});
	async function eventually(check: () => boolean) {
		for (let i = 0; i < 200 && !check(); i++) await Bun.sleep(5);
		return check();
	}
	// What the API answers each list with, and the paths asked for.
	function answering(): string[] {
		const asked: string[] = [];
		fetchSpy.mockImplementation((async (input: string | URL | Request) => {
			const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
			asked.push(path);
			const lists: Record<string, unknown> = {
				"/api/users/@me/emojis": emojis,
				"/api/users/@me/stickers": stickers,
				[`/api/spaces/${JOINED}/emojis`]: joinedEmojis,
				[`/api/spaces/${JOINED}/stickers`]: joinedStickers,
				[`/api/spaces/${A}/emojis`]: [wave],
				[`/api/spaces/${A}/stickers`]: stickers,
			};
			return Response.json(lists[path] ?? []);
		}) as typeof fetch);
		return asked;
	}
	const answerNothing = () =>
		fetchSpy.mockImplementation((async (_input: string | URL | Request) => Response.json([])) as typeof fetch);
	const loaded = () => Object.keys(get(stores.spaceEmojis)).length === 2 && !!get(stores.spaceStickers)[A];

	test("READY fetches every Space's emojis and stickers in one call each, kept by Space", async () => {
		const asked = answering();
		try {
			ready({ guild_ids: [A, B] });
			deliver("SPACE_CREATE", spaceCreate(A));
			deliver("SPACE_CREATE", spaceCreate(B));
			expect(await eventually(loaded)).toBe(true);
			expect(get(stores.spaceEmojis)).toEqual({ [A]: [wave], [B]: [party] });
			expect(get(stores.spaceStickers)).toEqual({ [A]: stickers });
			expect(Object.keys(get(stores.everyEmoji)).sort()).toEqual(emojis.map((e) => e.id).sort());
			expect(asked.filter((p) => p.startsWith("/api/spaces/"))).toEqual([]);
		} finally {
			answerNothing();
		}
	});

	test("a SPACE_CREATE READY didn't list loads that Space's own", async () => {
		const asked = answering();
		try {
			ready({ guild_ids: [A, B] });
			deliver("SPACE_CREATE", spaceCreate(A));
			deliver("SPACE_CREATE", spaceCreate(B));
			expect(await eventually(loaded)).toBe(true);
			deliver("SPACE_CREATE", spaceCreate(JOINED));
			expect(await eventually(() => !!get(stores.spaceStickers)[JOINED])).toBe(true);
			expect(get(stores.spaceEmojis)[JOINED]).toEqual(joinedEmojis);
			expect(get(stores.spaceStickers)[JOINED]).toEqual(joinedStickers);
			expect(asked.filter((p) => p.startsWith("/api/spaces/")).sort()).toEqual(
				[`/api/spaces/${JOINED}/emojis`, `/api/spaces/${JOINED}/stickers`].sort(),
			);
		} finally {
			answerNothing();
		}
	});

	test("READY's own SPACE_CREATEs ask for nothing, but one of a Space come back to after leaving does", async () => {
		const asked = answering();
		try {
			ready({ guild_ids: [A, B] });
			deliver("SPACE_CREATE", spaceCreate(A));
			deliver("SPACE_CREATE", spaceCreate(B));
			expect(await eventually(loaded)).toBe(true);
			expect(asked.filter((p) => p.startsWith("/api/spaces/"))).toEqual([]);
			deliver("SPACE_DELETE", { id: A });
			deliver("SPACE_CREATE", spaceCreate(A));
			expect(await eventually(() => asked.filter((p) => p.startsWith(`/api/spaces/${A}/`)).length === 2)).toBe(true);
			expect(await eventually(() => get(stores.spaceStickers)[A]?.length === 1)).toBe(true);
		} finally {
			answerNothing();
		}
	});

	test("SPACE_DELETE drops the Space's emojis and stickers", async () => {
		answering();
		try {
			ready({ guild_ids: [A, B] });
			deliver("SPACE_CREATE", spaceCreate(A));
			deliver("SPACE_CREATE", spaceCreate(B));
			expect(await eventually(loaded)).toBe(true);
			deliver("SPACE_DELETE", { id: A });
			expect(A in get(stores.spaceEmojis)).toBe(false);
			expect(A in get(stores.spaceStickers)).toBe(false);
			expect(get(stores.spaceEmojis)[B]).toEqual([party]);
			expect(Object.keys(get(stores.everyEmoji))).toEqual([party.id]);
		} finally {
			answerNothing();
		}
	});
});

// End-to-end encryption's events (PLAN-E2E-API.md, its events; PLAN-E2E-CLIENTES.md, Task 10): the nine new ones are the
// encryption engine's alone, which hears them through its hook (lib/e2e/events.ts), and nothing else of the app reads
// them; a DM's messages and READY reach it too, once the app took them. No later task touches the switch for them again.
describe("end-to-end encryption's events", () => {
	const DEVICE = "0193a4b2-0000-7000-8000-0000000d0001";
	const conv = conversation(90);
	const entry = (seq: number, kind: string) => ({ seq, kind, data: "Ynl0ZXM=", sent_at: 1, generation: 0, epoch: 2 });
	const NEW_EVENTS: [string, unknown][] = [
		["MLS_COMMIT", { conversation_id: conv, generation: 0, epoch: 3, entry: entry(4, "commit") }],
		["MLS_WELCOME", { conversation_id: conv, generation: 0, epoch: 3, devices: [DEVICE], entry: entry(5, "welcome") }],
		[
			"MLS_PROPOSAL",
			{ conversation_id: conv, generation: 0, epoch: 3, entry: { ...entry(6, "proposal"), data: undefined } },
		],
		["DEVICE_MESSAGE", { device_id: DEVICE, id: message(91) }],
		["KEY_PACKAGES_LOW", { device_id: DEVICE, remaining: 12 }],
		[
			"DEVICE_ADD",
			{
				id: DEVICE,
				name: "Duvet for Windows",
				client: "desktop-windows/1.2.0",
				listed: false,
				created_at: "2026-11-25T00:00:00Z",
				last_seen_at: "2026-11-25T00:00:00Z",
			},
		],
		["DEVICE_REMOVE", { device_id: DEVICE }],
		["IDENTITY_UPDATE", { user_id: ALICE, identity_key: "a2V5", device_list_version: 2 }],
		[
			"HISTORY_SHARE_CREATE",
			{
				id: message(92),
				conversation_id: conv,
				from_user_id: ALICE,
				kind: "share",
				range: "week",
				starts_at: 1,
				size: 4096,
				parts: 1,
			},
		],
	];

	/** Counts what each store the app keeps chats and their marks in tells its subscribers, from now on. */
	function watchLists() {
		const lists = {
			dmMessages: stores.dmMessages,
			channelMessages: stores.channelMessages,
			ephemeralMessages: stores.ephemeralMessages,
			conversations: stores.conversations,
			unreadConversations: stores.unreadConversations,
			unreadChannels: stores.unreadChannels,
			mentionCounts: stores.mentionCounts,
			typingUsers: stores.typingUsers,
		};
		const told: Record<string, number> = {};
		const stops = Object.entries(lists).map(([name, store]) => {
			let first = true;
			return store.subscribe(() => {
				if (first) first = false;
				else told[name] = (told[name] ?? 0) + 1;
			});
		});
		return {
			told,
			stop: () => stops.forEach((stop) => stop()),
		};
	}

	test("each new event reaches the engine, and none touches the message lists", async () => {
		const { engineEvents } = await import("$lib/e2e/events");
		const heard: unknown[] = [];
		const stopListening = engineEvents.listen((event) => heard.push(event));
		const lists = watchLists();
		try {
			for (const [type, data] of NEW_EVENTS) deliver(type, data);
			// Each as the gateway sent it, in its order: an entry without its data too, which the engine reads from the queue.
			expect(heard).toEqual(NEW_EVENTS.map(([type, data]) => JSON.parse(JSON.stringify({ type, data }))));
			expect(lists.told).toEqual({});
		} finally {
			lists.stop();
			stopListening();
		}
	});

	test("a DM's messages and READY reach it too, once the app took them", async () => {
		const { engineEvents } = await import("$lib/e2e/events");
		const created = {
			id: message(93),
			conversation_id: conv,
			author_id: ALICE,
			content: null,
			type: 0,
			created_at: "2026-11-25T00:00:00Z",
			updated_at: "2026-11-25T00:00:00Z",
			nonce: "f3c1d7a2-5b6e-4c8d-9e0f-1a2b3c4d5e6f",
			ciphertext: "Y2lwaGVy",
			seq: 7,
			sent_at: 1_764_028_800_000,
			generation: 0,
			epoch: 3,
			sender_device_id: DEVICE,
		};
		const heard: { type: string; took: boolean }[] = [];
		const stopListening = engineEvents.listen((event) => {
			// What the app made of it by then.
			const took =
				event.type === "READY"
					? get(stores.currentUser)?.id === ME
					: event.type === "DM_MESSAGE_DELETE"
						? !get(stores.dmMessages)[conv]?.some((m) => m.id === created.id)
						: get(stores.dmMessages)[conv]?.some((m) => m.id === created.id) === true;
			heard.push({ type: event.type, took });
		});
		const release = stores.dmMessages.keep(conv);
		try {
			ready({});
			deliver("DM_MESSAGE_CREATE", created);
			deliver("DM_MESSAGE_UPDATE", {
				id: created.id,
				conversation_id: conv,
				edited_at: "2026-11-25T00:01:00Z",
				entry: entry(8, "edit"),
			});
			deliver("DM_MESSAGE_DELETE", { id: created.id, conversation_id: conv, entry: entry(9, "delete") });
			expect(heard).toEqual([
				{ type: "READY", took: true },
				{ type: "DM_MESSAGE_CREATE", took: true },
				{ type: "DM_MESSAGE_UPDATE", took: true },
				{ type: "DM_MESSAGE_DELETE", took: true },
			]);
		} finally {
			release();
			stopListening();
		}
	});

	// An encrypted message's edit carries its entry, not its text (PLAN-E2E-API.md, G): its row keeps what it showed, and
	// says when it was edited, until the engine has the new text from its entry.
	test("an edit's event keeps its message's row, and says when it was edited", () => {
		const row = {
			id: message(94),
			conversation_id: conv,
			author_id: ALICE,
			content: "kept",
			type: MessageType.Text,
			created_at: "2026-11-25T00:00:00Z",
			updated_at: "2026-11-25T00:00:00Z",
		};
		stores.dmMessages.update((all) => ({ ...all, [conv]: [row] }));
		deliver("DM_MESSAGE_UPDATE", {
			id: row.id,
			conversation_id: conv,
			edited_at: "2026-11-25T00:02:00Z",
			entry: entry(10, "edit"),
		});
		expect(get(stores.dmMessages)[conv]).toEqual([{ ...row, edited_at: "2026-11-25T00:02:00Z" }]);
	});

	// The app's own handling of an event may end early (a DM's message without its conversation): the engine still hears it.
	test("an event whose case leaves the switch early still reaches the engine", async () => {
		const { engineEvents } = await import("$lib/e2e/events");
		const heard: string[] = [];
		const stopListening = engineEvents.listen((event) => heard.push(event.type));
		try {
			deliver("DM_MESSAGE_CREATE", { id: message(95), conversation_id: null, author_id: ALICE, content: null });
			expect(heard).toEqual(["DM_MESSAGE_CREATE"]);
		} finally {
			stopListening();
		}
	});

	test("an engine that fails on an event doesn't keep it from the others, nor from the app", async () => {
		const { engineEvents } = await import("$lib/e2e/events");
		const heard: string[] = [];
		const logged = spyOn(console, "error").mockImplementation(() => {});
		const stops = [
			engineEvents.listen(() => {
				throw new Error("the engine broke");
			}),
			engineEvents.listen((event) => heard.push(event.type)),
		];
		try {
			ready({});
			deliver("KEY_PACKAGES_LOW", { device_id: DEVICE, remaining: 3 });
			expect(heard).toEqual(["READY", "KEY_PACKAGES_LOW"]);
			expect(get(stores.currentUser)?.id).toBe(ME);
			expect(logged).toHaveBeenCalled();
		} finally {
			for (const stop of stops) stop();
			logged.mockRestore();
		}
	});
});
