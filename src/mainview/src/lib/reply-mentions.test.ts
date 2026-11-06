import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mentionsByReply, quotedAuthorName, type ReferencedMessage } from "$lib/types";

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

describe("quotedAuthorName", () => {
	test("a reply that mentioned the author shows @ before their name", () => {
		expect(quotedAuthorName("Ana", { mention_author: true })).toBe("@Ana");
	});

	test("one that didn't, or says nothing (a reply still being sent), shows the bare name", () => {
		expect(quotedAuthorName("Ana", { mention_author: false })).toBe("Ana");
		expect(quotedAuthorName("Ana", {})).toBe("Ana");
		expect(quotedAuthorName("Ana", null)).toBe("Ana");
		expect(quotedAuthorName("Ana", undefined)).toBe("Ana");
	});

	test("a name that's missing stays empty", () => {
		expect(quotedAuthorName(undefined, null)).toBe("");
	});
});

test("the message list names the author through it, above a reply and above a thread's reply", () => {
	const list = readFileSync(join(import.meta.dir, "components/MessageList.svelte"), "utf8");
	expect(list).toContain("{quotedAuthorName(message.referenced_message.author_name, message.referenced_message)}");
	expect(list).toContain("{quotedAuthorName(parentMsg.author_name, threadMsg.referenced_message)}");
});
