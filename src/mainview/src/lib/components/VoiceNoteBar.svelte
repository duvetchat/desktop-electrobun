<script lang="ts">
	import { Play, Pause, X } from "@lucide/svelte";
	import { fly } from "svelte/transition";
	import { voiceNote, toggleVoiceNote, seekVoiceNote, stopVoiceNote } from "$lib/stores/voiceNotePlayer.svelte";

	function formatTime(secs: number): string {
		if (!isFinite(secs) || secs < 0) return "0:00";
		const m = Math.floor(secs / 60);
		const s = Math.floor(secs % 60);
		return `${m}:${s.toString().padStart(2, "0")}`;
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
	<div
		class="shrink-0 border-t border-zinc-800"
		in:fly={{ y: 20, duration: 200, opacity: 1 }}
		out:fly={{ y: 20, duration: 200, opacity: 1 }}
	>
		<div class="flex items-center gap-2 px-2 py-1.5 select-none">
			<button
				class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[oklch(0.55_0.15_250)] text-white transition-colors hover:bg-[oklch(0.62_0.15_250)]"
				onclick={toggleVoiceNote}
			>
				{#if $voiceNote.playing}
					<Pause class="size-3.5" fill="currentColor" stroke="none" />
				{:else}
					<Play class="size-3.5" fill="currentColor" stroke="none" />
				{/if}
			</button>

			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<div class="flex items-center gap-1.5">
					<span class="truncate text-xs font-medium text-zinc-200">{$voiceNote.authorName}</span>
					<span class="text-xxs truncate text-zinc-500">{$voiceNote.channelName}</span>
				</div>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="relative h-1 cursor-pointer rounded-full bg-zinc-700" onclick={handleSeek}>
					<div
						class="absolute inset-y-0 left-0 rounded-full bg-[oklch(0.55_0.15_250)]"
						style="width: {progress * 100}%;"
					></div>
				</div>
				<span class="text-xxs tabular-nums text-zinc-500">
					{formatTime($voiceNote.playing || $voiceNote.currentTime > 0 ? $voiceNote.currentTime : $voiceNote.duration)}
					/ {formatTime($voiceNote.duration)}
				</span>
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
