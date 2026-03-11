// import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: true,
	},
	// preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			precompress: true
		})
	}
};

export default config;
