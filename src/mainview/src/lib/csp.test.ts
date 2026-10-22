import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import config from "../../svelte.config.js";

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
