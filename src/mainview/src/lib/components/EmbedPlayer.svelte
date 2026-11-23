<script module lang="ts">
	import { writable } from "svelte/store";

	// The player playing, across the app: one at a time, as each is a cross-site page with its scripts and media, likely a
	// renderer process of its own. Starting one sends the one before back to its poster (#329).
	const nowPlaying = writable<symbol | null>(null);
</script>

<script lang="ts">
	import { Play as PlayIcon } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";
	import { loadRelayOrigin, relayOrigin } from "$lib/player-relay";
	import { playerFrame } from "$lib/urls";

	// The player page at url, framed with playerFrame's sandbox once its poster is clicked, so that the page loads, and
	// its host sees a view, only when someone plays it (desktop#147); played is the page played so far, framed at once.
	// A player the API frames itself starts at its click. In the packaged app any other page opens in the browser
	// instead, as Electrobun's preload (with its RPC key) runs in frames too: its poster is then a link, which
	// lib/external-links.ts hands to the browser. In the app a YouTube player is framed through the relay on loopback
	// (relay, from lib/player-relay.ts), which gives it the Referer that views:// lacks.
	let {
		url,
		title,
		aspect,
		allow,
		poster,
		ownHosts,
		packaged = isElectrobunWindow(),
		relay,
		played,
	}: {
		url: string;
		title: string;
		aspect: string;
		allow: string;
		poster: string | undefined;
		ownHosts: string[];
		packaged?: boolean;
		relay?: string | null;
		played?: string;
	} = $props();

	const me = Symbol("embed player");
	function play() {
		played = url;
		nowPlaying.set(me);
	}
	// Another player started: this one goes back to its poster.
	$effect(() => {
		if ($nowPlaying !== null && $nowPlaying !== me) played = undefined;
	});

	onMount(() => {
		if (packaged) loadRelayOrigin();
	});
	const frame = $derived(playerFrame(url, ownHosts, packaged ? (relay ?? $relayOrigin) : null));
	const label = $derived(title ? `Play ${title}` : "Play");
	const coverClass = "group absolute inset-0 flex items-center justify-center overflow-hidden bg-duvet-stage";
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
			<button type="button" class={coverClass} aria-label={label} onclick={play}>
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
		class="bg-duvet-media-scrim text-duvet-media-ink inset-ring-fixed-white/12 relative grid size-[52px] place-items-center rounded-full inset-ring-1 backdrop-blur-[12px] transition-transform duration-200 group-hover:scale-[1.06] motion-reduce:transition-none"
	>
		<PlayIcon class="translate-x-0.5" size={22} fill="currentColor" stroke="none" />
	</span>
{/snippet}
