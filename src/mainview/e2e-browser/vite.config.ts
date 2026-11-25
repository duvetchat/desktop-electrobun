// The harness page's build (scripts/web-e2e.ts runs it): this folder's index.html and page.ts, built by Vite in its
// release build, with $lib and the worker's format as the app has them (../vite.config.ts), and under the app's own
// CSP, written into the page as SvelteKit writes it into every prerendered one. Its mode, e2e-harness, lets the core's
// worker take the commands that cut it (lib/e2e/web/worker.ts): the app's builds never have them.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import svelteConfig from "../svelte.config.js";

/** What SvelteKit quotes in a CSP: its keywords, and hashes and nonces. */
const QUOTED = new Set([
	"self",
	"unsafe-eval",
	"unsafe-hashes",
	"unsafe-inline",
	"none",
	"strict-dynamic",
	"report-sample",
	"wasm-unsafe-eval",
	"script",
]);

/**
 * A CSP's directives as SvelteKit writes them into a page's <meta>: the sources of each, keywords and hashes quoted, and
 * none of the directives a <meta> can't hold.
 */
export function cspContent(directives: Record<string, unknown>): string {
	return Object.entries(directives)
		.filter(([name, value]) => value && !["frame-ancestors", "report-uri", "sandbox"].includes(name))
		.map(([name, value]) => {
			const sources = Array.isArray(value) ? value.map(String) : [];
			const written = sources.map((source) =>
				QUOTED.has(source) || /^(nonce|sha\d\d\d)-/.test(source) ? `'${source}'` : source,
			);
			return [name, ...written].join(" ");
		})
		.join("; ");
}

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	mode: "e2e-harness",
	resolve: { alias: { $lib: fileURLToPath(new URL("../src/lib", import.meta.url)) } },
	worker: { format: "es" },
	logLevel: "warn",
	plugins: [
		{
			name: "app-csp",
			transformIndexHtml: () => [
				{
					tag: "meta",
					attrs: {
						"http-equiv": "content-security-policy",
						content: cspContent({ ...svelteConfig.kit?.csp?.directives }),
					},
					injectTo: "head-prepend",
				},
			],
		},
	],
});
