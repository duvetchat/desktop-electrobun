import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
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
