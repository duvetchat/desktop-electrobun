<script lang="ts">
import { emojiCategories, searchEmojis, toTwemojiUrl, type EmojiEntry } from "$lib/emoji";

let { onSelect }: { onSelect: (emoji: string) => void } = $props();

let searchQuery = $state("");
let activeCategory = $state(0);
let searchResults = $derived(searchEmojis(searchQuery));
let isSearching = $derived(searchQuery.trim().length > 0);

function pick(emoji: string) {
	onSelect(emoji);
}

let searchEl: HTMLInputElement;
</script>

<div
	class="flex flex-col w-[360px] h-[420px] bg-[oklch(0.19_0.008_80)] border border-[oklch(0.30_0.01_80)] rounded-[10px] shadow-[0_8px_32px_rgba(0,0,0,0.55)] overflow-hidden font-[inherit]"
	role="dialog"
	aria-label="Emoji picker"
>
	<!-- Search bar -->
	<div class="flex items-center gap-2 px-3 pt-[10px] pb-2 border-b border-[oklch(0.25_0.01_80)] shrink-0">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-[oklch(0.55_0.01_80)] shrink-0" aria-hidden="true">
			<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
		</svg>
		<input
			bind:this={searchEl}
			bind:value={searchQuery}
			type="text"
			placeholder="Search emoji..."
			class="flex-1 bg-transparent border-none outline-none text-[oklch(0.92_0.01_80)] text-[13px] min-w-0 placeholder:text-[oklch(0.5_0.01_80)]"
			aria-label="Search emoji"
			autocomplete="off"
		/>
		{#if searchQuery}
			<button class="bg-none border-none cursor-pointer text-[oklch(0.55_0.01_80)] flex items-center p-[2px] rounded-[3px] shrink-0 hover:text-[oklch(0.8_0.01_80)]" onclick={() => (searchQuery = "")} aria-label="Clear search">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
			</button>
		{/if}
	</div>

	{#if !isSearching}
		<!-- Category tabs -->
		<div class="flex items-center gap-[2px] px-[10px] pt-[6px] pb-1 border-b border-[oklch(0.25_0.01_80)] shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Emoji categories">
			{#each emojiCategories as cat, i}
				<button
					role="tab"
					aria-selected={activeCategory === i}
					aria-label={cat.label}
					class="bg-none border-none cursor-pointer rounded-[6px] px-[5px] py-1 flex items-center justify-center shrink-0 transition-[opacity,background] duration-[120ms] {activeCategory === i ? 'opacity-100 bg-[oklch(0.30_0.015_80)]' : 'opacity-55 hover:opacity-85 hover:bg-[oklch(0.28_0.01_80)]'}"
					onclick={() => (activeCategory = i)}
					title={cat.label}
				>
					<img
						src={toTwemojiUrl(cat.icon)}
						alt={cat.label}
						class="size-5 block"
						loading="lazy"
					/>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Emoji grid -->
	<div class="flex-1 overflow-y-auto px-[10px] pt-[6px] pb-[10px] [scrollbar-width:thin] [scrollbar-color:oklch(0.35_0.01_80)_transparent] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[oklch(0.35_0.01_80)] [&::-webkit-scrollbar-thumb]:rounded-full" role="tabpanel">
		{#if isSearching}
			{#if searchResults.length === 0}
				<div class="text-center text-[oklch(0.52_0.01_80)] text-[13px] py-[30px]">No results for "{searchQuery}"</div>
			{:else}
				<div class="text-[10px] font-bold tracking-[0.06em] uppercase text-[oklch(0.52_0.01_80)] px-[2px] pt-[6px] pb-2">Search results</div>
				<div class="grid grid-cols-8 gap-[2px]">
					{#each searchResults as entry (entry.emoji)}
						<button
							class="bg-none border-none cursor-pointer p-[5px] rounded-[6px] flex items-center justify-center transition-[background,transform] duration-100 hover:bg-[oklch(0.30_0.01_80)] hover:scale-[1.18] active:scale-100"
							onclick={() => pick(entry.emoji)}
							title={entry.name}
							aria-label={entry.name}
						>
							<img
								src={toTwemojiUrl(entry.emoji)}
								alt={entry.emoji}
								class="size-6 block pointer-events-none select-none"
								loading="lazy"
							/>
						</button>
					{/each}
				</div>
			{/if}
		{:else}
			{@const cat = emojiCategories[activeCategory]}
			<div class="text-[10px] font-bold tracking-[0.06em] uppercase text-[oklch(0.52_0.01_80)] px-[2px] pt-[6px] pb-2">{cat.label}</div>
			<div class="grid grid-cols-8 gap-[2px]">
				{#each cat.emojis as entry (entry.emoji)}
					<button
						class="bg-none border-none cursor-pointer p-[5px] rounded-[6px] flex items-center justify-center transition-[background,transform] duration-100 hover:bg-[oklch(0.30_0.01_80)] hover:scale-[1.18] active:scale-100"
						onclick={() => pick(entry.emoji)}
						title={entry.name}
						aria-label={entry.name}
					>
						<img
							src={toTwemojiUrl(entry.emoji)}
							alt={entry.emoji}
							class="size-6 block pointer-events-none select-none"
							loading="lazy"
						/>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
