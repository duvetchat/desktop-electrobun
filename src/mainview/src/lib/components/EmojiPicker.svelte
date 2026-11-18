<script lang="ts">
	import { emojiDataNow, loadEmojiData, toTwemojiUrl, type EmojiEntry } from "$lib/emoji";
	import type { SpaceEmoji } from "$lib/types";
	import { getHostURL } from "$lib/common/common";
	import PickerSearch from "$lib/components/PickerSearch.svelte";
	import Smile from "$lib/components/ui/icons/Smile.svelte";
	import { GLASS } from "$lib/components/ui/recipes";

	const ceHost = getHostURL();

	let { onSelect, customEmojis = [] }: { onSelect: (emoji: string) => void; customEmojis?: SpaceEmoji[] } = $props();

	// The emoji dataset, loaded as the picker first opens if the app hadn't loaded it yet (#292).
	let emojiData = $state.raw(emojiDataNow());
	void loadEmojiData().then((data) => (emojiData = data));
	const emojiCategories = $derived(emojiData?.emojiCategories ?? []);

	const hasCustom = $derived(customEmojis.length > 0);
	// Category 0 is custom emojis when available, otherwise shift
	const categoryOffset = $derived(hasCustom ? 1 : 0);

	let searchQuery = $state("");
	let activeCategory = $state(0);
	// The dataset's category the grid shows: none before the dataset is in.
	const shownCategory = $derived(emojiCategories[activeCategory - categoryOffset]);
	let searchResults = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return [];
		const customMatches = customEmojis
			.filter((ce) => ce.name.toLowerCase().includes(query))
			.map(
				(ce) =>
					({ emoji: `<:${ce.id}:>`, name: ce.name, customAttachmentId: ce.attachment_id }) as EmojiEntry & {
						customAttachmentId: string;
					},
			);
		return [...customMatches, ...(emojiData?.searchEmojis(searchQuery) ?? [])];
	});
	let isSearching = $derived(searchQuery.trim().length > 0);

	function pick(emoji: string) {
		onSelect(emoji);
	}
</script>

<div
	class="{GLASS} text-duvet-ink flex h-[440px] max-h-[calc(100vh-20px)] w-[372px] max-w-[calc(100vw-20px)] flex-col overflow-hidden rounded-[20px]"
	role="dialog"
	aria-label="Emoji picker"
>
	<PickerSearch bind:value={searchQuery} placeholder="Search emoji" label="Search emoji" />

	{#if !isSearching}
		<!-- Category tabs -->
		<div
			class="border-duvet-line flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2.5 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			role="tablist"
			aria-label="Emoji categories"
		>
			{#if hasCustom}
				<button
					role="tab"
					aria-selected={activeCategory === 0}
					aria-label="Space Emojis"
					class="text-duvet-ink2 grid h-7 w-[30px] shrink-0 cursor-pointer place-items-center rounded-lg transition-[opacity,background-color,filter] duration-[120ms] motion-reduce:transition-none {activeCategory ===
					0
						? 'bg-duvet-accent-tint opacity-100'
						: 'hover:bg-duvet-hover opacity-70 grayscale hover:opacity-100 hover:grayscale-0'}"
					onclick={() => (activeCategory = 0)}
					title="Space Emojis"
				>
					<Smile size={18} />
				</button>
			{/if}
			{#each emojiCategories as cat, i}
				<button
					role="tab"
					aria-selected={activeCategory === i + categoryOffset}
					aria-label={cat.label}
					class="grid h-7 w-[30px] shrink-0 cursor-pointer place-items-center rounded-lg transition-[opacity,background-color,filter] duration-[120ms] motion-reduce:transition-none {activeCategory ===
					i + categoryOffset
						? 'bg-duvet-accent-tint opacity-100'
						: 'hover:bg-duvet-hover opacity-70 grayscale hover:opacity-100 hover:grayscale-0'}"
					onclick={() => (activeCategory = i + categoryOffset)}
					title={cat.label}
				>
					<img src={toTwemojiUrl(cat.icon)} alt={cat.label} class="block size-[18px]" loading="lazy" />
				</button>
			{/each}
		</div>
	{/if}

	<!-- Emoji grid -->
	<div class="min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 pb-2" role="tabpanel">
		{#if isSearching}
			{#if searchResults.length === 0}
				<div class="text-duvet-ink2 py-8 text-center text-[13px]">No results for "{searchQuery}"</div>
			{:else}
				<div class="text-duvet-ink2 px-1 pt-3 pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] uppercase">
					Search results
				</div>
				<div class="grid grid-cols-8 gap-0.5">
					{#each searchResults as entry (entry.emoji + entry.name)}
						<button
							class="hover:bg-duvet-hover focus-visible:bg-duvet-hover grid h-9 cursor-pointer place-items-center rounded-[9px] transition-[background-color,transform] duration-100 hover:scale-[1.12] active:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100"
							onclick={() => pick(entry.emoji)}
							title={entry.name}
							aria-label={entry.name}
						>
							{#if "customAttachmentId" in entry}
								<img
									src="{ceHost}/attachments/{entry.customAttachmentId}"
									alt=":{entry.name}:"
									class="pointer-events-none block size-[22px] object-contain select-none"
									loading="lazy"
								/>
							{:else}
								<img
									src={toTwemojiUrl(entry.emoji)}
									alt={entry.emoji}
									class="pointer-events-none block size-[22px] select-none"
									loading="lazy"
								/>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		{:else if hasCustom && activeCategory === 0}
			<div class="text-duvet-ink2 px-1 pt-3 pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] uppercase">
				Space Emojis
			</div>
			<div class="grid grid-cols-8 gap-0.5">
				{#each customEmojis as ce (ce.id)}
					<button
						class="hover:bg-duvet-hover focus-visible:bg-duvet-hover grid h-9 cursor-pointer place-items-center rounded-[9px] transition-[background-color,transform] duration-100 hover:scale-[1.12] active:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100"
						onclick={() => pick(`<:${ce.id}:>`)}
						title=":{ce.name}:"
						aria-label=":{ce.name}:"
					>
						<img
							src="{ceHost}/attachments/{ce.attachment_id}"
							alt=":{ce.name}:"
							class="pointer-events-none block size-[22px] object-contain select-none"
							loading="lazy"
						/>
					</button>
				{/each}
			</div>
		{:else if shownCategory}
			<div class="text-duvet-ink2 px-1 pt-3 pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] uppercase">
				{shownCategory.label}
			</div>
			<div class="grid grid-cols-8 gap-0.5">
				{#each shownCategory.emojis as entry (entry.emoji)}
					<button
						class="hover:bg-duvet-hover focus-visible:bg-duvet-hover grid h-9 cursor-pointer place-items-center rounded-[9px] transition-[background-color,transform] duration-100 hover:scale-[1.12] active:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100"
						onclick={() => pick(entry.emoji)}
						title={entry.name}
						aria-label={entry.name}
					>
						<img
							src={toTwemojiUrl(entry.emoji)}
							alt={entry.emoji}
							class="pointer-events-none block size-[22px] select-none"
							loading="lazy"
						/>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
