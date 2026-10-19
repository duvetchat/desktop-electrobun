import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	// URL overrides only apply in development mode (dev:hmr, start); every other mode, including build:canary, ignores them.
	const devURL = (url = "") => (mode === "development" ? url.replace(/\/+$/, "") : "");
	return {
		plugins: [tailwindcss(), sveltekit()],
		// The desktop app (src/bun/index.ts) and app.html look for the dev server on 5173: if it's taken,
		// fail instead of moving to another port, where neither would find it.
		server: { port: 5173, strictPort: true },
		define: {
			VITE_APP_ENV: JSON.stringify(mode),
			VITE_DOMAIN_TARGET_ENV: JSON.stringify(env.VITE_DOMAIN_TARGET_ENV || "duvet"),
			VITE_API_URL: JSON.stringify(devURL(env.VITE_API_URL)),
			VITE_WS_URL: JSON.stringify(devURL(env.VITE_WS_URL)),
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
