<script lang="ts">
	import { Play, Pause, X, Volume1, Volume2, VolumeX } from "@lucide/svelte";
	import { fly } from "svelte/transition";
	import {
		voiceNote,
		toggleVoiceNote,
		seekVoiceNote,
		stopVoiceNote,
		audioVolume,
		getAttachmentRate,
		cyclePlaybackRate,
	} from "$lib/stores/voiceNotePlayer.svelte";
	import { formatDuration } from "$lib/utils/time";

	let showVolume = $state(false);
	let volumeTimeout: ReturnType<typeof setTimeout> | null = null;
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

	function handleSeek(e: MouseEvent) {
		const note = $voiceNote;
		if (!note || !note.duration) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		seekVoiceNote(ratio * note.duration);
	}

	function showVolumeSlider() {
		if (volumeTimeout) clearTimeout(volumeTimeout);
		showVolume = true;
	}

	function hideVolumeSlider() {
		volumeTimeout = setTimeout(() => (showVolume = false), 250);
	}

	const progress = $derived($voiceNote && $voiceNote.duration > 0 ? $voiceNote.currentTime / $voiceNote.duration : 0);
</script>

{#if $voiceNote}
	<div
		class="shrink-0 border-t border-zinc-800"
		in:fly={{ y: 20, duration: 200, opacity: 1 }}
		out:fly={{ y: 20, duration: 200, opacity: 1 }}
	>
		<div class="flex items-center gap-2 px-2 py-1.5 select-none">
			<button
				class="text-fixed-white flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[oklch(0.55_0.15_250)] transition-colors hover:bg-[oklch(0.62_0.15_250)]"
				onclick={toggleVoiceNote}
			>
				{#if $voiceNote.playing}
					<Pause class="size-3.5" fill="currentColor" stroke="none" />
				{:else}
					<Play class="size-3.5" fill="currentColor" stroke="none" />
				{/if}
			</button>

			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<div class="flex min-w-0 items-center gap-1.5">
					<span class="truncate text-xs font-medium text-zinc-200">{$voiceNote.filename ?? $voiceNote.authorName}</span>
					<span class="text-xxs shrink-0 text-zinc-500">{$voiceNote.channelName}</span>
				</div>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="relative h-1 cursor-pointer rounded-full bg-zinc-700" onclick={handleSeek}>
					<div
						class="absolute inset-y-0 left-0 rounded-full bg-[oklch(0.55_0.15_250)]"
						style="width: {progress * 100}%;"
					></div>
				</div>
				<div class="flex items-center gap-1">
					<span class="text-xxs text-zinc-500 tabular-nums">
						{formatDuration(
							$voiceNote.playing || $voiceNote.currentTime > 0 ? $voiceNote.currentTime : $voiceNote.duration,
						)}
						/ {formatDuration($voiceNote.duration)}
					</span>
					<button
						class="cursor-pointer rounded px-0.5 text-[9px] font-semibold text-zinc-500 tabular-nums transition-colors hover:bg-zinc-700 hover:text-zinc-300"
						onclick={handleCycleRate}>{rate}x</button
					>
				</div>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="relative shrink-0" onmouseenter={showVolumeSlider} onmouseleave={hideVolumeSlider}>
				<button
					class="flex size-6 cursor-pointer items-center justify-center text-zinc-500 transition-colors hover:text-zinc-300"
				>
					{#if $audioVolume === 0}
						<VolumeX class="size-3" />
					{:else if $audioVolume < 0.5}
						<Volume1 class="size-3" />
					{:else}
						<Volume2 class="size-3" />
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
							bind:value={$audioVolume}
							class="volume-slider h-20 w-1.5"
							style="writing-mode: vertical-lr; direction: rtl;"
						/>
						<span class="text-xxs text-zinc-400 tabular-nums">{Math.round($audioVolume * 100)}%</span>
					</div>
				{/if}
			</div>

			<button
				class="shrink-0 rounded-full p-1 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
				aria-label="Stop"
				onclick={stopVoiceNote}
			>
				<X class="size-3.5" />
			</button>
		</div>
	</div>
{/if}
