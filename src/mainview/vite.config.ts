import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import { version } from "../../package.json";
import { slimEmojiData } from "./emoji-data-slim";
import { rnnoiseWasm } from "./rnnoise-wasm";
import { DEV_CONNECT_ENV } from "./svelte.config.js";
import { thirdPartyNotices } from "./third-party-notices";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	// URL overrides only apply in development mode (dev:hmr, start); every other mode, including build:canary, ignores them.
	const devURL = (url = "") => (mode === "development" ? url.replace(/\/+$/, "") : "");
	const apiURL = devURL(env.VITE_API_URL);
	const wsURL = devURL(env.VITE_WS_URL);
	// The CSP in svelte.config.js lets the app reach them: SvelteKit loads that file when sveltekit() runs,
	// below. Always set, so a value from the shell never reaches another mode's build.
	process.env[DEV_CONNECT_ENV] = [apiURL, wsURL].filter(Boolean).join(" ");
	// The Licenses page's notices (#628), from what the page and its workers ship: licenses.json beside the pages.
	const notices = thirdPartyNotices();
	return {
		plugins: [rnnoiseWasm(), slimEmojiData(), tailwindcss(), sveltekit(), notices.plugin],
		// The desktop app (src/bun/index.ts) and app.html look for the dev server on 5173: if it's taken,
		// fail instead of moving to another port, where neither would find it. SvelteKit's Vite plugin
		// narrows server.fs.allow to src/ and node_modules/, so messages/ is added alongside them (#464).
		server: { port: 5173, strictPort: true, fs: { allow: ["messages"] } },
		// The E2E core's worker (lib/e2e/web/worker.ts) is a module worker, which imports its WebAssembly's glue and
		// hands the glue the .wasm's URL (a ?url import, an asset in a build): Vite's default, a classic script, takes
		// neither. Its bundle gets no plugin but the notices' step, which tells the page's what it ships.
		worker: { format: "es", plugins: () => [notices.worker()] },
		define: {
			VITE_APP_ENV: JSON.stringify(mode),
			VITE_DOMAIN_TARGET_ENV: JSON.stringify(env.VITE_DOMAIN_TARGET_ENV || "duvet"),
			VITE_API_URL: JSON.stringify(apiURL),
			VITE_WS_URL: JSON.stringify(wsURL),
			// What the app tells the API and the gateway it is (lib/e2e/client.ts): the desktop's version, in every mode.
			VITE_APP_VERSION: JSON.stringify(version),
		},
		build: {
			rollupOptions: {
				output: {
					manualChunks(id) {
						if (
							id.includes("/node_modules/svelte/") ||
							id.includes("\\node_modules\\svelte\\") ||
							id.includes("/node_modules/svelte-toolbelt/") ||
							id.includes("\\node_modules\\svelte-toolbelt\\") ||
							id.includes("/node_modules/runed/") ||
							id.includes("\\node_modules\\runed\\")
						) {
							return "svelte-runtime";
						}
					},
				},
			},
		},
	};
});
