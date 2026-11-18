<script lang="ts">
	import type { UserActivity } from "$lib/stores.svelte";
	import { inlineActivityImage, resolveActivityIcon } from "$lib/activity-icons";
	import { formatPlaybackTime, isSpotify, shownActivities, spotifySearchUrl } from "$lib/activity";
	import ElapsedTime from "./ElapsedTime.svelte";

	// A member's activities in their profile card and popover: Spotify's as the song with its progress, any other
	// with its icons and how long it has been going.
	let { activities }: { activities: UserActivity[] | undefined } = $props();

	let now = $state(Date.now());
	const shown = $derived(shownActivities(activities, now));
	const playing = $derived(shown.some(isSpotify));
	$effect(() => {
		if (!playing) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});
</script>

{#if shown.length}
	<div class="bg-duvet-card my-3 h-px w-full"></div>
	<h3 class="text-duvet-ink2 mb-1.5 text-left text-[13px] font-bold">
		{shown.length === 1 ? "Activity" : "Activities"}
	</h3>
	<div class="flex flex-col gap-2">
		{#each shown as activity}
			{#if isSpotify(activity)}
				{@const start = activity.timestamps?.start ?? now}
				{@const length = Math.max((activity.timestamps?.end ?? start) - start, 0)}
				{@const elapsed = Math.min(Math.max(now - start, 0), length)}
				<div class="flex flex-col gap-1.5">
					<span class="text-duvet-ink2 text-left text-xs font-semibold">Listening to Spotify</span>
					<div class="flex items-center gap-2">
						<div class="bg-duvet-card flex size-10 shrink-0 items-center justify-center rounded" title="Spotify">
							<svg viewBox="0 0 24 24" class="size-6 fill-[#1ED760]" aria-hidden="true">
								<path
									d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"
								/>
							</svg>
						</div>
						<div class="flex min-w-0 flex-col text-left">
							<a
								href={spotifySearchUrl(activity)}
								target="_blank"
								rel="noopener noreferrer"
								title="Find it on Spotify"
								class="text-duvet-ink truncate text-sm font-medium hover:underline">{activity.details}</a
							>
							{#if activity.state}
								<span class="text-duvet-ink2 truncate text-xs">by {activity.state}</span>
							{/if}
							{#if activity.assets?.large_text}
								<span class="text-duvet-ink2 truncate text-xs">on {activity.assets.large_text}</span>
							{/if}
						</div>
					</div>
					{#if length > 0}
						<div class="text-duvet-ink2 flex items-center gap-2 text-[10px] tabular-nums">
							<span>{formatPlaybackTime(elapsed)}</span>
							<div class="bg-duvet-ink/10 h-1 flex-1 overflow-hidden rounded-full">
								<div class="bg-duvet-ink h-full rounded-full" style="width: {(elapsed / length) * 100}%"></div>
							</div>
							<span>{formatPlaybackTime(length)}</span>
						</div>
					{/if}
				</div>
			{:else}
				{@const small = inlineActivityImage(activity.assets?.small_image)}
				<!-- Only inline images: one by URL would have its host learn the viewer's IP (lib/activity-icons.ts) -->
				<div class="flex items-center gap-2">
					<div class="relative shrink-0">
						<img
							src={resolveActivityIcon(activity.assets?.large_image)}
							alt=""
							title={activity.assets?.large_text ?? ""}
							class="h-10 w-10 rounded"
						/>
						{#if small}
							<img
								src={small}
								alt=""
								title={activity.assets?.small_text ?? ""}
								class="border-duvet-line bg-duvet-card absolute -right-1 -bottom-1 h-5 w-5 rounded border p-0.5"
							/>
						{/if}
					</div>
					<div class="flex min-w-0 flex-col">
						<span class="text-duvet-ink truncate text-sm font-medium">{activity.name}</span>
						{#if activity.details}
							<span class="text-duvet-ink2 truncate text-xs">{activity.details}</span>
						{/if}
						{#if activity.state}
							<span class="text-duvet-ink2 truncate text-xs">{activity.state}</span>
						{/if}
						{#if activity.timestamps?.start}
							<ElapsedTime start={activity.timestamps.start} />
						{/if}
					</div>
				</div>
			{/if}
		{/each}
	</div>
{/if}
