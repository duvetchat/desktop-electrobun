<script lang="ts">
	import { onMount } from "svelte";
	import { LoaderCircle as CircleNotchIcon, Search as MagnifyingGlassIcon } from "@lucide/svelte";
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
	class="rounded-card border-duvet-line bg-duvet-card text-duvet-ink shadow-duvet-float flex h-96 w-88 flex-col overflow-hidden border"
>
	<div class="border-duvet-line border-b px-3 py-2">
		<p class="text-duvet-ink2 mb-2 text-[13px] font-bold">GIF Picker</p>
		<div class="relative">
			<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
				<MagnifyingGlassIcon class="text-duvet-ink2 size-4" />
			</div>
			<!-- KLIPY's attribution guidelines require "Search KLIPY" as the search box's placeholder. -->
			<input
				type="text"
				bind:value={query}
				oninput={handleInput}
				placeholder="Search KLIPY"
				maxlength={120}
				aria-label="Search GIFs"
				class="text-duvet-ink placeholder:text-duvet-ink2 bg-duvet-sunk shadow-duvet-press focus-visible:outline-duvet-accent block w-full rounded-xl py-2 pr-3 pl-9 text-sm focus-visible:outline-2"
			/>
		</div>
	</div>

	<div
		class="flex-1 overflow-y-auto p-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
	>
		{#if loading && gifs.length === 0}
			<div class="flex h-full items-center justify-center">
				<CircleNotchIcon class="text-duvet-ink2 h-6 w-6 animate-spin" />
			</div>
		{:else if error}
			<div class="text-duvet-danger mt-4 px-2 text-center text-sm" role="status" aria-live="polite">
				<p>{error}</p>
				<button
					type="button"
					class="border-duvet-line bg-duvet-card text-duvet-ink hover:bg-duvet-ink/10 mt-2 rounded-md border px-3 py-1.5 text-xs"
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
			<div class="text-duvet-ink2 mt-4 text-center text-sm">No GIFs found</div>
		{:else}
			<div class="columns-2 gap-2 space-y-2">
				{#each gifs as gif}
					<button
						type="button"
						class="group border-duvet-line bg-duvet-card relative w-full cursor-pointer break-inside-avoid overflow-hidden rounded-lg border text-left"
						onclick={() => onSelect(gif.url)}
						aria-label={`Send GIF ${gif.description || "result"}`}
					>
						<img
							src={gif.preview.url}
							width={gif.preview.width}
							height={gif.preview.height}
							alt={gif.description}
							class="h-auto w-full object-cover transition-opacity group-hover:opacity-85"
							loading="lazy"
						/>
					</button>
				{/each}
			</div>
			<p class="text-duvet-ink2 pt-2 pb-1 text-center text-xs">GIFs from KLIPY</p>
		{/if}
	</div>
</div>
