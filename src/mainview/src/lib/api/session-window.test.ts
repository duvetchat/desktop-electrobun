import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import api, { keepSessionFresh, refreshSession, requestLimits } from "$lib/api/api";
import { NoRenewalError } from "$lib/session";
import { accessToken } from "$lib/stores/auth";

// #357: the session's renewal in a window that isn't the main one (the media controls' pop-out here). Only the main
// window renews (docs/redesign/DECISIONS.md): this page never asks the API to, and takes the renewal the main window
// leaves in the localStorage they share. The main window's own renewal is api.test.ts's and session-start.test.ts's.

// This page as Electrobun and Bun's preload leave it (src/bun/shell.ts), with the storage event another window's
// write raises here.
const storageListeners = new Set<(event: { key: string | null }) => void>();
Object.assign(globalThis, {
	window: {
		__electrobunWindowId: 2,
		addEventListener: (type: string, listener: (event: { key: string | null }) => void) => {
			if (type === "storage") storageListeners.add(listener);
		},
		removeEventListener: (_type: string, listener: (event: { key: string | null }) => void) => {
			storageListeners.delete(listener);
		},
	},
	__duvetShell: { os: "darwin", titleBarStyle: "hiddenInset", nativeButtons: true, glass: false, window: "media" },
	document: { hidden: false, addEventListener() {}, removeEventListener() {} },
});

/** The main window renews: its tokens land in the storage the windows share, and this window hears of it. */
function mainWindowRenews(token: string) {
	localStorage.setItem("duvet_session_token", token);
	localStorage.setItem("duvet_refresh_token", `session of ${token}`);
	for (const listener of [...storageListeners]) listener({ key: "duvet_session_token" });
}

let requests: { url: string; authorization: string | null }[] = [];
let answer: (url: string, authorization: string | null) => Response;
let fetched: ReturnType<typeof spyOn>;

beforeEach(() => {
	requests = [];
	answer = () => Response.json({ ok: true });
	localStorage.setItem("duvet_session_token", "access-1");
	localStorage.setItem("duvet_refresh_token", "session of access-1");
	accessToken.set("access-1");
	fetched = spyOn(globalThis, "fetch").mockImplementation((async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const url = input instanceof Request ? input.url : input.toString();
		const authorization = new Headers(init?.headers).get("Authorization");
		requests.push({ url, authorization });
		return answer(url, authorization);
	}) as typeof fetch);
});

afterEach(() => {
	fetched.mockRestore();
	localStorage.clear();
	storageListeners.clear();
});

const refreshes = () => requests.filter((request) => request.url.endsWith("/api/auth/refresh"));

describe("a window that isn't the main one", () => {
	test("never asks the API to renew: it takes the main window's renewal from storage", async () => {
		const renewed = refreshSession();
		await Bun.sleep(0);
		expect(storageListeners.size).toBe(1);
		mainWindowRenews("access-2");
		expect(await renewed).toBe("access-2");
		expect(get(accessToken)).toBe("access-2");
		expect(refreshes()).toEqual([]);
		expect(storageListeners.size).toBe(0);
	});

	// C-21: that a write in one window raises the storage event in another was only ever seen on macOS.
	test("takes a renewal no storage event told it of, by looking", async () => {
		const look = requestLimits.renewalLookMs;
		requestLimits.renewalLookMs = 10;
		try {
			const renewed = refreshSession();
			await Bun.sleep(0);
			// The main window writes, and no event reaches this window.
			localStorage.setItem("duvet_session_token", "access-2");
			expect(await renewed).toBe("access-2");
			expect(get(accessToken)).toBe("access-2");
		} finally {
			requestLimits.renewalLookMs = look;
		}
		expect(refreshes()).toEqual([]);
		// It stops looking once it has the token: nothing reads storage after.
		const read = spyOn(localStorage, "getItem");
		await Bun.sleep(40);
		expect(read).not.toHaveBeenCalled();
		read.mockRestore();
	});

	test("takes at once a renewal that happened while it wasn't looking", async () => {
		localStorage.setItem("duvet_session_token", "access-2");
		expect(await refreshSession()).toBe("access-2");
		expect(get(accessToken)).toBe("access-2");
		expect(refreshes()).toEqual([]);
	});

	// A request refused with an expired token waits for the main window's renewal, then goes again with it.
	test("sends a refused request again with the main window's new token, and renews nothing itself", async () => {
		answer = (_url, authorization) =>
			authorization === "Bearer access-2" ? Response.json({ id: "me" }) : Response.json({}, { status: 401 });
		const response = api.get("/api/users/@me");
		await Bun.sleep(5);
		expect(requests.map((request) => request.authorization)).toEqual(["Bearer access-1"]);
		mainWindowRenews("access-2");
		expect((await response).data).toEqual({ id: "me" });
		expect(requests.map((request) => request.authorization)).toEqual(["Bearer access-1", "Bearer access-2"]);
		expect(refreshes()).toEqual([]);
	});

	test("keeps no renewal schedule of its own, however old the session", async () => {
		localStorage.setItem("duvet_session_refreshed_at", String(Date.now() - 30 * 60 * 60 * 1000));
		const session = keepSessionFresh();
		await session.ready;
		session.connected();
		await Bun.sleep(5);
		session.stop();
		expect(requests).toEqual([]);
		expect(storageListeners.size).toBe(0);
	});

	test("signs nobody out when no renewal comes: the request fails, and the session stays", async () => {
		const wait = requestLimits.mainWindowRenewalMs;
		requestLimits.mainWindowRenewalMs = 20;
		try {
			answer = () => Response.json({}, { status: 401 });
			await expect(api.get("/api/users/@me")).rejects.toBeInstanceOf(NoRenewalError);
			await expect(refreshSession()).rejects.toBeInstanceOf(NoRenewalError);
		} finally {
			requestLimits.mainWindowRenewalMs = wait;
		}
		expect(refreshes()).toEqual([]);
		expect(localStorage.getItem("duvet_session_token")).toBe("access-1");
		expect(localStorage.getItem("duvet_refresh_token")).toBe("session of access-1");
		expect(storageListeners.size).toBe(0);
	});

	// A refresh's own limit and its second try, 3 s later.
	test("waits as long as the main window's renewal can take", () => {
		expect(requestLimits.mainWindowRenewalMs).toBeGreaterThanOrEqual(requestLimits.answerMs + 3000);
	});
});
