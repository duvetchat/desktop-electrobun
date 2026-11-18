<script lang="ts">
	import type { SpaceSticker } from "$lib/types";
	import { Sticker as StickerIcon } from "@lucide/svelte";
	import { getHostURL } from "$lib/common/common";
	import PickerSearch from "$lib/components/PickerSearch.svelte";
	import { GLASS } from "$lib/components/ui/recipes";

	const host = getHostURL();

	let { stickers = [], onSelect }: { stickers?: SpaceSticker[]; onSelect: (sticker: SpaceSticker) => void } = $props();

	let searchQuery = $state("");

	const filtered = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return stickers;
		return stickers.filter((s) => s.name.toLowerCase().includes(q));
	});
</script>

<div
	class="{GLASS} text-duvet-ink flex h-[440px] max-h-[calc(100vh-20px)] w-[372px] max-w-[calc(100vw-20px)] flex-col overflow-hidden rounded-[20px]"
	role="dialog"
	aria-label="Sticker picker"
>
	<PickerSearch bind:value={searchQuery} placeholder="Search stickers" label="Search stickers" />

	<!-- Sticker grid -->
	<div class="min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 pb-2">
		{#if stickers.length === 0}
			<div class="text-duvet-ink2 flex h-full flex-col items-center justify-center gap-2 text-center">
				<StickerIcon size={32} strokeWidth={1.5} aria-hidden="true" />
				<p class="text-xs">No stickers available</p>
			</div>
		{:else if filtered.length === 0}
			<div class="text-duvet-ink2 py-8 text-center text-[13px]">No results for "{searchQuery}"</div>
		{:else}
			<div class="grid grid-cols-3 gap-1">
				{#each filtered as sticker (sticker.id)}
					<button
						class="hover:bg-duvet-hover focus-visible:bg-duvet-hover flex aspect-square cursor-pointer items-center justify-center rounded-xl p-1.5 transition-[background-color,transform] duration-100 hover:scale-105 active:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100"
						onclick={() => onSelect(sticker)}
						title={sticker.name}
						aria-label={sticker.name}
					>
						<img
							src="{host}/attachments/{sticker.attachment_id}"
							alt={sticker.name}
							class="pointer-events-none size-full object-contain select-none"
							loading="lazy"
						/>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
