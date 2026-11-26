import { describe, expect, test } from "bun:test";
import { KEPT_MOST, pruned, type KeptKey } from "./history";

// The record of the packages this device is handed (PLAN-E2E-CLIENTES.md, Task 30; I1 and M4 of its review): each
// package's key, and each ID of one done with, kept 30 days from when it came, and the newest thousand of each; none
// goes because a list of the API's left its package out.
const DAY = 24 * 3600_000;
const now = Date.parse("2026-11-26T12:00:00Z");
const key = (n: number, at: number): KeptKey => ({
	...{ type: "history.key", share_id: `share-${n}`, conversation_id: "a conversation", user_id: "a member" },
	...{ at, starts: 0, owed: null },
});
const byId = (keys: KeptKey[]) => new Map(keys.map((one) => [one.share_id, one]));

describe("the record of the packages' keys", () => {
	test("keeps each key, and each ID done with, 30 days from when it came", () => {
		const keys = byId([key(1, now - 29 * DAY), key(2, now - 30 * DAY - 1)]);
		const done = new Map([
			["done long ago", now - 31 * DAY],
			["done yesterday", now - DAY],
		]);
		const kept = pruned({ keys, done }, now);
		expect([...kept.keys.keys()]).toEqual(["share-1"]);
		expect([...kept.done.keys()]).toEqual(["done yesterday"]);
	});

	test("keeps the newest thousand of each, the oldest going first", () => {
		const keys = byId(Array.from({ length: KEPT_MOST + 2 }, (_, n) => key(n, now - n * 1000)));
		const done = new Map(Array.from({ length: KEPT_MOST + 1 }, (_, n) => [`done-${n}`, now - n * 1000]));
		const kept = pruned({ keys, done }, now);
		expect(kept.keys.size).toBe(KEPT_MOST);
		expect(kept.keys.has("share-0")).toBe(true);
		expect(kept.keys.has(`share-${KEPT_MOST - 1}`)).toBe(true);
		expect(kept.keys.has(`share-${KEPT_MOST}`)).toBe(false);
		expect(kept.done.size).toBe(KEPT_MOST);
		expect(kept.done.has(`done-${KEPT_MOST}`)).toBe(false);
	});
});
