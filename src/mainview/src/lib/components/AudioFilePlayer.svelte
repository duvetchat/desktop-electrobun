<script lang="ts">
	import { onMount } from "svelte";
	import { Play, Pause, Music, Volume1, Volume2, VolumeX } from "@lucide/svelte";
	import { voiceNote, playVoiceNote, toggleVoiceNote, seekVoiceNote, audioVolume, getAttachmentRate, cyclePlaybackRate } from "$lib/stores/voiceNotePlayer.svelte";
	import { formatDuration } from "$lib/utils/time";
	import { formatFileSize } from "$lib/utils/format";
	import { waveformCache, MAX_WAVEFORM_CACHE, analyzeWaveform, fallbackBars } from "$lib/audio/waveform";

	let {
		src,
		attachmentId = "",
		filename = "",
		sizeBytes = 0,
		authorName = "",
		channelName = "",
	}: {
		src: string;
		attachmentId?: string;
		filename?: string;
		sizeBytes?: number;
		authorName?: string;
		channelName?: string;
	} = $props();

	let bars = $state<number[]>([]);
	let localDuration = $state(0);
	let showVolume = $state(false);
	// svelte-ignore state_referenced_locally
	let rate = $state(getAttachmentRate(attachmentId));
	let volumeTimeout: ReturnType<typeof setTimeout> | null = null;

	function handleCycleRate() {
		cyclePlaybackRate(attachmentId);
		rate = getAttachmentRate(attachmentId);
	}

	function showVolumeSlider() {
		if (volumeTimeout) clearTimeout(volumeTimeout);
		showVolume = true;
	}

	function hideVolumeSlider() {
		volumeTimeout = setTimeout(() => (showVolume = false), 250);
	}

	const BAR_COUNT = 80;

	const isActive = $derived($voiceNote?.attachmentId === attachmentId && attachmentId !== "");
	const playing = $derived(isActive ? $voiceNote!.playing : false);
	const currentTime = $derived(isActive ? $voiceNote!.currentTime : 0);
	const duration = $derived(isActive && $voiceNote!.duration > 0 ? $voiceNote!.duration : localDuration);
	const progress = $derived(duration > 0 ? currentTime / duration : 0);

	function togglePlay() {
		if (isActive) {
			toggleVoiceNote();
		} else {
			playVoiceNote(src, attachmentId, authorName, channelName, filename);
		}
	}

	function handleSeek(e: MouseEvent) {
		if (!duration) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		if (isActive) {
			seekVoiceNote(ratio * duration);
		} else {
			playVoiceNote(src, attachmentId, authorName, channelName, filename);
			seekVoiceNote(ratio * duration);
		}
	}

	async function loadAndAnalyze(url: string) {
		try {
			const streamUrl = url.includes("?") ? `${url}&stream=1` : `${url}?stream=1`;
			const result = await analyzeWaveform(streamUrl, BAR_COUNT);
			bars = result.bars;
			localDuration = result.duration;

			if (attachmentId) {
				if (waveformCache.size >= MAX_WAVEFORM_CACHE) {
					const firstKey = waveformCache.keys().next().value;
					if (firstKey) waveformCache.delete(firstKey);
				}
				waveformCache.set(attachmentId, { bars, wavUrl: url, duration: localDuration });
			}
		} catch (e) {
			if (import.meta.env.DEV) console.error("[AudioFilePlayer] waveform analysis failed:", e);
		}
	}

	onMount(() => {
		bars = fallbackBars(src, BAR_COUNT);

		const cached = waveformCache.get(attachmentId);
		if (cached) {
			bars = cached.bars;
			localDuration = cached.duration;
			return;
		}

		loadAndAnalyze(src);

		// Probe duration via metadata if waveform analysis is slow
		const audio = new Audio(src);
		audio.preload = "metadata";
		audio.addEventListener("loadedmetadata", () => {
			if (isFinite(audio.duration) && localDuration === 0) localDuration = audio.duration;
		});
	});
</script>

<div class="flex max-w-87.5 min-w-62.5 flex-col gap-1 rounded-lg border border-zinc-700/60 bg-zinc-800/70 px-3 py-2.5">
	<div class="flex items-center gap-2 min-w-0">
		<Music class="size-4 shrink-0 text-zinc-500" />
		<div class="flex min-w-0 flex-col">
			<a
				href={src}
				target="_blank"
				rel="noopener noreferrer"
				class="truncate text-sm font-medium text-blue-400 hover:underline"
				download={filename}
			>{filename}</a>
			<span class="text-xxs text-zinc-500">{formatFileSize(sizeBytes)}</span>
		</div>
	</div>

	<div class="flex items-center gap-2">
		<button
			class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-300 transition-colors hover:text-white"
			onclick={togglePlay}
		>
			{#if playing}
				<Pause class="size-4" fill="currentColor" stroke="none" />
			{:else}
				<Play class="size-4" fill="currentColor" stroke="none" />
			{/if}
		</button>

		<span class="text-xxs shrink-0 tabular-nums text-zinc-400">
			{formatDuration(playing || currentTime > 0 ? currentTime : 0)}/{formatDuration(duration)}
		</span>

		<button
			class="cursor-pointer rounded px-1 text-xxs font-semibold tabular-nums text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
			onclick={handleCycleRate}
		>{rate}x</button>

		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="relative flex h-6 min-w-0 flex-1 cursor-pointer items-end gap-px"
			onclick={handleSeek}
		>
			{#each bars as height, i}
				{@const barProgress = i / bars.length}
				<div
					class="min-h-0.5 flex-1 rounded-px transition-[background] duration-100"
					style="height: {height * 100}%; {barProgress <= progress
						? 'background: oklch(0.65 0.15 250);'
						: 'background: oklch(0.35 0.01 80);'}"
				></div>
			{/each}
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="relative shrink-0" onmouseenter={showVolumeSlider} onmouseleave={hideVolumeSlider}>
			<button
				class="flex size-6 cursor-pointer items-center justify-center text-zinc-500 transition-colors hover:text-zinc-300"
			>
				{#if $audioVolume === 0}
					<VolumeX class="size-3.5" />
				{:else if $audioVolume < 0.5}
					<Volume1 class="size-3.5" />
				{:else}
					<Volume2 class="size-3.5" />
				{/if}
			</button>

			{#if showVolume}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="absolute bottom-full left-1/2 z-50 mb-0 flex -translate-x-1/2 flex-col items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 p-2 pb-3 shadow-xl"
				>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={$audioVolume}
						oninput={(e) => audioVolume.set(parseFloat((e.currentTarget as HTMLInputElement).value))}
						class="volume-slider h-24 w-1.5"
						style="writing-mode: vertical-lr; direction: rtl;"
					/>
					<span class="text-xxs tabular-nums text-zinc-400">{Math.round($audioVolume * 100)}%</span>
				</div>
			{/if}
		</div>
	</div>
</div>
