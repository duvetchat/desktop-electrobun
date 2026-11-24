<script lang="ts">
	import { seekTo } from "$lib/seek-keys";
	import { Play, Pause, X } from "@lucide/svelte";
	import { fly } from "svelte/transition";
	import { motionMs } from "$lib/motion";
	import {
		voiceNote,
		toggleVoiceNote,
		seekVoiceNote,
		stopVoiceNote,
		getAttachmentRate,
		cyclePlaybackRate,
	} from "$lib/stores/voiceNotePlayer.svelte";
	import { formatDuration } from "$lib/utils/time";
	import VolumeControl from "$lib/components/VolumeControl.svelte";

	let rate = $state(1);

	// Sync rate when active attachment changes
	$effect(() => {
		if ($voiceNote) rate = getAttachmentRate($voiceNote.attachmentId);
	});

	function handleCycleRate() {
		if (!$voiceNote) return;
		cyclePlaybackRate($voiceNote.attachmentId);
		rate = getAttachmentRate($voiceNote.attachmentId);
	}

	function handleSeekKey(e: KeyboardEvent) {
		const note = $voiceNote;
		const to = note ? seekTo(e.key, note.currentTime, note.duration) : null;
		if (to === null) return;
		e.preventDefault();
		seekVoiceNote(to);
	}

	function handleSeek(e: MouseEvent) {
		const note = $voiceNote;
		if (!note || !note.duration) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		seekVoiceNote(ratio * note.duration);
	}

	const progress = $derived($voiceNote && $voiceNote.duration > 0 ? $voiceNote.currentTime / $voiceNote.duration : 0);
</script>

{#if $voiceNote}
	<!-- Mobile's playback bar (widgets/playback_bar.dart): a line of progress on top, what plays and how far, play or
	     pause, and Stop; with the app's speed and volume. A press on the line seeks. -->
	<section
		aria-label="Now playing"
		class="bg-duvet-sb-card shadow-duvet-raised mx-2.5 mb-2 shrink-0 rounded-[14px] select-none"
		in:fly={{ y: 20, duration: motionMs(200), opacity: 1 }}
		out:fly={{ y: 20, duration: motionMs(200), opacity: 1 }}
	>
		<!-- The line seeks: by a press on it, and from the keyboard by the arrows, Home and End (lib/seek-keys.ts). -->
		<div
			class="group relative h-2 cursor-pointer overflow-hidden rounded-t-[14px] -outline-offset-2"
			role="slider"
			tabindex="0"
			aria-label="Seek"
			aria-valuemin={0}
			aria-valuemax={Math.round($voiceNote.duration)}
			aria-valuenow={Math.round($voiceNote.currentTime)}
			onclick={handleSeek}
			onkeydown={handleSeekKey}
		>
			<div class="bg-duvet-hover-strong absolute inset-x-0 top-0 h-0.5 group-hover:h-1"></div>
			<div class="bg-duvet-accent absolute top-0 left-0 h-0.5 group-hover:h-1" style="width: {progress * 100}%;"></div>
		</div>
		<div class="flex items-center gap-1.5 pr-1.5 pb-2 pl-2">
			<button
				type="button"
				aria-label={$voiceNote.playing ? "Pause" : "Play"}
				class="bg-duvet-accent text-duvet-on-accent shadow-duvet-control grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-[10px] transition-[filter] hover:brightness-[1.06] motion-reduce:transition-none"
				onclick={toggleVoiceNote}
			>
				{#if $voiceNote.playing}
					<Pause size={14} fill="currentColor" stroke="none" />
				{:else}
					<Play size={14} fill="currentColor" stroke="none" />
				{/if}
			</button>

			<div class="flex min-w-0 flex-1 flex-col gap-px">
				<span class="text-duvet-ink truncate text-[13px] leading-[1.25] font-semibold"
					>{$voiceNote.filename ?? $voiceNote.authorName}</span
				>
				<span class="text-duvet-ink2 truncate text-[11.5px] leading-[1.25] tabular-nums">
					{#if $voiceNote.channelName}{$voiceNote.channelName} ·
					{/if}{formatDuration(
						$voiceNote.playing || $voiceNote.currentTime > 0 ? $voiceNote.currentTime : $voiceNote.duration,
					)} / {formatDuration($voiceNote.duration)}
				</span>
			</div>

			<button
				type="button"
				aria-label="Playback speed: {rate}x"
				class="text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink rounded-chip h-[22px] shrink-0 cursor-pointer px-1.5 text-[11px] font-semibold tabular-nums transition-colors motion-reduce:transition-none"
				onclick={handleCycleRate}>{rate}x</button
			>
			<VolumeControl height="h-20" />

			<button
				type="button"
				class="text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink grid size-[26px] shrink-0 cursor-pointer place-items-center rounded-lg transition-colors motion-reduce:transition-none"
				aria-label="Stop"
				onclick={stopVoiceNote}
			>
				<X size={14} />
			</button>
		</div>
	</section>
{/if}
