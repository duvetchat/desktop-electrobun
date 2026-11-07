import { describe, expect, test } from "bun:test";
import { countRoll, onReactionChange, reactionChanged, withReaction, type ReactionChange } from "$lib/reactions";

describe("countRoll", () => {
	test("a count going up rolls up: the new number enters from below while the old one leaves upward", () => {
		expect(countRoll(1, 2)).toEqual({ enter: 100, leave: -100 });
		expect(countRoll(9, 10)).toEqual({ enter: 100, leave: -100 });
	});

	test("a count going down rolls down: the new number enters from above while the old one leaves downward", () => {
		expect(countRoll(2, 1)).toEqual({ enter: -100, leave: 100 });
		expect(countRoll(10, 9)).toEqual({ enter: -100, leave: 100 });
	});

	test("a count that didn't change doesn't roll", () => {
		expect(countRoll(3, 3)).toEqual({ enter: 0, leave: 0 });
	});
});

const change = (
	user_id: string,
	emoji_name: string,
	added: boolean,
	emoji_id: string | null = null,
): ReactionChange => ({
	message_id: "m",
	user_id,
	emoji_name,
	emoji_id,
	added,
});
const thumbs = { emoji_name: "👍", emoji_id: null, count: 2, users: ["ana", "bob"] };

// What a reaction event changes, in the stores' lists and in what shows a message they don't keep (a pin, a search
// result, who reacted).
describe("withReaction", () => {
	test("an added reaction joins its emoji's, last, as the users who reacted are oldest first", () => {
		expect(withReaction([thumbs], change("cid", "👍", true))).toEqual([
			{ ...thumbs, count: 3, users: ["ana", "bob", "cid"] },
		]);
	});

	test("an emoji nobody had yet starts a reaction of its own, at the end, with its custom emoji's ID", () => {
		expect(withReaction([thumbs], change("cid", "party", true, "e1"))).toEqual([
			thumbs,
			{ emoji_name: "party", emoji_id: "e1", count: 1, users: ["cid"] },
		]);
		expect(withReaction(null, change("cid", "🎉", true))).toEqual([
			{ emoji_name: "🎉", emoji_id: null, count: 1, users: ["cid"] },
		]);
	});

	test("an added reaction the user had already changes nothing", () => {
		expect(withReaction([thumbs], change("ana", "👍", true))).toEqual([thumbs]);
	});

	test("a reaction taken back leaves its emoji's, which goes once nobody has it", () => {
		expect(withReaction([thumbs], change("ana", "👍", false))).toEqual([{ ...thumbs, count: 1, users: ["bob"] }]);
		expect(withReaction([{ ...thumbs, count: 1, users: ["bob"] }], change("bob", "👍", false))).toEqual([]);
	});

	test("taking back a reaction nobody has changes nothing", () => {
		expect(withReaction([thumbs], change("ana", "🎉", false))).toEqual([thumbs]);
		expect(withReaction(undefined, change("ana", "🎉", false))).toEqual([]);
	});

	test("leaves the list it's given as it was", () => {
		const list = [thumbs];
		withReaction(list, change("cid", "👍", true));
		withReaction(list, change("ana", "👍", false));
		expect(list).toEqual([{ emoji_name: "👍", emoji_id: null, count: 2, users: ["ana", "bob"] }]);
	});
});

test("each change reaches whatever hears them, until it stops", () => {
	const heard: ReactionChange[] = [];
	const stop = onReactionChange((c) => heard.push(c));
	reactionChanged(change("ana", "👍", true));
	stop();
	reactionChanged(change("bob", "👍", true));
	expect(heard).toEqual([change("ana", "👍", true)]);
});
