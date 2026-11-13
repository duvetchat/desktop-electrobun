import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What the app page does as it starts that its first screen doesn't need (#285).
const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// Runs app.html's head script on a page at path, with a session or none, and gives where it sends the page, if anywhere.
function bootstrap(path: string, session: string | null): string | null {
	const body = source("../app.html").match(/<script>([\s\S]*?)<\/script>/)?.[1];
	if (!body) throw new Error("app.html has no head script");
	let sentTo: string | null = null;
	const window = {
		location: { pathname: path, port: "", replace: (to: string) => (sentTo = to) },
		matchMedia: () => ({ matches: false }),
	};
	const storage = { getItem: (key: string) => (key === "duvet_session_token" ? session : null) };
	const document = { documentElement: { classList: { add: () => {} } } };
	// eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script as the page runs it, with stand-ins
	new Function("window", "localStorage", "document", body)(window, storage, document);
	return sentTo;
}

describe("the packaged app opens app.html itself, rather than index.html, which loaded it as a second page", () => {
	test("app.html sends a page with no session to sign in, and keeps one with a session", () => {
		expect(bootstrap("/app.html", null)).toBe("/sign-in.html");
		expect(bootstrap("/app.html", "token")).toBeNull();
	});

	test("index.html still sends on, by the session, as duvet.chat's root does", () => {
		expect(bootstrap("/index.html", "token")).toBe("/app.html");
		expect(bootstrap("/index.html", null)).toBe("/sign-in.html");
	});

	test("Bun opens app.html", () => {
		expect(source("../../../bun/index.ts")).toContain('return "views://mainview/app.html";');
	});
});

test("the noise suppression, 4.8 MB of WASM as base64, loads when voice needs it, not with the app page", () => {
	const voice = source("components/VoiceChat.svelte");
	expect(voice).not.toMatch(/import \{[^}]*\} from "\$lib\/audio\/noise-suppression";/);
	expect(voice).toContain('await import("$lib/audio/noise-suppression")');
});

test("Shiki's highlighter is made once the socket is opening, while it waits on the network", () => {
	expect(source("../routes/app/+page.svelte")).toMatch(
		/conn = createWebSocketConnection\(\);\s*(\/\/[^\n]*\n\s*)*startCodeHighlighting\(\);/,
	);
});
