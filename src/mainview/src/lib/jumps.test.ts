import { describe, expect, test } from "bun:test";
import { quoteJump } from "$lib/jumps";

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
