<script lang="ts">
	import { Play as PlayIcon } from "@lucide/svelte";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";
	import { playerFrame } from "$lib/urls";

	// The player page at url, framed with playerFrame's sandbox once its poster is clicked, so that the page loads, and
	// its host sees a view, only when someone plays it (desktop#147); played is the page played so far, framed at once.
	// A player the API frames itself starts at its click. In the packaged app any other page opens in the browser
	// instead, as Electrobun's preload (with its RPC key) runs in frames too: its poster is then a link, which
	// lib/external-links.ts hands to the browser.
	let {
		url,
		title,
		aspect,
		allow,
		poster,
		ownHosts,
		packaged = isElectrobunWindow(),
		played,
	}: {
		url: string;
		title: string;
		aspect: string;
		allow: string;
		poster: string | undefined;
		ownHosts: string[];
		packaged?: boolean;
		played?: string;
	} = $props();

	const frame = $derived(playerFrame(url, ownHosts));
	const label = $derived(title ? `Play ${title}` : "Play");
	const coverClass = "group absolute inset-0 flex items-center justify-center bg-zinc-900";
</script>

{#if frame}
	<div class="relative w-full {aspect}">
		{#if played === url}
			<iframe src={frame.src} {title} class="h-full w-full" {allow} allowfullscreen sandbox={frame.sandbox}></iframe>
		{:else if packaged && !frame.player}
			<a href={url} target="_blank" rel="noopener noreferrer" class={coverClass} aria-label={label}>
				{@render cover()}
			</a>
		{:else}
			<button type="button" class={coverClass} aria-label={label} onclick={() => (played = url)}>
				{@render cover()}
			</button>
		{/if}
	</div>
{/if}

{#snippet cover()}
	{#if poster}
		<img src={poster} alt="" class="absolute inset-0 size-full object-cover" loading="lazy" />
	{/if}
	<span
		class="text-fixed-white relative flex size-14 items-center justify-center rounded-full bg-black/60 transition-colors group-hover:bg-black/80"
	>
		<PlayIcon class="size-6 translate-x-0.5" fill="currentColor" stroke="none" />
	</span>
{/snippet}
