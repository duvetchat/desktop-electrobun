import { describe, expect, test } from "bun:test";
import {
	countRoll,
	mergedByKey,
	onReactionChange,
	reactionChanged,
	reactionKey,
	withReaction,
	type ReactionChange,
} from "$lib/reactions";

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

	// A custom emoji's reaction is its ID's: two Spaces can each have a "blob".
	test("two custom emojis of one name are two reactions", () => {
		const one = withReaction([], change("ana", "blob", true, "x"));
		expect(withReaction(one, change("bob", "blob", true, "y"))).toEqual([
			{ emoji_name: "blob", emoji_id: "x", count: 1, users: ["ana"] },
			{ emoji_name: "blob", emoji_id: "y", count: 1, users: ["bob"] },
		]);
	});

	test("a removal takes its own emoji's reaction alone", () => {
		const x = { emoji_name: "blob", emoji_id: "x", count: 1, users: ["ana"] };
		const y = { emoji_name: "blob", emoji_id: "y", count: 1, users: ["ana"] };
		expect(withReaction([x, y], change("ana", "blob", false, "y"))).toEqual([x]);
	});

	test("a Unicode emoji goes by its name", () => {
		expect(reactionKey(thumbs)).toBe("👍");
		expect(reactionKey({ emoji_name: "blob", emoji_id: "x" })).toBe("x");
		expect(withReaction([thumbs], change("ana", "👍", false))).toEqual([{ ...thumbs, count: 1, users: ["bob"] }]);
	});
});

// An API from before reactions by ID groups a message's reactions by name: one custom emoji under two names (renamed
// between two people's reactions) comes as two, whose one key a keyed {#each} can't take.
describe("mergedByKey", () => {
	const blob = { emoji_name: "blob", emoji_id: "x", count: 1, users: ["ana"] };
	const party = { emoji_name: "party", emoji_id: "y", count: 1, users: ["cid"] };
	const blobby = { emoji_name: "blobby", emoji_id: "x", count: 2, users: ["bob", "ana"] };

	test("one emoji's reactions under two names become one, at the first's place and name, with both's people", () => {
		expect(mergedByKey([blob, party, blobby])).toEqual([
			{ emoji_name: "blob", emoji_id: "x", count: 2, users: ["ana", "bob"] },
			party,
		]);
	});

	test("reactions that are all apart stay as they are", () => {
		const list = [blob, party, thumbs];
		expect(mergedByKey(list)).toBe(list);
	});

	test("none stays none", () => {
		expect(mergedByKey(null)).toBeNull();
		expect(mergedByKey(undefined)).toBeNull();
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
