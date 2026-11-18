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
		class="border-duvet-line shrink-0 border-t"
		in:fly={{ y: 20, duration: 200, opacity: 1 }}
		out:fly={{ y: 20, duration: 200, opacity: 1 }}
	>
		<div class="flex items-center gap-2 px-2 py-1.5 select-none">
			<button
				class="text-duvet-on-accent bg-duvet-accent hover:bg-duvet-accent/85 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors"
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
					<span class="text-duvet-ink truncate text-xs font-medium">{$voiceNote.filename ?? $voiceNote.authorName}</span
					>
					<span class="text-xxs text-duvet-ink2 shrink-0">{$voiceNote.channelName}</span>
				</div>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="bg-duvet-ink/10 relative h-1 cursor-pointer rounded-full" onclick={handleSeek}>
					<div class="bg-duvet-accent absolute inset-y-0 left-0 rounded-full" style="width: {progress * 100}%;"></div>
				</div>
				<div class="flex items-center gap-1">
					<span class="text-xxs text-duvet-ink2 tabular-nums">
						{formatDuration(
							$voiceNote.playing || $voiceNote.currentTime > 0 ? $voiceNote.currentTime : $voiceNote.duration,
						)}
						/ {formatDuration($voiceNote.duration)}
					</span>
					<button
						class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink cursor-pointer rounded px-0.5 text-[9px] font-semibold tabular-nums transition-colors"
						onclick={handleCycleRate}>{rate}x</button
					>
				</div>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="relative shrink-0" onmouseenter={showVolumeSlider} onmouseleave={hideVolumeSlider}>
				<button
					class="text-duvet-ink2 hover:text-duvet-ink flex size-6 cursor-pointer items-center justify-center transition-colors"
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
						class="rounded-card border-duvet-line bg-duvet-card shadow-duvet-float absolute bottom-full left-1/2 z-50 mb-0 flex -translate-x-1/2 flex-col items-center gap-1 border p-2 pb-3"
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
						<span class="text-xxs text-duvet-ink2 tabular-nums">{Math.round($audioVolume * 100)}%</span>
					</div>
				{/if}
			</div>

			<button
				class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink shrink-0 rounded-full p-1 transition-colors"
				aria-label="Stop"
				onclick={stopVoiceNote}
			>
				<X class="size-3.5" />
			</button>
		</div>
	</div>
{/if}
