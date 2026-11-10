import { describe, expect, test } from "bun:test";
import { threadNow, threadReplyTarget } from "$lib/threads";
import { MessageType, type Message } from "$lib/types";

const message = (id: string, minute: number, repliesTo?: string, fields: Partial<Message> = {}): Message => ({
	id,
	content: id,
	type: MessageType.Text,
	author_id: "ana",
	author_name: "Ana",
	author_avatar_url: null,
	author_is_bot: false,
	created_at: `2026-11-09T10:${String(minute).padStart(2, "0")}:00Z`,
	updated_at: `2026-11-09T10:${String(minute).padStart(2, "0")}:00Z`,
	ref_message_id: repliesTo ?? null,
	...fields,
});

// #61: the desktop's thread was read-only, the messages it loaded as it opened; the mobile app replies in its threads.
describe("a thread as it is now", () => {
	const root = message("root", 0);
	const reply = message("reply", 1, "root");

	test("has the replies to its messages that came since it loaded, a reply to a reply too, oldest first", () => {
		const list = [root, message("other", 2), reply, message("late", 3, "root"), message("deeper", 4, "late")];
		expect(threadNow([root, reply], list).map((m) => m.id)).toEqual(["root", "reply", "late", "deeper"]);
	});

	test("has the user's reply being sent, which quotes its message", () => {
		const sending = message("nonce", 5, undefined, {
			nonce: "nonce",
			referenced_message: { type: 0, message_id: "reply", room_id: null, space_id: null, content: "reply" },
		});
		expect(threadNow([root, reply], [root, sending]).map((m) => m.id)).toEqual(["root", "reply", "nonce"]);
	});

	test("shows its messages as the list has them now, and keeps those the list doesn't have", () => {
		const edited = { ...reply, content: "edited" };
		expect(threadNow([root, reply], [edited]).map((m) => m.content)).toEqual(["root", "edited"]);
	});

	test("is empty until it loads", () => {
		expect(threadNow([], [root, reply])).toEqual([]);
	});
});

describe("a reply in a thread", () => {
	const root = message("root", 0);
	const picked = message("picked", 1, "root");

	test("replies to its root, mentioning its author, as a reply does by default", () => {
		expect(threadReplyTarget({ text: "", files: [], replyTo: null, replyMention: false }, root)).toEqual({
			replyTo: root,
			replyMention: true,
		});
	});

	test("replies to the message of the thread picked in its draft, with that reply's @", () => {
		expect(threadReplyTarget({ text: "", files: [], replyTo: picked, replyMention: false }, root)).toEqual({
			replyTo: picked,
			replyMention: false,
		});
	});
});
