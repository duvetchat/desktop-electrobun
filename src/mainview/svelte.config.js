// import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: true,
	},
	vitePlugin: {
		dynamicCompileOptions({ filename, compileOptions }) {
			const isLucide =
				filename.includes("node_modules/lucide-svelte") ||
				filename.includes("node_modules\\lucide-svelte");
			if (isLucide) {
				return {
					...compileOptions,
					runes: false,
				};
			}
		},
	},
	// preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			precompress: true
		})
	}
};

export default config;
