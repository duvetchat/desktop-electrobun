<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { Play, Pause, Music } from "@lucide/svelte";
	import {
		voiceNote,
		playVoiceNote,
		toggleVoiceNote,
		seekVoiceNote,
		getAttachmentRate,
		cyclePlaybackRate,
		voiceNotePlayRequests,
	} from "$lib/stores/voiceNotePlayer.svelte";
	import { formatDuration } from "$lib/utils/time";
	import VolumeControl from "$lib/components/VolumeControl.svelte";
	import { formatFileSize } from "$lib/utils/format";
	import {
		waveformCache,
		analyzeWaveform,
		fallbackBars,
		makeWav,
		holdWav,
		keepWaveform,
		releaseWav,
	} from "$lib/audio/waveform";

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
	// The WAV it plays from, when this browser can't play the file as it is (wav()).
	let wavSrc = $state<string | null>(null);
	let analysis: Promise<void> | undefined;
	let releaseProbe: (() => void) | undefined;
	onDestroy(() => releaseProbe?.());
	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
		// Its WAV goes once nothing else holds it: another player of the file, or the voice note player (#167).
		releaseWav(wavSrc);
	});

	const rate = $derived.by(() => {
		void $voiceNote;
		return getAttachmentRate(attachmentId);
	});

	function handleCycleRate() {
		cyclePlaybackRate(attachmentId);
	}

	const BAR_COUNT = 80;

	const isActive = $derived($voiceNote?.attachmentId === attachmentId && attachmentId !== "");
	const playing = $derived(isActive ? $voiceNote!.playing : false);
	const currentTime = $derived(isActive ? $voiceNote!.currentTime : 0);
	const duration = $derived(isActive && $voiceNote!.duration > 0 ? $voiceNote!.duration : localDuration);
	const progress = $derived(duration > 0 ? currentTime / duration : 0);

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

	// Plays the file, from `at` seconds when it's given: as it is, or from a WAV when this browser can't play it as it is,
	// which the analysis says, the WAV made then (#316); if no other note was asked to play meanwhile, and while this
	// player is still there.
	async function play(at?: number) {
		const requests = voiceNotePlayRequests();
		await analysis;
		const from = (repaired ? await wav() : null) ?? src;
		if (destroyed || voiceNotePlayRequests() !== requests) return;
		playVoiceNote(from, attachmentId, authorName, channelName, filename);
		if (at !== undefined) seekVoiceNote(at);
	}

	const streamOf = (url: string) => (url.includes("?") ? `${url}&stream=1` : `${url}?stream=1`);
	// Whether this browser could decode it only once repaired (an Android recording, in Firefox: lib/audio/ogg.ts), and
	// so can't play it as it is either.
	let repaired = false;

	// Its bars, its duration and whether it needed the repair, kept for the next player of it (#316).
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
			if (import.meta.env.DEV) console.error("[AudioFilePlayer] waveform analysis failed:", e);
		}
	}

	// The WAV it plays from when it needs one, made as it first plays and held while the player's there; one made once
	// the player's gone is let go of at once: nothing else would (#167).
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
				if (import.meta.env.DEV) console.error("[AudioFilePlayer] its WAV failed:", e);
				wavMaking = null;
				return null;
			});
		return wavMaking;
	}

	onMount(() => {
		bars = fallbackBars(src, BAR_COUNT);

		const cached = waveformCache.get(attachmentId);
		if (cached) {
			bars = cached.bars;
			localDuration = cached.duration;
			wavSrc = cached.wavUrl ?? null;
			holdWav(wavSrc);
			repaired = cached.repaired ?? false;
			return;
		}

		analysis = loadAndAnalyze(src);

		// Its duration from the file's metadata, in case the analysis takes a while: the probe lets go of the file once it
		// has it, or as the player goes (#325).
		const probe = new Audio(src);
		probe.preload = "metadata";
		const release = () => {
			probe.removeAttribute("src");
			probe.load();
		};
		probe.addEventListener("loadedmetadata", () => {
			if (isFinite(probe.duration) && localDuration === 0) localDuration = probe.duration;
			release();
		});
		releaseProbe = release;
	});
</script>

<div class="bg-duvet-card shadow-duvet-raised flex w-[340px] max-w-full flex-col gap-2 rounded-[18px] p-2.5">
	<div class="flex min-w-0 items-center gap-2.5">
		<span
			class="bg-duvet-secondary-fill text-duvet-accent-text grid size-[34px] shrink-0 place-items-center rounded-[10px]"
		>
			<Music size={16} />
		</span>
		<div class="flex min-w-0 flex-col gap-px">
			<a
				href={src}
				target="_blank"
				rel="noopener noreferrer"
				class="text-duvet-ink truncate text-[13.5px] leading-[1.25] font-semibold hover:underline"
				download={filename}>{filename}</a
			>
			<span class="text-duvet-ink2 text-[11.5px] leading-[1.25]">{formatFileSize(sizeBytes)}</span>
		</div>
	</div>

	<div class="flex items-center gap-2">
		<button
			type="button"
			aria-label={playing ? "Pause" : "Play"}
			class="bg-duvet-accent text-duvet-on-accent shadow-duvet-control grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-full transition-[filter] hover:brightness-[1.06] motion-reduce:transition-none"
			onclick={togglePlay}
		>
			{#if playing}
				<Pause size={14} fill="currentColor" stroke="none" />
			{:else}
				<Play size={14} fill="currentColor" stroke="none" />
			{/if}
		</button>

		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="text-duvet-accent-text relative flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-px"
			onclick={handleSeek}
		>
			{#each bars as height, i}
				<div
					class="min-h-0.5 flex-1 rounded-full bg-current transition-opacity duration-100 motion-reduce:transition-none {i /
						bars.length <=
						progress &&
					(playing || currentTime > 0)
						? 'opacity-100'
						: 'opacity-30'}"
					style="height: {height * 100}%;"
				></div>
			{/each}
		</div>

		<span class="text-duvet-ink2 shrink-0 text-[11.5px] font-medium tabular-nums">
			{formatDuration(playing || currentTime > 0 ? currentTime : 0)}/{formatDuration(duration)}
		</span>

		<button
			type="button"
			aria-label="Playback speed: {rate}x"
			class="text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink h-[22px] shrink-0 cursor-pointer rounded-[7px] px-1.5 text-[11px] font-semibold tabular-nums transition-colors motion-reduce:transition-none"
			onclick={handleCycleRate}>{rate}x</button
		>

		<VolumeControl height="h-24" />
	</div>
</div>
