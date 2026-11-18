<script lang="ts">
	import { onMount } from "svelte";
	import { LoaderCircle as CircleNotchIcon } from "@lucide/svelte";
	import PickerSearch from "$lib/components/PickerSearch.svelte";
	import { GLASS, buttonClass } from "$lib/components/ui/recipes";
	import { gifsUrl, parseGifs, type Gif } from "$lib/gifs";

	const { onSelect } = $props<{ onSelect: (url: string) => void }>();

	let query = $state("");
	let gifs: Gif[] = $state([]);
	let loading = $state(false);
	let error = $state("");
	let currentRequestId = 0;

	// A request KLIPY hasn't answered by then fails, as the mobile app's does, so the picker offers to try again
	// instead of spinning.
	const TIMEOUT_MS = 10_000;

	// KLIPY's trending GIFs while the search box is blank, else its search's (gifsUrl). signal is the picker's own:
	// it aborts a request that a newer one replaced, or the closing picker's, and those show nothing.
	async function loadGifs(signal: AbortSignal) {
		loading = true;
		error = "";
		const requestId = ++currentRequestId;
		// The request's own controller, which the picker's signal or the timeout aborts, and timedOut tells which. Not
		// AbortSignal.any and AbortSignal.timeout: an older Mac's WebKit, which the app runs on there, lacks them (any
		// came with Safari 17.4, timeout with 16).
		const request = new AbortController();
		const stop = () => request.abort();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			request.abort();
		}, TIMEOUT_MS);
		if (signal.aborted) request.abort();
		else signal.addEventListener("abort", stop);
		try {
			const res = await fetch(gifsUrl(query), { signal: request.signal });
			if (!res.ok) throw new Error("Failed to fetch GIFs");
			const data = await res.json();
			if (requestId === currentRequestId) {
				gifs = parseGifs(data);
			}
		} catch {
			if (requestId === currentRequestId && !signal.aborted) {
				error = timedOut ? "Request timed out. Try again." : "Couldn't load GIFs. Check your connection and try again.";
			}
		} finally {
			clearTimeout(timer);
			signal.removeEventListener("abort", stop);
			if (requestId === currentRequestId) {
				loading = false;
			}
		}
	}

	let searchTimeout: any;
	let searchAbortController: AbortController | null = null;
	function handleInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			searchAbortController?.abort();
			searchAbortController = new AbortController();
			void loadGifs(searchAbortController.signal);
		}, 500);
	}

	onMount(() => {
		searchAbortController = new AbortController();
		void loadGifs(searchAbortController.signal);
		return () => {
			clearTimeout(searchTimeout);
			searchAbortController?.abort();
		};
	});
</script>

<div
	class="{GLASS} text-duvet-ink flex h-[440px] max-h-[calc(100vh-20px)] w-[372px] max-w-[calc(100vw-20px)] flex-col overflow-hidden rounded-[20px]"
	role="dialog"
	aria-label="GIF picker"
>
	<p class="text-duvet-ink shrink-0 px-4 pt-3.5 text-[13.5px] font-semibold">GIF Picker</p>
	<!-- KLIPY's attribution guidelines require "Search KLIPY" as the search box's placeholder. -->
	<PickerSearch
		bind:value={query}
		oninput={handleInput}
		placeholder="Search KLIPY"
		label="Search GIFs"
		maxlength={120}
	/>

	<div
		class="min-h-0 flex-1 overflow-y-auto px-2.5 pt-0.5 pb-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
	>
		{#if loading && gifs.length === 0}
			<div class="flex h-full items-center justify-center">
				<CircleNotchIcon class="text-duvet-ink2 size-6 animate-spin" />
			</div>
		{:else if error}
			<div class="text-duvet-danger mt-6 px-3 text-center text-[13px]" role="status" aria-live="polite">
				<p>{error}</p>
				<button
					type="button"
					class="{buttonClass('secondary', 'sm')} mt-3"
					onclick={() => {
						searchAbortController?.abort();
						searchAbortController = new AbortController();
						void loadGifs(searchAbortController.signal);
					}}
				>
					Try again
				</button>
			</div>
		{:else if gifs.length === 0}
			<div class="text-duvet-ink2 mt-6 text-center text-[13px]">No GIFs found</div>
		{:else}
			<div class="columns-2 gap-1.5 space-y-1.5">
				{#each gifs as gif}
					<button
						type="button"
						class="bg-duvet-secondary-fill hover:outline-duvet-accent focus-visible:outline-duvet-accent relative block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-xl text-left outline-2 -outline-offset-2 outline-transparent transition-[outline-color] duration-[120ms] motion-reduce:transition-none"
						onclick={() => onSelect(gif.url)}
						aria-label={`Send GIF ${gif.description || "result"}`}
					>
						<img
							src={gif.preview.url}
							width={gif.preview.width}
							height={gif.preview.height}
							alt={gif.description}
							class="h-auto w-full object-cover"
							loading="lazy"
						/>
					</button>
				{/each}
			</div>
			<p class="text-duvet-ink2 pt-2.5 pb-0.5 text-center text-xs">GIFs from KLIPY</p>
		{/if}
	</div>
</div>
