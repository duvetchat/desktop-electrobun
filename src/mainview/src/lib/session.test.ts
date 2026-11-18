import { describe, expect, test } from "bun:test";
import {
	NoRenewalError,
	renewalDue,
	renewalFirst,
	renewedByMainWindow,
	renewOnceMore,
	windowRenewsSession,
} from "$lib/session";

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

// As the app starts, a renewal due goes before the gateway connection only when the tokens are about to run out, which
// the gateway would refuse: otherwise the connection opens at once, and the renewal follows it (#281).
describe("renewalFirst", () => {
	test("tokens in their last hour, or past it, renew before the connection opens", () => {
		expect(renewalFirst(now - 23 * HOUR, now)).toBe(true);
		expect(renewalFirst(now - 30 * HOUR, now)).toBe(true);
	});

	test("younger ones don't: the connection opens with them", () => {
		expect(renewalFirst(now - 23 * HOUR + 1000, now)).toBe(false);
		expect(renewalFirst(now - 2 * HOUR, now)).toBe(false);
	});

	test("tokens whose time was never noted renew first", () => {
		expect(renewalFirst(0, now)).toBe(true);
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

// #357: the pop-out and the Settings windows share the main window's session through localStorage. A renewal rotates
// the session token, so two windows renewing at once would each revoke the other's: only the main window renews
// (docs/redesign/DECISIONS.md), and the others take its renewal from storage.
describe("which window renews the session", () => {
	test("the main window, and no other", () => {
		expect(windowRenewsSession("main")).toBe(true);
		for (const window of ["media", "settings", "space-settings"] as const) {
			expect(windowRenewsSession(window)).toBe(false);
		}
	});
});

describe("a window that doesn't renew takes the main window's renewal", () => {
	/** Storage's access token as the windows share it, and whoever watches it. */
	function storage(token: string | null) {
		const watchers = new Set<() => void>();
		return {
			read: () => token,
			watch: (changed: () => void) => {
				watchers.add(changed);
				return () => watchers.delete(changed);
			},
			/** Another window writes the token: the storage event. */
			write(next: string | null) {
				token = next;
				for (const changed of [...watchers]) changed();
			},
			watching: () => watchers.size,
		};
	}

	test("at once when storage already holds a token newer than this window's copy", async () => {
		const shared = storage("access-2");
		expect(await renewedByMainWindow({ ...shared, stale: "access-1", timeoutMs: 50 })).toBe("access-2");
		expect(shared.watching()).toBe(0);
	});

	test("when the main window writes it, and then stops watching", async () => {
		const shared = storage("access-1");
		const renewed = renewedByMainWindow({ ...shared, stale: "access-1", timeoutMs: 1000 });
		expect(shared.watching()).toBe(1);
		shared.write("access-2");
		expect(await renewed).toBe("access-2");
		expect(shared.watching()).toBe(0);
	});

	test("not for a change that leaves the same token, or none", async () => {
		const shared = storage("access-1");
		let settled = false;
		const renewed = renewedByMainWindow({ ...shared, stale: "access-1", timeoutMs: 1000 });
		void renewed.then(() => (settled = true));
		shared.write("access-1");
		shared.write(null);
		await Bun.sleep(0);
		expect(settled).toBe(false);
		shared.write("access-2");
		expect(await renewed).toBe("access-2");
	});

	test("fails after its wait when no renewal comes, without watching on", async () => {
		const shared = storage("access-1");
		const renewed = renewedByMainWindow({ ...shared, stale: "access-1", timeoutMs: 20 });
		await expect(renewed).rejects.toBeInstanceOf(NoRenewalError);
		expect(shared.watching()).toBe(0);
	});
});
