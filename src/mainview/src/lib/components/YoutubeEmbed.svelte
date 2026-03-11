<script lang="ts">
import { onMount } from "svelte";
import { Play as PlayIcon } from "@lucide/svelte";

const { videoId } = $props<{ videoId: string }>();

let metadata: any = $state(null);
let loading = $state(true);
let error = $state(false);

// We use YouTube's oEmbed API to get the video title and channel name
onMount(async () => {
	try {
		const res = await fetch(
			`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
		);
		if (!res.ok) throw new Error("Failed to fetch youtube metadata");
		const json = await res.json();
		metadata = json;
	} catch (err) {
		error = true;
	} finally {
		loading = false;
	}
});

let expanded = $state(false);
</script>

{#if !loading && !error && metadata}
	<div
		class="mt-2 flex w-fit max-w-lg flex-col overflow-hidden rounded-lg border-l-4 border-stone-600 bg-zinc-900 text-sm transition-colors duration-150 hover:bg-zinc-800/90"
	>
		<div class="p-3">
			<div class="mb-4 flex items-center gap-1">
				<img src="/assets/yt-logo.png" class="w-7" alt="youtube logo" />
				<h4 class="text-xs text-zinc-400 font-semibold">YouTube</h4>
			</div>
			{#if metadata.author_name}
				<div class="font-bold text-zinc-100 text-xs mb-0.5">
					{metadata.author_name}
				</div>
			{/if}
			<a
				href={`https://www.youtube.com/watch?v=${videoId}`}
				target="_blank"
				rel="noopener noreferrer"
				class="mb-2 block font-semibold text-zinc-200 transition-colors hover:text-white hover:underline"
				onclick={(e) => e.stopPropagation()}
			>
				{metadata.title || "YouTube Video"}
			</a>

			{#if expanded}
				<iframe
					width="100%"
					height="280"
					src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
					title="YouTube video player"
					frameborder="0"
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
					allowfullscreen
					class="rounded-md shadow-md mt-2 w-full max-w-100"
				></iframe>
			{:else}
				<button
					type="button"
					class="group/yt-embed relative mt-2 w-full max-w-100 cursor-pointer overflow-hidden rounded-md"
					onclick={() => (expanded = true)}
					aria-label="Play embedded YouTube video"
				>
					<img
						src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
						alt="YouTube Thumbnail"
						class="h-auto w-full object-cover transition duration-200 group-hover/yt-embed:brightness-110"
						loading="lazy"
					/>
					<div class="pointer-events-none absolute inset-0 bg-black/15 transition-colors duration-200 group-hover/yt-embed:bg-black/5"></div>
					<div class="absolute inset-0 flex items-center justify-center">
						<div
							class="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition duration-200 group-hover/yt-embed:scale-105 group-hover/yt-embed:bg-black/70"
						>
							<PlayIcon class="size-5" />
						</div>
					</div>
				</button>
			{/if}
		</div>
	</div>
{:else if error}
	<div class="mt-2">
		<iframe
			width="400"
			height="225"
			src={`https://www.youtube.com/embed/${videoId}`}
			title="YouTube video player"
			frameborder="0"
			allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
			allowfullscreen
			class="rounded-md shadow-sm max-w-full"
		></iframe>
	</div>
{/if}
