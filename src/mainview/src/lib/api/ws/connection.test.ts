import { afterAll, beforeAll, describe, expect, jest, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";
import { callHistory } from "$lib/call-history";
import { changeDraft, chatDrafts, draftOf, putBack } from "$lib/drafts";
import { onReactionChange, type ReactionChange } from "$lib/reactions";
import { MessageType, type Message } from "$lib/types";
import { TYPING_TIMEOUT } from "$lib/typing";
import { SENT_BEFORE_CANCEL } from "$lib/uploads";

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
		expect(get(stores.channelMessages)[room][0].reactions).toEqual([thumbs([ME])]);
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
		expect(get(stores.dmMessages)[conv][0].reactions).toEqual([thumbs([ALICE])]);
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
		deliver("MESSAGE_CREATE", {
			id: message(60),
			room_id: room,
			author_id: ME,
			content: "fix this",
			nonce: "nonce-40",
		});
		expect(draftOf(get(chatDrafts), room)).toEqual(emptied);
		expect(notices()).toBe(before + 1);
		expect(get(stores.channelMessages)[room].map((m) => m.id)).toEqual([message(60)]);
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
