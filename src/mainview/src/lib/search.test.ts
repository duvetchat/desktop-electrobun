import { describe, expect, test } from "bun:test";
import { parseSearch } from "$lib/search";

const ANA = { id: "0190a3b2-0000-7000-8000-000000000001", username: "Ana", raw_username: "ana" };
const GENERAL = { id: "0190a3b2-0000-7000-8000-0000000000c1", name: "General chat" };
const day = (month: number, date: number) => new Date(2026, month - 1, date).toISOString();
const searchOf = (text: string) => {
	const parsed = parseSearch(text, [ANA], [GENERAL]);
	if ("error" in parsed) throw new Error(parsed.error);
	return parsed.search;
};

describe("a search's text", () => {
	test("is its words and its filters", () => {
		expect(searchOf("hello from:ana in:general-chat has:image pinned:true world")).toEqual({
			query: "hello world",
			authorIds: [ANA.id],
			roomIds: [GENERAL.id],
			has: ["image"],
			pinned: true,
		});
	});

	test("says what's wrong with a filter", () => {
		expect(parseSearch("from:bob", [ANA], [])).toEqual({ error: "No member is called bob" });
		expect(parseSearch("has:gif", [], [])).toEqual({
			error: "has: takes link, embed, file, image, video, sound, sticker",
		});
		expect(parseSearch("during:2026-02-30", [], [], new Date(2026, 10, 9))).toEqual({
			error: "during: takes a date like 2026-11-09",
		});
	});

	// #232: each date filter replaced the bounds set by the one before it, so only the last one counted.
	describe("with several dates", () => {
		test("narrows to the latest start and the earliest end", () => {
			// After Nov 7 and on Nov 6: nothing can match.
			expect(searchOf("after:2026-11-07 during:2026-11-06")).toMatchObject({ after: day(11, 8), before: day(11, 7) });
			expect(searchOf("during:2026-11-06 after:2026-11-07")).toMatchObject({ after: day(11, 8), before: day(11, 7) });
			expect(searchOf("before:2026-11-10 before:2026-11-05")).toMatchObject({ before: day(11, 5) });
			expect(searchOf("after:2026-11-01 during:2026-11-06")).toMatchObject({ after: day(11, 6), before: day(11, 7) });
		});

		test("reads each alone as before: after: leaves its day out, and during: is that day", () => {
			expect(searchOf("before:2026-11-06")).toEqual({ query: "", before: day(11, 6) });
			expect(searchOf("after:2026-11-06")).toEqual({ query: "", after: day(11, 7) });
			expect(searchOf("during:2026-11-06")).toEqual({ query: "", after: day(11, 6), before: day(11, 7) });
		});
	});
});
