<script lang="ts">
import type { SpaceSticker } from "$lib/types";
import { getHostURL } from "$lib/common/common";

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
	class="flex flex-col w-[360px] h-[420px] bg-[oklch(0.19_0.008_80)] border border-[oklch(0.30_0.01_80)] rounded-[10px] shadow-[0_8px_32px_rgba(0,0,0,0.55)] overflow-hidden font-[inherit]"
	role="dialog"
	aria-label="Sticker picker"
>
	<!-- Search bar -->
	<div class="flex items-center gap-2 px-3 pt-[10px] pb-2 border-b border-[oklch(0.25_0.01_80)] shrink-0">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-[oklch(0.55_0.01_80)] shrink-0" aria-hidden="true">
			<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
		</svg>
		<input
			bind:value={searchQuery}
			type="text"
			placeholder="Search stickers..."
			class="flex-1 bg-transparent border-none outline-none text-[oklch(0.92_0.01_80)] text-[13px] min-w-0 placeholder:text-[oklch(0.5_0.01_80)]"
			aria-label="Search stickers"
			autocomplete="off"
		/>
		{#if searchQuery}
			<button class="bg-none border-none cursor-pointer text-[oklch(0.55_0.01_80)] flex items-center p-[2px] rounded-[3px] shrink-0 hover:text-[oklch(0.8_0.01_80)]" onclick={() => (searchQuery = "")} aria-label="Clear search">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
			</button>
		{/if}
	</div>

	<!-- Sticker grid -->
	<div class="flex-1 overflow-y-auto px-3 py-3 [scrollbar-width:thin] [scrollbar-color:oklch(0.35_0.01_80)_transparent] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[oklch(0.35_0.01_80)] [&::-webkit-scrollbar-thumb]:rounded-full">
		{#if stickers.length === 0}
			<div class="flex flex-col items-center justify-center h-full text-center">
				<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-[oklch(0.4_0.01_80)] mb-2"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M14 3v4a2 2 0 0 0 2 2h4"/></svg>
				<p class="text-xs text-[oklch(0.45_0.01_80)]">No stickers available</p>
			</div>
		{:else if filtered.length === 0}
			<div class="text-center text-[oklch(0.52_0.01_80)] text-[13px] py-[30px]">No results for "{searchQuery}"</div>
		{:else}
			<div class="grid grid-cols-3 gap-2">
				{#each filtered as sticker (sticker.id)}
					<button
						class="bg-none border-none cursor-pointer p-2 rounded-lg flex items-center justify-center transition-[background,transform] duration-100 hover:bg-[oklch(0.30_0.01_80)] hover:scale-105 active:scale-100"
						onclick={() => onSelect(sticker)}
						title={sticker.name}
						aria-label={sticker.name}
					>
						<img
							src="{host}/attachments/{sticker.attachment_id}"
							alt={sticker.name}
							class="w-[100px] h-[100px] object-contain pointer-events-none select-none"
							loading="lazy"
						/>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
