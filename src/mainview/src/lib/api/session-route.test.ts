import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keepSessionFresh, refreshSession, requestLimits } from "$lib/api/api";
import { currentShell } from "$lib/platform";
import { NoRenewalError } from "$lib/session";
import { accessToken } from "$lib/stores/auth";
import { answerWindowCommand } from "$lib/window-commands";
import { answerWindows, publishToWindows } from "$lib/window-hub";

// C-13 of the redesign's review: a window whose preload did not run believed it was the main window. Here a Settings
// window's page runs in Electrobun with nothing from Bun at all (no window.__duvetShell): its address alone says which
// window it is (lib/app-windows.ts), and it does none of what only the main window does. session-window.test.ts is the
// same page with its preload.
Object.assign(globalThis, {
	window: { __electrobunWindowId: 3, addEventListener() {}, removeEventListener() {} },
	location: { pathname: "/settings.html", href: "views://mainview/settings.html" },
	document: { hidden: false, addEventListener() {}, removeEventListener() {} },
});

let requests: string[] = [];
let fetched: ReturnType<typeof spyOn>;

beforeEach(() => {
	requests = [];
	localStorage.setItem("duvet_session_token", "access-1");
	localStorage.setItem("duvet_refresh_token", "session of access-1");
	accessToken.set("access-1");
	fetched = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
		requests.push(input instanceof Request ? input.url : input.toString());
		return Response.json({ token: "access-2", session_token: "session of access-2" });
	}) as typeof fetch);
});

afterEach(() => {
	fetched.mockRestore();
	localStorage.clear();
});

describe("a Settings page whose preload did not run", () => {
	test("is still Settings' window, not the main one", () => {
		expect("__duvetShell" in globalThis).toBe(false);
		expect(currentShell().window).toBe("settings");
	});

	test("never renews the session: no request, and the shared tokens stay as they were", async () => {
		const wait = requestLimits.mainWindowRenewalMs;
		requestLimits.mainWindowRenewalMs = 20;
		try {
			await expect(refreshSession()).rejects.toBeInstanceOf(NoRenewalError);
		} finally {
			requestLimits.mainWindowRenewalMs = wait;
		}
		expect(requests).toEqual([]);
		expect(localStorage.getItem("duvet_session_token")).toBe("access-1");
		expect(localStorage.getItem("duvet_refresh_token")).toBe("session of access-1");
	});

	test("keeps no renewal schedule, however old the session", async () => {
		localStorage.setItem("duvet_session_refreshed_at", String(Date.now() - 30 * 60 * 60 * 1000));
		const session = keepSessionFresh();
		await session.ready;
		session.connected();
		await Bun.sleep(5);
		session.stop();
		expect(requests).toEqual([]);
	});

	test("answers no other window's commands, whoever asks it to", async () => {
		answerWindows("settings", { logout: () => true });
		// keepSessionFresh would add the session's renew in the main window.
		keepSessionFresh();
		expect(await answerWindowCommand({ channel: "settings", name: "logout" })).toEqual({
			ok: false,
			error: "No command settings.logout",
		});
		expect(await answerWindowCommand({ channel: "session", name: "renew" })).toEqual({
			ok: false,
			error: "No command session.renew",
		});
	});

	test("publishes nothing as the main window's", () => {
		expect(() => publishToWindows("sync:user", { id: "u1" })).not.toThrow();
		// The hub made no publisher: a later main-window call would start its numbers at 1.
		const hub = readFileSync(join(import.meta.dir, "../window-hub.ts"), "utf8");
		expect(hub).toMatch(/export function publishToWindows[^}]*?if \(currentShell\(\)\.window !== "main"\) return;/s);
	});

	// The lowest gate: whatever hands the RPC an answerer in such a page, the RPC doesn't take it.
	test("the RPC takes no answerer in a page of another window", () => {
		const rpc = readFileSync(join(import.meta.dir, "../electrobun-rpc.ts"), "utf8");
		expect(rpc).toMatch(
			/windowCommand: \(handler\) => \{[^}]*if \(secondWindowOfPath\(location\.pathname\) === null\) commandAnswerer = handler;/s,
		);
	});
});

// Only one module opens the gateway's socket, and no page of another window reaches it (module-graph.test.ts): that
// holds by the page's imports, with or without a preload.
