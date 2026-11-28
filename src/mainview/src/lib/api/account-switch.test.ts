import { afterEach, describe, expect, jest, spyOn, test } from "bun:test";
import { activateAccount, type StoredAccount } from "$lib/accounts";
import { followAccount, forgetUser, keepUser, PageAccount } from "$lib/e2e/client";
import { openGateway } from "./ws/test-gateway";

// #612: the web's tabs, and the desktop app's windows, share one storage, where a switch of accounts in one page puts
// the switched-to account's session. Every other page kept its own engine, core and database, and went on as the other
// account at its next request. Each page now follows the account storage names, and one whose account another page
// changed sends nothing more with that session, and loads again as it.

const ANA = "0193a4b2-0000-7000-8000-0000000000a1";
const BEN = "0193a4b2-0000-7000-8000-0000000000b1";
const ben: StoredAccount = {
	id: BEN,
	name: "Ben",
	username: "ben",
	avatar: null,
	accessToken: "access-b",
	refreshToken: "session-b",
};

afterEach(() => localStorage.clear());

describe("a switch of accounts in one page", () => {
	test("reaches every other page over one storage: each loads again, once, as the switched-to account", () => {
		keepUser(ANA);
		let [leftA, leftB] = [0, 0];
		const a = new PageAccount(() => leftA++);
		const b = new PageAccount(() => leftB++);
		expect([a.own(), b.own()]).toEqual([true, true]);

		// A's Settings switches to Ben: A goes on to its next page, as Ben.
		activateAccount(ben);
		// B finds the session storage holds isn't its account's: it sends nothing with it, and loads again.
		expect(b.own()).toBe(false);
		expect(b.own()).toBe(false);
		expect(leftB).toBe(1);
		// And A, on its way out, sends nothing more with Ben's session under Ana's.
		expect(a.own()).toBe(false);
		expect(leftA).toBe(1);
		// Their next pages are Ben's.
		expect(new PageAccount(() => {}).own()).toBe(true);
	});

	test("never reloads a page for its own READY or sign-in", () => {
		keepUser(ANA);
		let left = 0;
		const page = new PageAccount(() => left++);
		// Its READY says whose session its tokens are, which may not be the account storage named (a session that
		// started as another account's): its own word.
		keepUser(BEN);
		page.agree();
		expect(page.own()).toBe(true);
		// A sign-in forgets whose session there was, for the page it goes on to.
		forgetUser();
		page.agree();
		expect(page.own()).toBe(true);
		expect(left).toBe(0);
	});
});

describe("a sign-in in another page", () => {
	// #623: a sign-in names no account until its READY, so a page loaded right after one agreed with none, and another
	// page's sign-in, which names none either, changed nothing it compared.
	test("reaches a page that agrees with no account: it loads again, once", () => {
		forgetUser();
		let left = 0;
		const page = new PageAccount(() => left++);
		expect(page.own()).toBe(true);
		// Another tab signs in.
		forgetUser();
		expect(page.own()).toBe(false);
		expect(page.own()).toBe(false);
		expect(left).toBe(1);
	});
});

describe("a page whose account another page switched", () => {
	// The main window's renewal, which the desktop app's other windows take from storage (lib/session.ts), and another
	// tab of the same account's: the session's tokens change, its account doesn't.
	test("goes on through another page's renewal of the same account's session", async () => {
		keepUser(ANA);
		let heard: (key: string | null) => void = () => {};
		let reloads = 0;
		followAccount(
			(changed) => (heard = changed),
			() => reloads++,
		);
		const { default: api } = await import("$lib/api/api");
		const fetched = spyOn(globalThis, "fetch").mockImplementation((async (_input: string | URL | Request) =>
			Response.json({})) as typeof fetch);
		try {
			localStorage.setItem("duvet_session_token", "access-a2");
			localStorage.setItem("duvet_refresh_token", "session-a2");
			heard("duvet_session_token");
			heard("duvet_refresh_token");
			// Ana's READY in another tab writes what storage has already.
			keepUser(ANA);
			heard("duvet.e2e.user");
			await api.get("/api/users/@me");
			expect(fetched).toHaveBeenCalledTimes(1);
			expect(reloads).toBe(0);
		} finally {
			fetched.mockRestore();
		}
	});

	test("sends no request, renewal, socket or identify with the switched-to session, and its READY writes nothing", async () => {
		localStorage.setItem("duvet_session_token", "access-a");
		localStorage.setItem("duvet_refresh_token", "session-a");
		keepUser(ANA);
		// This page, as stores/auth.ts makes the app's pages follow the account: another page's write reaches it as the
		// storage event, which this test raises.
		let heard: (key: string | null) => void = () => {};
		let reloads = 0;
		followAccount(
			(changed) => (heard = changed),
			() => reloads++,
		);
		const { default: api, refreshSession } = await import("$lib/api/api");
		const gateway = await openGateway();
		expect(gateway.sent("identify")).toHaveLength(1);
		const fetched = spyOn(globalThis, "fetch").mockImplementation((async (_input: string | URL | Request) =>
			Response.json({})) as typeof fetch);
		jest.useFakeTimers();
		try {
			// Another tab's Settings switches to Ben.
			activateAccount(ben);
			heard("duvet.e2e.user");
			expect(reloads).toBe(1);

			// Until it loads again, nothing goes out with Ben's tokens: no request, no renewal.
			void api.get("/api/users/@me");
			void refreshSession();
			await Promise.resolve();
			expect(fetched).not.toHaveBeenCalled();
			// The READY of its own session, Ana's, which its identify asked for before the switch, leaves Ben's in storage.
			gateway.receive("READY", { user: { id: ANA, username: "ana" }, sessionToken: "gateway", guild_ids: [] });
			expect(localStorage.getItem("duvet.e2e.user")).toBe(BEN);
			// Its socket ending opens none, with Ben's token in its address.
			const socket: { onclose: (() => void) | null } = Reflect.get(globalThis.WebSocket, "last");
			socket.onclose?.();
			jest.advanceTimersByTime(60_000);
			expect(Reflect.get(globalThis.WebSocket, "last")).toBe(socket);
			expect(gateway.sent("identify")).toHaveLength(1);
			expect(reloads).toBe(1);
		} finally {
			jest.useRealTimers();
			fetched.mockRestore();
			gateway.close();
		}
	});
});
