import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import config, { DEV_CONNECT_ENV, devConnectSources } from "../../svelte.config.js";

const here = dirname(fileURLToPath(import.meta.url));
const mainview = join(here, "..", "..");
const sha256 = (s: string) => "sha256-" + createHash("sha256").update(s, "utf8").digest("base64");

// Read the directives as a plain record (JSON round-trip) so the assertions don't need a type assertion
// against SvelteKit's strict CspDirectives type.
const directives: Record<string, string[]> = JSON.parse(JSON.stringify(config.kit?.csp?.directives ?? {}));

// These guard against the inline-script hashes in svelte.config.js drifting away from the source they
// pin. A locked script-src blocks any inline script or handler whose hash isn't listed, so if either
// source string changes the hash here must change with it — this test is how that gets caught.
describe("CSP inline-script hashes match the source they pin", () => {
	it("app.html bootstrap script is allowed (LF-normalised, what the parser hashes)", () => {
		const html = readFileSync(join(mainview, "src", "app.html"), "utf8");
		const body = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
		expect(body).toBeTruthy();
		const lf = body!.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		expect(directives["script-src"]).toContain(sha256(lf));
	});

	it("the emoji onerror handler in markdown.ts is allowed", () => {
		const md = readFileSync(join(mainview, "src", "lib", "markdown.ts"), "utf8");
		const handler = md.match(/onerror="([^"]*)"/)?.[1];
		expect(handler).toBeTruthy();
		expect(directives["script-src-attr"]).toContain(sha256(handler!));
	});
});

describe("CSP locks down the dangerous directives", () => {
	it("blocks plugins, base hijacking and cross-origin form posts", () => {
		expect(directives["object-src"]).toEqual(["none"]);
		expect(directives["base-uri"]).toEqual(["self"]);
		expect(directives["form-action"]).toEqual(["self"]);
	});

	it("allows no inline or remote scripts beyond the pinned hashes", () => {
		const scriptSrc = directives["script-src"];
		expect(scriptSrc).not.toContain("unsafe-inline");
		expect(scriptSrc).not.toContain("unsafe-eval");
		expect(scriptSrc).not.toContain("https:");
		expect(scriptSrc).not.toContain("http:");
		// only 'self', wasm-unsafe-eval and hash sources
		for (const src of scriptSrc) {
			expect(src === "self" || src === "wasm-unsafe-eval" || src.startsWith("sha256-")).toBe(true);
		}
	});
});

// The connect-src every build has: the API targets over TLS, the listed gateways and the local stack. The
// dev-only URL overrides add their origins only when vite.config.ts hands them over (development mode).
const BASE_CONNECT = [
	"self",
	"https:",
	"wss://*.duvet.chat",
	"wss://*.n128.xyz",
	"wss://*.andremor.eu.org",
	"http://localhost:*",
	"ws://localhost:*",
	"http://127.0.0.1:*",
	"ws://127.0.0.1:*",
];

describe("connect-src and the dev-only URL overrides", () => {
	it("is exactly the base list without overrides, as in every production build", () => {
		expect(process.env[DEV_CONNECT_ENV] ?? "").toBe("");
		expect(directives["connect-src"]).toEqual(BASE_CONNECT);
	});

	it("takes each override's origin: a LAN API, a wss gateway elsewhere, without paths or duplicates", () => {
		expect(
			devConnectSources("http://192.168.1.20:8080/ wss://gw.example.org/gateway http://192.168.1.20:8080"),
		).toEqual(["http://192.168.1.20:8080", "wss://gw.example.org"]);
		expect(devConnectSources("ws://10.0.0.5:8081")).toEqual(["ws://10.0.0.5:8081"]);
	});

	it("adds nothing for no overrides, or for what isn't an http(s) or ws(s) URL", () => {
		expect(devConnectSources(undefined)).toEqual([]);
		expect(devConnectSources("")).toEqual([]);
		expect(devConnectSources("not a url javascript:alert(1) data:text/plain,x file:///etc/passwd")).toEqual([]);
	});

	it("puts the overrides vite.config.ts hands over after the base list", async () => {
		process.env[DEV_CONNECT_ENV] = "http://192.168.1.20:8080 wss://gw.example.org";
		try {
			const fresh = (await import(`../../svelte.config.js?dev=${Date.now()}`)).default;
			const connect = JSON.parse(JSON.stringify(fresh.kit.csp.directives["connect-src"]));
			expect(connect).toEqual([...BASE_CONNECT, "http://192.168.1.20:8080", "wss://gw.example.org"]);
		} finally {
			delete process.env[DEV_CONNECT_ENV];
		}
	});
});
