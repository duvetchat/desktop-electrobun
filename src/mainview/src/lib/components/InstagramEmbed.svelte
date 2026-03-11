<script lang="ts">
import { onMount } from "svelte";
import { ExternalLink as ArrowSquareOutIcon } from "@lucide/svelte";

const { url } = $props<{ url: string }>();

let videoUrl: string | null = $state(null);
let posterUrl: string | null = $state(null);
let imageUrl: string | null = $state(null);
let loading = $state(true);
let error = $state(false);

onMount(async () => {
	try {
		let vxUrl = url;
		if (url.includes("kkinstagram.com")) {
			vxUrl = url.replace("kkinstagram.com", "vxinstagram.com");
		} else if (url.includes("instagram.com")) {
			vxUrl = url.replace("instagram.com", "vxinstagram.com");
		}

		let html: string | null = null;

		const proxies = [
			`https://corsproxy.io/?${encodeURIComponent(vxUrl)}`,
			`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(vxUrl)}`,
			`https://api.allorigins.win/raw?url=${encodeURIComponent(vxUrl)}`,
		];

		for (const proxyUrl of proxies) {
			try {
				const res = await fetch(proxyUrl);
				if (res.ok) {
					html = await res.text();
					break;
				}
			} catch (err) {
				continue;
			}
		}

		if (!html) {
			throw new Error("Failed to fetch embed");
		}

		const parser = new DOMParser();
		const doc = parser.parseFromString(html, "text/html");

		const ogVideo =
			doc.querySelector('meta[property="og:video"]') ||
			doc.querySelector('meta[property="og:video:secure_url"]');
		const ogImage = doc.querySelector('meta[property="og:image"]');

		if (ogVideo) {
			videoUrl = ogVideo.getAttribute("content");
			posterUrl = ogImage ? ogImage.getAttribute("content") : null;
		} else if (ogImage) {
			imageUrl = ogImage.getAttribute("content");
		} else {
			error = true;
		}
	} catch (err) {
		error = true;
	} finally {
		loading = false;
	}
});
</script>

{#if loading}
	<div
		class="mt-2 flex max-w-fit items-center justify-center rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3"
	>
		<svg
			class="mr-2 h-4 w-4 animate-spin text-zinc-400"
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
		>
			<circle
				class="opacity-25"
				cx="12"
				cy="12"
				r="10"
				stroke="currentColor"
				stroke-width="4"
			></circle>
			<path
				class="opacity-75"
				fill="currentColor"
				d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
			></path>
		</svg>
		<span class="text-sm text-zinc-400">Loading Instagram...</span>
	</div>
{:else if videoUrl}
	<div
		class="mt-2 flex max-w-fit flex-col gap-2 overflow-hidden rounded-xl border border-zinc-700 bg-black"
	>
		<video
			src={videoUrl}
			controls
			class="max-h-100 min-h-50 min-w-50 w-full object-contain cursor-pointer relative z-50 pointer-events-auto bg-black rounded-md"
			poster={posterUrl || ""}
			preload="metadata"
			playsinline
			onclick={(e) => {
				e.stopPropagation();
			}}
		>
			<track kind="captions" />
		</video>
	</div>
{:else if imageUrl}
	<div
		class="mt-2 flex max-w-fit flex-col gap-2 overflow-hidden rounded-xl border border-zinc-700 bg-black"
	>
		<img
			src={imageUrl}
			alt="Instagram"
			class="max-h-100 max-w-100 w-auto h-auto object-contain rounded-md"
			loading="lazy"
		/>
	</div>
{:else if error}
	<div
		class="mt-2 flex max-w-sm items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 transition-colors duration-150 hover:bg-zinc-800/90"
	>
		<ArrowSquareOutIcon class="size-4 shrink-0 text-zinc-500" />
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			class="text-sm text-blue-400 hover:underline truncate"
			onclick={(e) => {
				e.stopPropagation();
			}}
		>
			View on Instagram
		</a>
	</div>
{/if}
