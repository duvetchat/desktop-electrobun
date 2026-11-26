import { describe, expect, test } from "bun:test";
import en from "../../../messages/en.json";
import { SHARE_RANGES } from "./engine/history";
import { notice, NOTICES, type NoticeKey } from "./notices";
import { outcomeLine, RANGE_WORDS, sharedLine } from "./sharing";

// What the app says of a conversation's shared history (PLAN-E2E-CLIENTES.md, Task 30): its ranges, a share's notice
// and what the person's share came to, each in the notices' table's words, which the mobile app says too.
const BO = "0190a3b2-0000-7000-8000-0000000000b0";
const ME = "0190a3b2-0000-7000-8000-000000000001";
const nameOf = (userId: string) => (userId === BO ? "Bo" : userId);

describe("a shared history's words", () => {
	test("its ranges and its notice say the table's, to the person it went to as you", () => {
		for (const range of SHARE_RANGES) {
			const words = NOTICES[`range_${range}`];
			expect(en[RANGE_WORDS[range]]).toBe(words);
			expect(sharedLine("Ana", { to_user_id: BO, range }, ME, nameOf)).toBe(
				notice("shared", { a: "Ana", range: words, b: "Bo" }),
			);
			expect(sharedLine("Ana", { to_user_id: ME, range }, ME, nameOf)).toBe(
				notice("shared_with_you", { a: "Ana", range: words }),
			);
		}
		// A range the four don't name reads as the whole history, as the words' other case does.
		expect(sharedLine("Ana", { to_user_id: BO, range: "year" }, ME, nameOf)).toBe(
			notice("shared", { a: "Ana", range: NOTICES.range_all, b: "Bo" }),
		);
	});

	test("a share that went whole says nothing; one cut to the newest says from when the member has everything", () => {
		expect(outcomeLine({ sent: true, truncated: false, start: 0 }, "Bo")).toBeNull();
		const start = Date.UTC(2026, 10, 19, 12);
		expect(outcomeLine({ sent: true, truncated: true, start }, "Bo")).toBe(
			notice("share_history_truncated", { name: "Bo", date: "November 19, 2026" }),
		);
	});

	test("the eleventh share of the hour says why it didn't go, and when the next can", () => {
		expect(outcomeLine({ sent: false, why: "limit", retryAfterMs: 12 * 60_000 - 5 }, "Bo")).toBe(
			notice("share_history_limit", { when: "in 12 minutes" }),
		);
		expect(outcomeLine({ sent: false, why: "limit", retryAfterMs: 1 }, "Bo")).toBe(
			notice("share_history_limit", { when: "in 1 minute" }),
		);
	});

	test("a member without a device, and a refusal, in the API's words when it gave some", () => {
		expect(outcomeLine({ sent: false, why: "no_device" }, "Bo")).toBe(
			notice("share_history_no_device", { name: "Bo" }),
		);
		expect(
			outcomeLine({ sent: false, why: "refused", error: "the history share doesn't fit in your storage" }, "Bo"),
		).toBe("the history share doesn't fit in your storage");
		expect(outcomeLine({ sent: false, why: "refused", error: null }, "Bo")).toBe(NOTICES.share_history_failed);
	});

	test("the app's words are the table's", () => {
		const words: [keyof typeof en, NoticeKey][] = [
			["e2e_share_history", "share_history"],
			["e2e_share_history_with", "share_history_with"],
			["e2e_share_history_line", "share_history_line"],
			["e2e_share_history_send", "share_history_send"],
			["e2e_share_history_sharing", "share_history_sharing"],
			["e2e_share_history_truncated", "share_history_truncated"],
			["e2e_share_history_limit", "share_history_limit"],
			["e2e_share_history_failed", "share_history_failed"],
			["e2e_share_history_no_device", "share_history_no_device"],
			["e2e_shared_add", "shared_add"],
			["e2e_shared_add_failed", "shared_add_failed"],
			["e2e_shared_by", "shared_by"],
		];
		for (const [key, table] of words) expect(en[key]).toBe(NOTICES[table]);
	});
});
