import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keepSessionFresh } from "$lib/api/api";

// The app's renewal checks listen for its window coming back; Bun has no document.
Object.assign(globalThis, { document: { hidden: false, addEventListener() {}, removeEventListener() {} } });

const HOUR = 60 * 60 * 1000;
let refreshes = 0;
let fetched: ReturnType<typeof spyOn>;

beforeEach(() => {
	refreshes = 0;
	localStorage.setItem("duvet_refresh_token", "session token");
	fetched = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
		const url = input instanceof Request ? input.url : input.toString();
		if (url.endsWith("/api/auth/refresh")) refreshes++;
		return Response.json({ token: "new access token", session_token: "new session token" });
	}) as typeof fetch);
});

afterEach(() => {
	fetched.mockRestore();
	localStorage.clear();
});

const refreshedAgo = (ms: number) => localStorage.setItem("duvet_session_refreshed_at", String(Date.now() - ms));
const settled = (promise: Promise<unknown>) => {
	let done = false;
	void promise.then(() => (done = true));
	return () => done;
};

// The gateway's socket opened only once the start's renewal was done: three round trips on almost every start (#281).
describe("the session's renewal as the app starts", () => {
	test("is ready at once with tokens an hour old or more, and renews once the app says it's connected, once", async () => {
		refreshedAgo(2 * HOUR);
		const session = keepSessionFresh();
		const ready = settled(session.ready);
		await Bun.sleep(0);
		expect(ready()).toBe(true);
		expect(refreshes).toBe(0);

		session.connected();
		session.connected();
		await Bun.sleep(0);
		expect(refreshes).toBe(1);
		session.stop();
	});

	test("renews before it's ready when the tokens are in their last hour, which the gateway would refuse", async () => {
		refreshedAgo(23.5 * HOUR);
		const session = keepSessionFresh();
		await session.ready;
		expect(refreshes).toBe(1);
		session.connected();
		await Bun.sleep(0);
		expect(refreshes).toBe(1);
		session.stop();
	});

	test("doesn't renew young tokens at all", async () => {
		refreshedAgo(10 * 60 * 1000);
		const session = keepSessionFresh();
		await session.ready;
		session.connected();
		await Bun.sleep(0);
		expect(refreshes).toBe(0);
		session.stop();
	});

	test("the app page says it's connected once the app is up", () => {
		const page = readFileSync(join(import.meta.dir, "../../routes/app/+page.svelte"), "utf8");
		expect(page).toMatch(/friendsReady\.subscribe\(\(ready\) => \{\s*if \(ready\) session\.connected\(\);\s*\}\)/);
	});
});
