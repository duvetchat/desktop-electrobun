<script lang="ts">
	import { onMount } from "svelte";
	import { Play, Pause } from "@lucide/svelte";
	import { voiceNote, playVoiceNote, toggleVoiceNote, seekVoiceNote, getAttachmentRate, cyclePlaybackRate } from "$lib/stores/voiceNotePlayer.svelte";
	import { formatDuration } from "$lib/utils/time";
	import { waveformCache, MAX_WAVEFORM_CACHE, analyzeWaveform, fallbackBars } from "$lib/audio/waveform";

	let {
		src,
		attachmentId = "",
		authorName = "",
		channelName = "",
		compact = false,
	}: {
		src: string;
		attachmentId?: string;
		authorName?: string;
		channelName?: string;
		compact?: boolean;
	} = $props();

	let bars = $state<number[]>([]);
	let localDuration = $state(0);
	let wavSrc = $state<string | null>(null);
	// svelte-ignore state_referenced_locally
	let rate = $state(getAttachmentRate(attachmentId));

	const BAR_COUNT = 50;

	const isActive = $derived($voiceNote?.attachmentId === attachmentId && attachmentId !== "");
	const playing = $derived(isActive ? $voiceNote!.playing : false);
	const currentTime = $derived(isActive ? $voiceNote!.currentTime : 0);
	const duration = $derived(isActive && $voiceNote!.duration > 0 ? $voiceNote!.duration : localDuration);
	const progress = $derived(duration > 0 ? currentTime / duration : 0);

	function handleCycleRate() {
		cyclePlaybackRate(attachmentId);
		rate = getAttachmentRate(attachmentId);
	}

	async function loadAndAnalyze(url: string) {
		try {
			const streamUrl = url.includes("?") ? `${url}&stream=1` : `${url}?stream=1`;
			const result = await analyzeWaveform(streamUrl, BAR_COUNT);
			bars = result.bars;
			localDuration = result.duration;
			wavSrc = URL.createObjectURL(new Blob([result.wavBuf], { type: "audio/wav" }));

			if (attachmentId) {
				if (waveformCache.size >= MAX_WAVEFORM_CACHE) {
					const firstKey = waveformCache.keys().next().value;
					if (firstKey) waveformCache.delete(firstKey);
				}
				waveformCache.set(attachmentId, { bars, wavUrl: wavSrc!, duration: localDuration });
			}
		} catch (e) {
			if (import.meta.env.DEV) console.error("[VoiceNotePlayer] loadAndAnalyze failed:", e);
			if (!wavSrc) wavSrc = url;
		}
	}

	function togglePlay() {
		if (isActive) {
			toggleVoiceNote();
		} else {
			playVoiceNote(wavSrc || src, attachmentId, authorName, channelName);
		}
	}

	function handleSeek(e: MouseEvent) {
		if (!duration) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		if (isActive) {
			seekVoiceNote(ratio * duration);
		} else {
			playVoiceNote(wavSrc || src, attachmentId, authorName, channelName);
			seekVoiceNote(ratio * duration);
		}
	}

	onMount(() => {
		const cached = waveformCache.get(attachmentId);
		if (cached) {
			bars = cached.bars;
			wavSrc = cached.wavUrl;
			localDuration = cached.duration;
			return;
		}
		bars = fallbackBars(src, BAR_COUNT);
		loadAndAnalyze(src);
	});
</script>

<div
	class="flex items-center gap-2.5 {compact
		? 'max-w-none min-w-0 rounded-xl px-2.5 py-1.5'
		: 'max-w-[320px] min-w-60 rounded-[18px] py-2 pr-3.5 pl-2.5'} border border-[oklch(0.30_0.01_80/0.6)] bg-[oklch(0.22_0.01_80/0.8)]"
>
	<button
		class="flex items-center justify-center {compact
			? 'size-7'
			: 'size-9'} shrink-0 cursor-pointer rounded-full border-none bg-[oklch(0.55_0.15_250)] text-white transition-[background] duration-150 hover:bg-[oklch(0.62_0.15_250)]"
		onclick={togglePlay}
	>
		{#if playing}
			<Pause class={compact ? "size-3.5" : "size-5"} fill="currentColor" stroke="none" />
		{:else}
			<Play class={compact ? "size-3.5" : "size-5"} fill="currentColor" stroke="none" />
		{/if}
	</button>

	<div class="flex min-w-0 flex-1 flex-col gap-1">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="relative flex items-center gap-[1.5px] {compact ? 'h-5' : 'h-7'} cursor-pointer"
			onclick={handleSeek}
		>
			{#each bars as height, i}
				{@const barProgress = i / bars.length}
				<div
					class="min-h-0.75 flex-1 rounded-xs transition-[background] duration-100"
					style="height: {height * 100}%; {barProgress <= progress
						? 'background: oklch(0.65 0.15 250);'
						: 'background: oklch(0.40 0.01 80);'}"
				></div>
			{/each}
			<div
				class="absolute top-1/2 {compact
					? 'size-2'
					: 'size-2.5'} pointer-events-none -translate-x-1/2 -translate-y-1/2 rounded-full bg-[oklch(0.65_0.15_250)] shadow-[0_0_4px_oklch(0.5_0.15_250/0.5)]"
				style="left: {progress * 100}%;"
			></div>
		</div>
		<div class="flex items-center gap-1.5">
			<span class="text-[oklch(0.52_0.01_80)] tabular-nums {compact ? 'text-xxs' : 'text-[11px]'}"
				>{formatDuration(playing || currentTime > 0 ? currentTime : duration)}</span
			>
			{#if !compact}
				<button
					class="cursor-pointer rounded px-1 text-xxs font-semibold tabular-nums text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
					onclick={handleCycleRate}
				>{rate}x</button>
			{/if}
		</div>
	</div>
</div>
