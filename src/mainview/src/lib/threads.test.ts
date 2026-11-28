import { describe, expect, test } from "bun:test";
import type { ShownMessage } from "$lib/e2e/engine/content";
import type { DirectMessage } from "$lib/api/conversations";
import { conversationThread, threadNow, threadReplyTarget } from "$lib/threads";
import { ComponentType, isComponentsV2, isLoading, MessageFlag, MessageType, type Message } from "$lib/types";

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

// A conversation's thread draws its messages and their quotes from the device's own database (PLAN-E2E-CLIENTES.md,
// «La vista de una conversación»: the review of task 16, Missing 2 and I1): never the text the API gives. Its rows are
// built as the list's are (#613), through directMessageToMessage.
describe("a conversation's thread", () => {
	const shown = (id: string, text: string): ShownMessage => ({
		...{ conversation_id: "c", message_id: id, seq: 1, user_id: "ana", device_id: "d", sent_at: 0, edited_at: null },
		...{ status: "ok", text, attachments: [], shared_by: null, reply_to: null },
	});
	const row = (id: string, minute: number, fields: Partial<DirectMessage> = {}): DirectMessage => ({
		...{ id, conversation_id: "c", author_id: "ana", content: null, type: MessageType.Text, seq: minute + 1 },
		created_at: `2026-11-09T10:${String(minute).padStart(2, "0")}:00Z`,
		updated_at: `2026-11-09T10:${String(minute).padStart(2, "0")}:00Z`,
		...fields,
	});
	const quote = { type: 0, message_id: "root", room_id: null, space_id: null, content: "the API's words" };
	const reply = row("reply", 1, {
		content: "the API's reply",
		referenced_message: { ...quote, author_id: "ana", created_at: "2026-11-09T10:00:00Z" },
	});

	test("its quotes take their text from the device, and from nowhere else", () => {
		const both = { held: (id: string) => shown(id, `held ${id}`), typed: () => undefined, through: () => 9 };
		expect(conversationThread([reply], [], both)).toMatchObject([
			{ content: "held reply", referenced_message: { message_id: "root", content: "held root" } },
		]);
		// The quoted message not on this device: no text, whatever the API says.
		const own = {
			held: (id: string) => (id === "reply" ? shown(id, "held reply") : null),
			typed: () => undefined,
			through: () => 9,
		};
		expect(conversationThread([reply], [], own)[0]?.referenced_message?.content).toBeNull();
	});

	// The re-review's N2: a thread's row of another type than text or voice draws none of the API's words.
	test("its rows of other types draw none of the API's content", () => {
		const nothing = { held: () => null, typed: () => undefined, through: () => 9 };
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the API's types beyond the client's: 4, a share's, and 7
		const types = [2, 3, 4, 7] as DirectMessage["type"][];
		for (const type of types) {
			const served = row("notice", 2, { type, content: "words put in a mouth" });
			expect(conversationThread([served], [], nothing)[0]?.content).toBeNull();
		}
	});

	// #613: what a server answers the thread's route with, beyond a member's encrypted message, as it would draw it in
	// the member's name: components and flags of its own, a file of its own, and a row it made up.
	test("draws none of the API's components, flags or files, and no row the server made up", () => {
		const held = {
			held: (id: string) => (id === "reply" ? shown(id, "held reply") : null),
			typed: () => undefined,
			through: () => 9,
		};
		const dressed = {
			...row("reply", 1),
			flags: MessageFlag.IsComponentsV2 | MessageFlag.Loading,
			components: [{ type: ComponentType.TextDisplay, content: "words put in a mouth" }],
			attachments: [
				{
					...{ id: "f", message_id: "reply", filename: "invoice.pdf", content_type: "application/pdf" },
					...{ size_bytes: 9, url: "/attachments/f", created_at: "2026-11-09T10:01:00Z" },
				},
			],
		};
		const madeUp = row("made-up", 2, { seq: undefined, author_id: "bo", content: "the API's own message" });
		const drawn = conversationThread([dressed, madeUp], [], held);
		expect(drawn.map((m) => m.id)).toEqual(["reply"]);
		const [shownReply] = drawn;
		expect(shownReply?.content).toBe("held reply");
		expect(shownReply?.components ?? null).toBeNull();
		expect(shownReply && (isComponentsV2(shownReply) || isLoading(shownReply))).toBe(false);
		expect(shownReply?.attachments).toEqual([]);
	});
});
