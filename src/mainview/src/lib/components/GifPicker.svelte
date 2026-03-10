<script lang="ts">
import { onMount } from "svelte";
import {
	LoaderCircle as CircleNotchIcon,
	Search as MagnifyingGlassIcon,
} from "lucide-svelte";

const { onSelect } = $props<{ onSelect: (url: string) => void }>();

let query = $state("");
let gifs: any[] = $state([]);
let loading = $state(false);
let error = $state("");
let currentRequestId = 0;

const TENOR_KEY = "LIVDSRZULELA";
const LIMIT = 20;

function friendlyError(err: unknown) {
	if (err instanceof DOMException && err.name === "AbortError") {
		return "Request timed out. Try again.";
	}
	return "Couldn't load GIFs. Check your connection and try again.";
}

async function fetchTrending(signal?: AbortSignal) {
	loading = true;
	error = "";
	const requestId = ++currentRequestId;
	try {
		const res = await fetch(
			`https://g.tenor.com/v1/trending?key=${TENOR_KEY}&limit=${LIMIT}`,
			{ signal },
		);
		if (!res.ok) throw new Error("Failed to fetch GIFs");
		const data = await res.json();
		if (requestId === currentRequestId) {
			gifs = data.results;
		}
	} catch (err) {
		if (requestId === currentRequestId) {
			error = friendlyError(err);
		}
	} finally {
		if (requestId === currentRequestId) {
			loading = false;
		}
	}
}

async function searchGifs(signal?: AbortSignal) {
	if (!query.trim()) {
		return fetchTrending(signal);
	}

	loading = true;
	error = "";
	const requestId = ++currentRequestId;
	try {
		const res = await fetch(
			`https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${TENOR_KEY}&limit=${LIMIT}`,
			{ signal },
		);
		if (!res.ok) throw new Error("Failed to fetch GIFs");
		const data = await res.json();
		if (requestId === currentRequestId) {
			gifs = data.results;
		}
	} catch (err) {
		if (requestId === currentRequestId) {
			error = friendlyError(err);
		}
	} finally {
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
		void searchGifs(searchAbortController.signal);
	}, 500);
}

onMount(() => {
	searchAbortController = new AbortController();
	void fetchTrending(searchAbortController.signal);
	return () => {
		clearTimeout(searchTimeout);
		searchAbortController?.abort();
	};
});

function selectGif(gif: any) {
	const url = gif.media.at(0)?.gif.url ?? "";
	onSelect(url);
}
</script>

<div
	class="flex flex-col h-96 w-88 bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700 overflow-hidden text-zinc-100"
>
	<div class="px-3 py-2 border-b border-zinc-700 bg-zinc-900">
		<p class="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-2">GIF Picker</p>
		<div class="relative">
			<div
				class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
			>
				<MagnifyingGlassIcon class="size-4 text-zinc-500" />
			</div>
			<input
				type="text"
				bind:value={query}
				oninput={handleInput}
				placeholder="Search Tenor..."
				maxlength={120}
				aria-label="Search GIFs"
				class="block w-full pl-9 pr-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-stone-500 focus:border-stone-500"
			/>
		</div>
	</div>

	<div
		class="flex-1 overflow-y-auto p-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden bg-zinc-900"
	>
		{#if loading && gifs.length === 0}
			<div class="flex justify-center items-center h-full">
				<CircleNotchIcon class="h-6 w-6 text-stone-400 animate-spin" />
			</div>
		{:else if error}
			<div class="mt-4 px-2 text-center text-sm text-red-400" role="status" aria-live="polite">
				<p>{error}</p>
				<button
					type="button"
					class="mt-2 rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
					onclick={() => {
						searchAbortController?.abort();
						searchAbortController = new AbortController();
						void (query.trim()
							? searchGifs(searchAbortController.signal)
							: fetchTrending(searchAbortController.signal));
					}}
				>
					Try again
				</button>
			</div>
		{:else if gifs.length === 0}
			<div class="text-center text-zinc-400 text-sm mt-4">
				No GIFs found
			</div>
		{:else}
			<div class="columns-2 gap-2 space-y-2">
				{#each gifs as gif}
					<button
						type="button"
						class="break-inside-avoid relative group cursor-pointer rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700 w-full text-left"
						onclick={() => selectGif(gif)}
						aria-label={`Send GIF ${gif.content_description || "result"}`}
					>
						<img
							src={gif.media.at(0)?.tinygif.url}
							alt={gif.content_description}
							class="w-full h-auto object-cover group-hover:opacity-85 transition-opacity"
							loading="lazy"
						/>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
