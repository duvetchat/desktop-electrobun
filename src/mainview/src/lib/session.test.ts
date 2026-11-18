import { describe, expect, test } from "bun:test";
import {
	NoRenewalError,
	renewalDue,
	renewalFirst,
	renewedByMainWindow,
	renewOnceMore,
	keepTokenWithStorage,
	SESSION_CHANNEL,
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

	// C-13: a second window could only wait for a renewal the main window had no reason to make yet.
	test("asks the main window to renew when storage holds nothing newer, once it watches", async () => {
		const shared = storage("access-1");
		const asked: number[] = [];
		const renewed = renewedByMainWindow({
			...shared,
			stale: "access-1",
			timeoutMs: 1000,
			ask: () => void asked.push(shared.watching()),
		});
		// Asked once, with the watch already on: the answer is the token the main window writes.
		expect(asked).toEqual([1]);
		shared.write("access-2");
		expect(await renewed).toBe("access-2");
	});

	test("asks nothing when the renewal is already there", async () => {
		const shared = storage("access-2");
		let asked = 0;
		await renewedByMainWindow({ ...shared, stale: "access-1", timeoutMs: 50, ask: () => void asked++ });
		expect(asked).toBe(0);
	});

	test("fails after its wait when no renewal comes, without watching on", async () => {
		const shared = storage("access-1");
		const renewed = renewedByMainWindow({ ...shared, stale: "access-1", timeoutMs: 20 });
		await expect(renewed).rejects.toBeInstanceOf(NoRenewalError);
		expect(shared.watching()).toBe(0);
	});
});

// C-13: every window wrote the shared token as its page loaded, and whenever its own copy changed.
describe("a window's copy of the access token", () => {
	function page(stored: string | null) {
		const items = new Map<string, string>(stored ? [["duvet_session_token", stored]] : []);
		const writes: string[] = [];
		const storage = {
			getItem: (key: string) => items.get(key) ?? null,
			setItem: (key: string, value: string) => {
				writes.push(`set ${value}`);
				items.set(key, value);
			},
			removeItem: (key: string) => {
				writes.push("remove");
				items.delete(key);
			},
		};
		let copy = stored;
		const subscribers: ((token: string | null) => void)[] = [];
		const token = {
			subscribe: (run: (token: string | null) => void) => {
				subscribers.push(run);
				run(copy);
			},
			set: (next: string | null) => {
				copy = next;
				for (const run of subscribers) run(next);
			},
		};
		const listeners: ((key: string | null) => void)[] = [];
		/** Another window writes storage: the storage event here. */
		const otherWindowWrites = (key: string | null, value: string | null) => {
			if (key && value) items.set(key, value);
			else if (key) items.delete(key);
			else items.clear();
			for (const listener of listeners) listener(key);
		};
		return { storage, token, writes, copy: () => copy, listeners, otherWindowWrites };
	}

	test("the main window's is written to storage: a sign-in, a renewal, a sign-out", () => {
		const { storage, token, writes, listeners } = page("access-1");
		keepTokenWithStorage(true, token, storage, (changed) => void listeners.push(changed));
		token.set("access-2");
		token.set(null);
		expect(writes).toEqual(["set access-1", "set access-2", "remove"]);
		expect(listeners).toHaveLength(0);
	});

	test("another window's is never written: not as its page loads, nor when it changes", () => {
		const { storage, token, writes } = page("access-1");
		keepTokenWithStorage(false, token, storage, () => {});
		token.set("access-0");
		token.set(null);
		expect(writes).toEqual([]);
		expect(storage.getItem("duvet_session_token")).toBe("access-1");
	});

	test("another window's follows what the main window writes, a sign-out included", () => {
		const { storage, token, copy, listeners, otherWindowWrites, writes } = page("access-1");
		keepTokenWithStorage(false, token, storage, (changed) => void listeners.push(changed));
		otherWindowWrites("duvet_session_token", "access-2");
		expect(copy()).toBe("access-2");
		otherWindowWrites("duvet.theme", "dark");
		expect(copy()).toBe("access-2");
		otherWindowWrites(null, null);
		expect(copy()).toBeNull();
		expect(writes).toEqual([]);
	});

	test("the session's channel has a name", () => {
		expect(SESSION_CHANNEL).toBe("session");
	});
});
