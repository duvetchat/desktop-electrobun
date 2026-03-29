import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	return {
		plugins: [tailwindcss(), sveltekit()],
		define: {
			VITE_APP_ENV: JSON.stringify(mode),
			VITE_DOMAIN_TARGET_ENV: JSON.stringify(env.VITE_DOMAIN_TARGET_ENV || "andremor"),
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
