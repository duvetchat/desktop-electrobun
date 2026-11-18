<script lang="ts">
	import { Volume1, Volume2, VolumeX } from "@lucide/svelte";
	import { LinkPreview } from "bits-ui";
	import { GLASS } from "$lib/components/ui/recipes";
	import { audioVolume } from "$lib/stores/voiceNotePlayer.svelte";

	// The volume of voice messages and audio files, kept across restarts: a speaker that shows it (muted, low, high),
	// and on hover or focus a vertical slider with its percentage. The slider floats in the page's root, so nothing
	// around the speaker (a sidebar, a message list) clips it.
	let { height = "h-20" }: { height?: string } = $props();
</script>

<LinkPreview.Root openDelay={80} closeDelay={250}>
	<LinkPreview.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				aria-label="Volume: {Math.round($audioVolume * 100)}%"
				class="text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink grid size-[26px] shrink-0 cursor-pointer place-items-center rounded-lg transition-colors motion-reduce:transition-none"
			>
				{#if $audioVolume === 0}
					<VolumeX size={14} />
				{:else if $audioVolume < 0.5}
					<Volume1 size={14} />
				{:else}
					<Volume2 size={14} />
				{/if}
			</button>
		{/snippet}
	</LinkPreview.Trigger>
	<LinkPreview.Portal>
		<LinkPreview.Content
			side="top"
			align="center"
			sideOffset={4}
			collisionPadding={10}
			class="{GLASS} animate-float-in z-[1000] flex flex-col items-center gap-1 rounded-[14px] p-2 pb-2.5"
		>
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				aria-label="Volume"
				bind:value={$audioVolume}
				class="volume-slider {height} w-1.5"
				style="writing-mode: vertical-lr; direction: rtl;"
			/>
			<span class="text-duvet-ink2 text-[10.5px] tabular-nums">{Math.round($audioVolume * 100)}%</span>
		</LinkPreview.Content>
	</LinkPreview.Portal>
</LinkPreview.Root>
