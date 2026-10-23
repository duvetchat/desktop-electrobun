import { describe, expect, test } from "bun:test";
import { mentionsByReply, type ReferencedMessage } from "$lib/types";

const ME = "01920000-0000-7000-8000-00000000b0b0";
const reply = (ref: Partial<ReferencedMessage>) => ({
	referenced_message: {
		type: 0,
		message_id: "01920000-0000-7000-8000-0000000000aa",
		room_id: null,
		space_id: null,
		...ref,
	},
});

describe("mentionsByReply", () => {
	test("a reply mentions the author of the message it replies to when the API says so", () => {
		expect(mentionsByReply(reply({ author_id: ME, mention_author: true }), ME)).toBe(true);
	});

	test("not when it was sent with replied_user false, or says nothing (a reply still being sent)", () => {
		expect(mentionsByReply(reply({ author_id: ME, mention_author: false }), ME)).toBe(false);
		expect(mentionsByReply(reply({ author_id: ME }), ME)).toBe(false);
	});

	test("only that author", () => {
		expect(
			mentionsByReply(reply({ author_id: "01920000-0000-7000-8000-00000000a11c", mention_author: true }), ME),
		).toBe(false);
	});

	test("a message that isn't a reply, or whose replied message is gone (its author with it), mentions nobody", () => {
		expect(mentionsByReply({ referenced_message: null }, ME)).toBe(false);
		expect(mentionsByReply({}, ME)).toBe(false);
		expect(mentionsByReply(reply({ mention_author: true }), ME)).toBe(false);
	});
});
