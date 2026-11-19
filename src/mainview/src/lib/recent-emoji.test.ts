import { describe, expect, test } from "bun:test";
import {
	RECENT_EMOJI_KEY,
	RECENT_SHOWN,
	emojiUsed,
	parseUses,
	quickReactions,
	rankedEmoji,
	recentEmoji,
	recentToShow,
	withUse,
	type EmojiUses,
} from "$lib/recent-emoji";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const START = Date.UTC(2026, 0, 1);
const PARTY_ID = "0e0e0e0e-0000-4000-8000-000000000001";
const PARTY = `<:${PARTY_ID}:>`;
const none: EmojiUses = new Map();

/** The uses with `times` more of emoji, `after` the start. */
function use(uses: EmojiUses, emoji: string, after: number, times = 1): EmojiUses {
	let next = uses;
	for (let i = 0; i < times; i++) next = withUse(next, emoji, START + after);
	return next;
}
const rankedAt = (uses: EmojiUses, after: number) => rankedEmoji(uses, START + after);

// #381: the emoji used lately, ranked as the mobile app ranks them (its lib/data/recent_emoji.dart, after iOS's
// Frequently Used): by how often, fading with time, with what was just used up front. An emoji's rank, `age` after its
// last use, is `score × ½^(age / 7 days) + 10 × ½^(age / 1 hour)`, each use adding 1 to the faded score, up to 10.
describe("the ranking", () => {
	test("the one used more often comes first", () => {
		const uses = use(use(none, "🎉", 0, 3), "😀", 0);
		expect(rankedAt(uses, 0)).toEqual(["🎉", "😀"]);
		expect(rankedAt(uses, DAY)).toEqual(["🎉", "😀"]);
	});

	test("the one just used shows first, then settles under a favourite", () => {
		const uses = use(use(none, "🎉", 0, 5), "😀", DAY);
		expect(rankedAt(uses, DAY)).toEqual(["😀", "🎉"]);
		expect(rankedAt(uses, 2 * DAY)).toEqual(["🎉", "😀"]);
	});

	test("a favourite left alone sinks under a later single use, however often it was used", () => {
		// Fifty uses count as ten: uncapped, they would still lead five weeks on.
		const uses = use(use(none, "🎉", 0, 50), "😀", 6 * DAY);
		expect(rankedAt(uses, 7 * DAY)).toEqual(["🎉", "😀"]);
		expect(rankedAt(use(uses, "👍", 34 * DAY), 35 * DAY)[0]).toBe("👍");
	});

	test("tracks 96 at most, dropping the lowest", () => {
		let uses = none;
		for (let i = 0; i < 100; i++) uses = use(uses, `e${i}`, i * MINUTE);
		const ranked = rankedAt(uses, 100 * MINUTE);
		expect(ranked).toHaveLength(96);
		expect(ranked[0]).toBe("e99");
		expect(ranked.at(-1)).toBe("e4");
	});

	test("never drops the one just used, even where it ranks lowest", () => {
		let uses = none;
		for (let i = 0; i < 96; i++) uses = use(uses, `e${i}`, 0, 2);
		uses = use(uses, "🆕", 0);
		expect(uses.size).toBe(96);
		expect(uses.has("🆕")).toBe(true);
		// Of the 96 that tie, the last by code goes.
		expect(uses.has("e95")).toBe(false);
	});

	test("ties go by code, and a use a clock set back left in the future counts as just made", () => {
		expect(rankedAt(use(use(none, "😀", 0), "🎉", 0), 0)).toEqual(["🎉", "😀"]);
		// Read as a day ahead, its fresh bonus would be 10 × 2^24, ahead of anything.
		const uses = use(use(none, "🎉", 0, 2), "😀", DAY);
		expect(rankedAt(uses, 0)).toEqual(["🎉", "😀"]);
	});
});

// As the mobile app stores them: {"😀": [score, last use in ms]}.
describe("what's stored", () => {
	test("reads back with its counts, a custom emoji's code too", () => {
		const uses = parseUses(JSON.stringify({ [PARTY]: [3, START], "😀": [1, START] }));
		expect(rankedAt(uses, DAY)).toEqual([PARTY, "😀"]);
		// The count came back, not only the order: one more use doesn't overtake three.
		expect(rankedAt(use(uses, "😀", DAY), 2 * DAY)).toEqual([PARTY, "😀"]);
	});

	test("what doesn't read starts empty", () => {
		const unread = [
			null,
			"",
			"not json",
			"42",
			"null",
			"[]",
			'["😀","🎉"]',
			'{"😀":"often"}',
			'{"😀":[1]}',
			'{"😀":[1,2,3]}',
			'{"😀":[null,3]}',
			'{"😀":[1,2.5]}',
			'{"😀":[-1,0]}',
			'{"😀":[1e999,0]}',
		].filter((stored) => parseUses(stored).size > 0);
		expect(unread).toEqual([]);
	});

	test("a bad entry is skipped, the rest kept, and a score past 10 counts as 10", () => {
		const uses = parseUses('{"😀":[2,0],"🎉":"x","👍":[0,0],"🔥":[50,0]}');
		expect([...uses.keys()]).toEqual(["😀", "🔥"]);
		expect(uses.get("🔥")?.score).toBe(10);
	});
});

// The uses live in this device's localStorage, for every account signed in on it, as the mobile app keeps them.
describe("on this device", () => {
	// The first test here to touch the device's ranking, so its read from the storage is tried too, and throws.
	test("a storage that throws leaves the session's uses counted", () => {
		const real = localStorage;
		let reads = 0;
		let writes = 0;
		const broken = {
			getItem: () => {
				reads++;
				throw new Error("no storage");
			},
			setItem: () => {
				writes++;
				throw new Error("no storage");
			},
		};
		Object.assign(globalThis, { localStorage: broken });
		try {
			emojiUsed("🔥", START);
			emojiUsed("🔥", START);
			expect(recentEmoji(START)).toEqual(["🔥"]);
			expect({ reads, writes }).toEqual({ reads: 1, writes: 2 });
		} finally {
			Object.assign(globalThis, { localStorage: real });
		}
	});

	test("each use is kept in localStorage, from which the ranking reads back as it is", () => {
		emojiUsed(PARTY, START + MINUTE);
		emojiUsed("😀", START + MINUTE);
		const stored = localStorage.getItem(RECENT_EMOJI_KEY);
		expect(JSON.parse(stored ?? "null")).toEqual({
			"🔥": [2, START],
			[PARTY]: [1, START + MINUTE],
			"😀": [1, START + MINUTE],
		});
		expect(rankedEmoji(parseUses(stored), START + DAY)).toEqual(recentEmoji(START + DAY));
	});
});

// What the picker's Recently used draws: a custom emoji only while one of the user's Spaces has it, so one whose Space
// they left, or that was deleted, takes no place there.
test("Recently used leaves out a custom emoji the user no longer has, and shows 24 at most", () => {
	const ranked = [
		"😀",
		"<:01a15f8c-0000-7000-8000-00000000dead:>",
		PARTY,
		...Array.from({ length: 30 }, (_, i) => `e${i}`),
	];
	const shown = recentToShow(ranked, (id) => id === PARTY_ID);
	expect(RECENT_SHOWN).toBe(24);
	expect(shown).toHaveLength(RECENT_SHOWN);
	expect(shown.slice(0, 3)).toEqual(["😀", PARTY, "e0"]);
	expect(shown.at(-1)).toBe("e21");
});

// The quick reactions (a message's hover bar, its menu's first row) lead with the Unicode emoji used most lately, then
// their own, as many as they have; custom emojis stay in the picker, as on the mobile app.
test("quick reactions: the Unicode emoji used most lately, then the row's own, as many as the row has", () => {
	const row = ["😂", "❤️", "👍"];
	expect(quickReactions(row, [])).toEqual(row);
	expect(quickReactions(row, ["🔥", PARTY, "👍"])).toEqual(["🔥", "👍", "😂"]);
	expect(quickReactions(row, ["🔥", "🎉", "😀", "🙂"])).toEqual(["🔥", "🎉", "😀"]);
});
