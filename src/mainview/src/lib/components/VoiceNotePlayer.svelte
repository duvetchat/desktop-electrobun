<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { Play, Pause } from "@lucide/svelte";
	import {
		voiceNote,
		playVoiceNote,
		voiceNotePlayRequests,
		toggleVoiceNote,
		seekVoiceNote,
		getAttachmentRate,
		cyclePlaybackRate,
	} from "$lib/stores/voiceNotePlayer.svelte";
	import { formatDuration } from "$lib/utils/time";
	import {
		waveformCache,
		analyzeWaveform,
		fallbackBars,
		holdWav,
		keepWaveform,
		releaseWav,
		makeWav,
	} from "$lib/audio/waveform";

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
	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
		// Its WAV goes once nothing else holds it: another player of the note, or the voice note player (#167).
		releaseWav(wavSrc);
	});
	const BAR_COUNT = 50;

	const isActive = $derived($voiceNote?.attachmentId === attachmentId && attachmentId !== "");
	const playing = $derived(isActive ? $voiceNote!.playing : false);
	const currentTime = $derived(isActive ? $voiceNote!.currentTime : 0);
	const duration = $derived(isActive && $voiceNote!.duration > 0 ? $voiceNote!.duration : localDuration);
	const progress = $derived(duration > 0 ? currentTime / duration : 0);
	// Re-read rate from map on every voiceNote tick so external changes (e.g. VoiceNoteBar) are reflected
	const rate = $derived.by(() => {
		void $voiceNote;
		return getAttachmentRate(attachmentId);
	});

	function handleCycleRate() {
		cyclePlaybackRate(attachmentId);
	}

	const streamOf = (url: string) => (url.includes("?") ? `${url}&stream=1` : `${url}?stream=1`);
	// Whether this browser could decode it only once repaired, kept with its bars for an audio file's player of it.
	let repaired = false;

	// Its bars and its duration, kept for the next player of the note: no WAV, which holds every sample, until it plays
	// (#316).
	async function loadAndAnalyze(url: string) {
		try {
			const streamUrl = streamOf(url);
			const result = await analyzeWaveform(streamUrl, BAR_COUNT);
			if (destroyed) return;
			bars = result.bars;
			localDuration = result.duration;
			repaired = result.repaired;
			keepWaveform(attachmentId, { bars, duration: localDuration, repaired });
		} catch (e) {
			if (import.meta.env.DEV) console.error("[VoiceNotePlayer] loadAndAnalyze failed:", e);
		}
	}

	// The WAV it plays from, made as it first plays and held while the player's there: an Android voice note doesn't
	// play as it is in Firefox, and its failed player would stay the note's until another note plays. One made once the
	// player's gone is let go of at once: nothing else would (#167). Without one, it plays from its file.
	let wavMaking: Promise<string | null> | null = null;
	function wav(): Promise<string | null> {
		if (wavSrc) return Promise.resolve(wavSrc);
		wavMaking ??= makeWav(streamOf(src))
			.then((url) => {
				if (destroyed) {
					releaseWav(url);
					return null;
				}
				wavSrc = url;
				keepWaveform(attachmentId, { bars, duration: localDuration, repaired, wavUrl: url });
				return url;
			})
			.catch((e) => {
				if (import.meta.env.DEV) console.error("[VoiceNotePlayer] its WAV failed:", e);
				wavMaking = null;
				return null;
			});
		return wavMaking;
	}

	// Plays the note, from `at` seconds when it's given, once its WAV is there: if no other note was asked to play
	// meanwhile, and while this player is still there.
	async function play(at?: number) {
		const requests = voiceNotePlayRequests();
		const from = (await wav()) ?? src;
		if (destroyed || voiceNotePlayRequests() !== requests) return;
		playVoiceNote(from, attachmentId, authorName, channelName);
		if (at !== undefined) seekVoiceNote(at);
	}

	function togglePlay() {
		if (isActive) toggleVoiceNote();
		else void play();
	}

	function handleSeek(e: MouseEvent) {
		if (!duration) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		if (isActive) seekVoiceNote(ratio * duration);
		else void play(ratio * duration);
	}

	onMount(() => {
		const cached = waveformCache.get(attachmentId);
		if (cached) {
			bars = cached.bars;
			// None until a player of it plays it (#316): this one makes its own then.
			wavSrc = cached.wavUrl ?? null;
			holdWav(wavSrc);
			repaired = cached.repaired ?? false;
			localDuration = cached.duration;
			return;
		}
		bars = fallbackBars(src, BAR_COUNT);
		void loadAndAnalyze(src);
	});
</script>

<div
	class="flex items-center gap-2.5 {compact
		? 'max-w-none min-w-0 rounded-xl px-2.5 py-1.5'
		: 'max-w-[320px] min-w-60 rounded-[18px] py-2 pr-3.5 pl-2.5'} border-duvet-line bg-duvet-card/80 border"
>
	<button
		class="flex items-center justify-center {compact
			? 'size-7'
			: 'size-9'} text-duvet-on-accent bg-duvet-accent hover:bg-duvet-accent/85 shrink-0 cursor-pointer rounded-full border-none transition-[background] duration-150"
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
		<div class="relative flex items-center gap-[1.5px] {compact ? 'h-5' : 'h-7'} cursor-pointer" onclick={handleSeek}>
			{#each bars as height, i}
				{@const barProgress = i / bars.length}
				<div
					class="min-h-0.75 flex-1 rounded-xs transition-[background] duration-100"
					style="height: {height * 100}%; {barProgress <= progress
						? 'background: var(--duvet-accent);'
						: 'background: color-mix(in oklab, var(--duvet-ink) 20%, transparent);'}"
				></div>
			{/each}
			<div
				class="absolute top-1/2 {compact
					? 'size-2'
					: 'size-2.5'} bg-duvet-accent pointer-events-none -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_4px_var(--duvet-accent)]"
				style="left: {progress * 100}%;"
			></div>
		</div>
		<div class="flex items-center gap-1.5">
			<span class="text-duvet-ink2 tabular-nums {compact ? 'text-xxs' : 'text-[11px]'}"
				>{formatDuration(playing || currentTime > 0 ? currentTime : duration)}</span
			>
			{#if !compact}
				<button
					class="text-xxs text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink cursor-pointer rounded px-1 font-semibold tabular-nums transition-colors"
					onclick={handleCycleRate}>{rate}x</button
				>
			{/if}
		</div>
	</div>
</div>
