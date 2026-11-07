import { afterAll, beforeAll, describe, expect, jest, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";
import { changeDraft, chatDrafts, draftOf } from "$lib/drafts";
import { MessageType, type Message } from "$lib/types";
import { TYPING_TIMEOUT } from "$lib/typing";

const stores = await import("$lib/stores.svelte");

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
