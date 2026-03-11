import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (
						id.includes('/node_modules/svelte/') ||
						id.includes('\\node_modules\\svelte\\') ||
						id.includes('/node_modules/svelte-toolbelt/') ||
						id.includes('\\node_modules\\svelte-toolbelt\\') ||
						id.includes('/node_modules/runed/') ||
						id.includes('\\node_modules\\runed\\')
					) {
						return 'svelte-runtime';
					}
				},
			},
		},
	},
	server: {
		proxy: {
			'/tw-video': {
				target: 'https://video.twimg.com',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/tw-video/, ''),
				headers: {
					Referer: 'https://twitter.com/'
				}
			}
		}
	}
});
