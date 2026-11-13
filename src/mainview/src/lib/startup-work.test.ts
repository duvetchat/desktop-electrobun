import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What the app page does as it starts that its first screen doesn't need (#285), and what its head script starts
// before the app's JavaScript runs (#291).
const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

const HOUR = 60 * 60 * 1000;
const START = JSON.stringify({ gateway: "wss://ws.example/gateway", api: "https://api.example" });

type Hint = { rel: string; href: string; crossOrigin: string };

// Runs app.html's head script on a page at path, with a session or none and what else localStorage holds, on a port:
// where it sends the page, if anywhere, the sockets it starts and the links it adds to the head.
function bootstrap(
	path: string,
	session: string | null,
	stored: Record<string, string> = {},
	port = "",
): { sentTo: string | null; sockets: string[]; hints: Hint[]; early: unknown } {
	const body = source("../app.html").match(/<script>([\s\S]*?)<\/script>/)?.[1];
	if (!body) throw new Error("app.html has no head script");
	let sentTo: string | null = null;
	const sockets: string[] = [];
	const hints: Hint[] = [];
	const window: Record<string, unknown> = {
		location: { pathname: path, port, replace: (to: string) => (sentTo = to) },
		matchMedia: () => ({ matches: false }),
	};
	const storage = { getItem: (key: string) => (key === "duvet_session_token" ? session : (stored[key] ?? null)) };
	const document = {
		documentElement: { classList: { add: () => {} } },
		createElement: (): Hint => ({ rel: "", href: "", crossOrigin: "" }),
		head: { appendChild: (link: Hint) => hints.push(link) },
	};
	class StandInSocket {
		constructor(url: string) {
			sockets.push(url);
		}
		addEventListener() {}
	}
	// eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script as the page runs it, with stand-ins
	new Function("window", "localStorage", "document", "WebSocket", body)(window, storage, document, StandInSocket);
	return { sentTo, sockets, hints, early: window.__duvetEarlySocket };
}

const fresh = { duvet_session_refreshed_at: String(Date.now() - 2 * HOUR), "duvet.start.v1": START };

describe("the packaged app opens app.html itself, rather than index.html, which loaded it as a second page", () => {
	test("app.html sends a page with no session to sign in, and keeps one with a session", () => {
		expect(bootstrap("/app.html", null).sentTo).toBe("/sign-in.html");
		expect(bootstrap("/app.html", "token").sentTo).toBeNull();
	});

	test("index.html still sends on, by the session, as duvet.chat's root does", () => {
		expect(bootstrap("/index.html", "token").sentTo).toBe("/app.html");
		expect(bootstrap("/index.html", null).sentTo).toBe("/sign-in.html");
	});

	test("Bun opens app.html", () => {
		expect(source("../../../bun/index.ts")).toContain('return "views://mainview/app.html";');
	});
});

describe("app.html's head script starts the gateway's socket as the page loads, for the connection to take on", () => {
	test("with a session, at the address the app last used, with the token", () => {
		const page = bootstrap("/app.html", "token", fresh);
		expect(page.sockets).toEqual(["wss://ws.example/gateway?token=token"]);
		expect(page.early).toBeDefined();
	});

	test("not with tokens in their last hour, which the app renews first, as renewalFirst has it", () => {
		const old = { ...fresh, duvet_session_refreshed_at: String(Date.now() - 23 * HOUR) };
		expect(bootstrap("/app.html", "token", old).sockets).toEqual([]);
		expect(source("../app.html")).toContain("23 * 60 * 60 * 1000");
		expect(source("session.ts")).toContain("const RENEW_ON_TICK_MS = 23 * 60 * 60 * 1000;");
	});

	test("not without the addresses noted, nor on the dev server, nor on another page", () => {
		expect(
			bootstrap("/app.html", "token", { duvet_session_refreshed_at: fresh.duvet_session_refreshed_at }).sockets,
		).toEqual([]);
		expect(bootstrap("/app", "token", fresh, "5173").sockets).toEqual([]);
		expect(bootstrap("/sign-in.html", "token", fresh).sockets).toEqual([]);
	});
});

// The lists' first requests opened the API's connection before their preflights (#293).
describe("app.html's head script opens the API's connection as the page loads", () => {
	const preconnect = [{ rel: "preconnect", href: "https://api.example", crossOrigin: "use-credentials" }];

	test("with credentials, as the API's requests are made, at the address the app last used", () => {
		expect(bootstrap("/app.html", "token", fresh).hints).toEqual(preconnect);
		expect(source("api/api.ts")).toContain('credentials: "include"');
	});

	test("with tokens in their last hour too, whose renewal is the first request", () => {
		const old = { ...fresh, duvet_session_refreshed_at: String(Date.now() - 23 * HOUR) };
		expect(bootstrap("/app.html", "token", old).hints).toEqual(preconnect);
	});

	test("not without a session, nor without the addresses noted, nor on the dev server", () => {
		expect(bootstrap("/app.html", null, fresh).hints).toEqual([]);
		expect(
			bootstrap("/app.html", "token", { duvet_session_refreshed_at: fresh.duvet_session_refreshed_at }).hints,
		).toEqual([]);
		expect(bootstrap("/app", "token", fresh, "5173").hints).toEqual([]);
	});
});

test("the noise suppression, 4.8 MB of WASM as base64, loads when voice needs it, not with the app page", () => {
	const voice = source("components/VoiceChat.svelte");
	expect(voice).not.toMatch(/import \{[^}]*\} from "\$lib\/audio\/noise-suppression";/);
	expect(voice).toContain('await import("$lib/audio/noise-suppression")');
});
