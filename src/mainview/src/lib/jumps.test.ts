import { describe, expect, test } from "bun:test";
import { quoteJump, readWhenLeft } from "$lib/jumps";

const QUOTED = "01920000-0000-7000-8000-0000000000aa";
const CONVERSATION = "01920000-0000-7000-8000-0000000c0c0c";
const SPACE = "01920000-0000-7000-8000-00000005ace0";
const ROOM = "01920000-0000-7000-8000-0000000003a0";

describe("quoteJump", () => {
	test("a conversation's quote jumps in the conversation, which its view handles", () => {
		// A conversation's reference has no room or space, and its list no space: its channel is the conversation.
		expect(
			quoteJump({ message_id: QUOTED, room_id: null, space_id: null }, { spaceId: "", channelId: CONVERSATION }),
		).toStrictEqual({ spaceId: "", roomId: "", messageId: QUOTED, conversationId: CONVERSATION });
	});

	test("a room's quote jumps in the room its reference names, with no conversation", () => {
		expect(
			quoteJump({ message_id: QUOTED, room_id: ROOM, space_id: SPACE }, { spaceId: SPACE, channelId: ROOM }),
		).toStrictEqual({ spaceId: SPACE, roomId: ROOM, messageId: QUOTED });
	});

	test("a room's reference without its room or space falls back to the list's", () => {
		expect(
			quoteJump({ message_id: QUOTED, room_id: null, space_id: null }, { spaceId: SPACE, channelId: ROOM }),
		).toStrictEqual({ spaceId: SPACE, roomId: ROOM, messageId: QUOTED });
	});

	test("a quote that names no message jumps nowhere", () => {
		expect(
			quoteJump({ message_id: null, room_id: null, space_id: null }, { spaceId: "", channelId: CONVERSATION }),
		).toBe(null);
		expect(quoteJump({ message_id: null, room_id: ROOM, space_id: SPACE }, { spaceId: SPACE, channelId: ROOM })).toBe(
			null,
		);
	});
});

describe("readWhenLeft", () => {
	// A conversation's messages in order: m(1) is the oldest. A jump to an old one loaded the pages up to m(120), with
	// newer ones still to load below; the conversation's newest was m(400) then.
	const m = (n: number) => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
	const jumped = { moreBelow: true, loadedBelowTo: m(120) };

	test("a list up to the newest message is read once that message is acked or the read position covers it", () => {
		const list = { newest: m(400), moreBelow: false, loadedBelowTo: "" };
		expect(readWhenLeft(list, m(400), m(350))).toBe(true);
		expect(readWhenLeft(list, undefined, m(400))).toBe(true);
		expect(readWhenLeft(list, undefined, m(350))).toBe(false);
		expect(readWhenLeft(list, undefined, undefined)).toBe(false);
	});

	test("a jump's pages, with newer messages still below, are no sign of reading those, even under the read position", () => {
		expect(readWhenLeft({ newest: m(120), ...jumped }, undefined, m(350))).toBe(false);
		expect(readWhenLeft({ newest: m(120), ...jumped }, m(120), m(350))).toBe(false);
	});

	test("a seen call's notice that came during the jump, which moved the read position to it, leaves it read", () => {
		// The notice is the conversation's newest message, listed after the jump's pages.
		expect(readWhenLeft({ newest: m(401), ...jumped }, undefined, m(401))).toBe(true);
	});

	test("another member's message that came during the jump leaves it unread", () => {
		expect(readWhenLeft({ newest: m(401), ...jumped }, undefined, m(350))).toBe(false);
	});
});
