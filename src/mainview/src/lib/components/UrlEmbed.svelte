<script lang="ts">
import { onMount } from "svelte";

const { url } = $props<{ url: string }>();

let metadata: any = $state(null);
let loading = $state(true);
let errorMessage = $state("");

function getErrorMessage(err: unknown) {
	if (err instanceof DOMException && err.name === "AbortError") {
		return "Preview timed out";
	}
	return "Preview unavailable";
}

onMount(() => {
	const controller = new AbortController();
	const timeoutId = window.setTimeout(() => controller.abort(), 8000);
	(async () => {
		try {
			const res = await fetch(
				`https://api.microlink.io/?url=${encodeURIComponent(url)}`,
				{ signal: controller.signal },
			);
			if (!res.ok) {
				throw new Error("Failed to fetch metadata");
			}
			const json = await res.json();
			if (json.status === "success" && json.data) {
				metadata = json.data;
			} else {
				errorMessage = "Preview unavailable";
			}
		} catch (err) {
			errorMessage = getErrorMessage(err);
		} finally {
			window.clearTimeout(timeoutId);
			loading = false;
		}
	})();

	return () => {
		window.clearTimeout(timeoutId);
		controller.abort();
	};
});
</script>

{#if !loading && !errorMessage && metadata && (metadata.title || metadata.description || metadata.image)}
	<div
		class="flex max-w-xl flex-col rounded-md border-b-4 border-stone-600 bg-zinc-900 p-4 transition-colors duration-150 hover:bg-zinc-800/90"
	>
		<div class="flex flex-row justify-between">
			<div class="flex-1 right-4 pr-4">
				{#if metadata.publisher}
					<div class="mb-1 text-xs font-semibold text-zinc-400">
						{metadata.publisher}
					</div>
				{/if}

				{#if metadata.title}
					<a
						href={metadata.url || url}
						target="_blank"
						rel="noopener noreferrer"
						class="mb-1 block text-sm font-semibold text-zinc-200 transition-colors hover:text-white hover:underline md:text-base wrap-break-word"
						onclick={(e) => {
							e.stopPropagation();
						}}
					>
						{metadata.title}
					</a>
				{/if}

				{#if metadata.description}
					<div
						class="mt-2 text-sm text-zinc-300 line-clamp-4 wrap-break-word"
					>
						{metadata.description}
					</div>
				{/if}
			</div>

			{#if metadata.image?.url}
				<div class="shrink-0">
					<img
						src={metadata.image.url}
						alt="Thumbnail"
						class="max-w-20 max-h-20 md:max-w-28 md:max-h-28 rounded-md object-contain"
						loading="lazy"
					/>
				</div>
			{/if}
		</div>
	</div>
{:else if !loading}
	<div class="mt-2 max-w-xl rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-300">
		<p>{errorMessage || "Preview unavailable"}. <a href={url} target="_blank" rel="noopener noreferrer" class="text-stone-300 hover:underline">Open link</a>.</p>
	</div>
{/if}
