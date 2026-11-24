<script lang="ts">
	import { seekTo } from "$lib/seek-keys";
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
	import { t } from "$lib/i18n";
	import { formatNumber } from "$lib/i18n/format";
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
		/** The author's name, "" for an author the app doesn't know: the bar draws it (VoiceNoteBar). */
		authorName?: string;
		/** The room's name, "" where there's none, null for a room the app doesn't know (MessageAttachments). */
		channelName?: string | null;
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

	function handleSeekKey(e: KeyboardEvent) {
		const to = seekTo(e.key, currentTime, duration);
		if (to === null) return;
		e.preventDefault();
		if (isActive) seekVoiceNote(to);
		else void play(to);
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
	class="bg-duvet-card shadow-duvet-raised flex items-center {compact
		? 'max-w-none min-w-0 gap-2 rounded-xl px-2 py-1.5'
		: 'w-[300px] max-w-full gap-2.5 rounded-[18px] py-[7px] pr-2.5 pl-[7px]'}"
>
	<button
		type="button"
		aria-label={playing ? t("media_pause") : t("media_play")}
		class="bg-duvet-accent text-duvet-on-accent shadow-duvet-control grid shrink-0 cursor-pointer place-items-center rounded-full transition-[filter] hover:brightness-[1.06] motion-reduce:transition-none {compact
			? 'size-7'
			: 'size-[34px]'}"
		onclick={togglePlay}
	>
		{#if playing}
			<Pause size={compact ? 13 : 16} fill="currentColor" stroke="none" />
		{:else}
			<Play size={compact ? 13 : 16} fill="currentColor" stroke="none" />
		{/if}
	</button>

	<!-- The line seeks: by a press on it, and from the keyboard by the arrows, Home and End (lib/seek-keys.ts). -->
	<div
		class="text-duvet-accent-text flex min-w-0 flex-1 cursor-pointer items-center gap-[2px] rounded-md {compact
			? 'h-5'
			: 'h-6'}"
		role="slider"
		tabindex="0"
		aria-label={t("media_seek")}
		aria-valuemin={0}
		aria-valuemax={Math.round(duration)}
		aria-valuenow={Math.round(currentTime)}
		aria-valuetext={t("media_seek_position", {
			position: formatDuration(currentTime),
			duration: formatDuration(duration),
		})}
		onclick={handleSeek}
		onkeydown={handleSeekKey}
	>
		{#each bars as height, i}
			<div
				class="min-h-1 flex-1 rounded-full bg-current transition-opacity duration-100 motion-reduce:transition-none {i /
					bars.length <=
					progress &&
				(playing || currentTime > 0)
					? 'opacity-100'
					: 'opacity-30'}"
				style="height: {height * 100}%;"
			></div>
		{/each}
	</div>
	<span class="text-duvet-ink2 shrink-0 text-[11.5px] font-medium tabular-nums"
		>{formatDuration(playing || currentTime > 0 ? currentTime : duration)}</span
	>
	{#if !compact}
		<button
			type="button"
			aria-label={t("media_playback_speed", { rate: formatNumber(rate) })}
			class="text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink h-[22px] shrink-0 cursor-pointer rounded-[7px] px-1.5 text-[11px] font-semibold tabular-nums transition-colors motion-reduce:transition-none"
			onclick={handleCycleRate}>{t("media_playback_rate", { rate: formatNumber(rate) })}</button
		>
	{/if}
</div>
