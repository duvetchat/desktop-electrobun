import { describe, expect, test } from "bun:test";
import { renewalDue, renewOnceMore } from "$lib/session";

const HOUR = 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 24, 12);

describe("renewalDue", () => {
	test("as the app starts or its window comes back, tokens an hour old or older renew", () => {
		for (const check of ["start", "visible"] as const) {
			expect(renewalDue(check, now - HOUR, now)).toBe(true);
			expect(renewalDue(check, now - 20 * HOUR, now)).toBe(true);
			expect(renewalDue(check, now - HOUR + 1000, now)).toBe(false);
		}
	});

	test("the 10-minute tick renews them an hour before the session's 24 run out", () => {
		expect(renewalDue("tick", now - 23 * HOUR, now)).toBe(true);
		expect(renewalDue("tick", now - 22 * HOUR, now)).toBe(false);
		expect(renewalDue("tick", now - 2 * HOUR, now)).toBe(false);
	});

	test("tokens whose time was never noted renew at any check", () => {
		expect(renewalDue("tick", 0, now)).toBe(true);
		expect(renewalDue("start", 0, now)).toBe(true);
	});
});

describe("renewOnceMore", () => {
	// A renewal that fails with each of `failures` in turn, then gets its tokens.
	function renewal(failures: unknown[]) {
		let runs = 0;
		const renew = async () => {
			runs++;
			const failure = failures.shift();
			if (failure) throw failure;
			return "tokens";
		};
		return { renew, runs: () => runs };
	}
	// The API's refusal: an answer, unlike a network error.
	const refused = new Error("401");
	const answered = (err: unknown) => err === refused;
	const lost = () => new TypeError("Failed to fetch");

	test("a renewal that failed without an answer runs once more, after the wait", async () => {
		const r = renewal([lost()]);
		let waits = 0;
		const tokens = await renewOnceMore(r.renew, answered, async () => {
			waits++;
		});
		expect(tokens).toBe("tokens");
		expect(r.runs()).toBe(2);
		expect(waits).toBe(1);
	});

	test("one the API answered runs once, refused or not", async () => {
		const refusedRun = renewal([refused]);
		await expect(renewOnceMore(refusedRun.renew, answered, async () => {})).rejects.toBe(refused);
		expect(refusedRun.runs()).toBe(1);

		const done = renewal([]);
		expect(await renewOnceMore(done.renew, answered, async () => {})).toBe("tokens");
		expect(done.runs()).toBe(1);
	});

	test("only once: a second lost answer fails the renewal", async () => {
		const second = lost();
		const r = renewal([lost(), second]);
		await expect(renewOnceMore(r.renew, answered, async () => {})).rejects.toBe(second);
		expect(r.runs()).toBe(2);
	});
});
