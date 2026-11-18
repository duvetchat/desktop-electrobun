<script lang="ts">
	import { gridKeys } from "$lib/grid-keys";
	import { emojiDataNow, loadEmojiData, toTwemojiUrl, type EmojiEntry } from "$lib/emoji";
	import type { SpaceEmoji } from "$lib/types";
	import { getAvatarURL, getHostURL } from "$lib/common/common";
	import PickerSearch from "$lib/components/PickerSearch.svelte";
	import SpaceIcon from "$lib/components/ui/SpaceIcon.svelte";
	import { GLASS } from "$lib/components/ui/recipes";
	import type { PickerGroup } from "$lib/space-emojis";
	import { scrollSideways } from "$lib/sideways-scroll";

	const ceHost = getHostURL();

	// The custom emojis of every Space the user is in, wherever they write: a tab for each Space with emojis, in the order
	// pickerGroups gives, then the emoji dataset's categories.
	let { onSelect, groups = [] }: { onSelect: (emoji: string) => void; groups?: PickerGroup<SpaceEmoji>[] } = $props();

	// The emoji dataset, loaded as the picker first opens if the app hadn't loaded it yet (#292).
	let emojiData = $state.raw(emojiDataNow());
	void loadEmojiData().then((data) => (emojiData = data));
	const emojiCategories = $derived(emojiData?.emojiCategories ?? []);

	// The Spaces' tabs come first, the dataset's categories after them.
	const categoryOffset = $derived(groups.length);

	let searchQuery = $state("");
	let activeCategory = $state(0);
	// The Space whose tab is chosen, if one is.
	const shownGroup = $derived(groups[activeCategory]);
	// The dataset's category the grid shows: none before the dataset is in.
	const shownCategory = $derived(emojiCategories[activeCategory - categoryOffset]);
	let searchResults = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return [];
		const customMatches = groups
			.flatMap((g) => g.items)
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

<!-- A named group: the popover that holds it is the dialog (the message box's, or a message's Add reaction). -->
<div
	class="{GLASS} text-duvet-ink flex h-[440px] max-h-[calc(100vh-20px)] w-[372px] max-w-[calc(100vw-20px)] flex-col overflow-hidden rounded-[20px]"
	role="group"
	aria-label="Emoji picker"
>
	<PickerSearch bind:value={searchQuery} placeholder="Search emoji" label="Search emoji" />

	{#if !isSearching}
		<!-- Category tabs: each Space's, then the dataset's -->
		<div
			class="border-duvet-line flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2.5 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			role="tablist"
			aria-label="Emoji categories"
			onwheel={(e) => scrollSideways(e, e.currentTarget)}
		>
			{#each groups as group, i (group.space.id)}
				<button
					role="tab"
					aria-selected={activeCategory === i}
					aria-label={group.space.name}
					class="grid h-7 w-[30px] shrink-0 cursor-pointer place-items-center rounded-lg transition-[opacity,background-color,filter] duration-[120ms] motion-reduce:transition-none {activeCategory ===
					i
						? 'bg-duvet-accent-tint opacity-100'
						: 'hover:bg-duvet-hover opacity-70 grayscale hover:opacity-100 hover:grayscale-0'}"
					onclick={() => (activeCategory = i)}
					title={group.space.name}
				>
					<span class="contents" aria-hidden="true">
						<SpaceIcon
							src={group.space.icon ? getAvatarURL(group.space.id, group.space.icon) : null}
							name={group.space.name}
							size={18}
						/>
					</span>
				</button>
			{/each}
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
	<!-- The arrows move through its emoji, a row at a time up and down (lib/grid-keys.ts). -->
	<div class="min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 pb-2" role="tabpanel" tabindex="-1" onkeydown={gridKeys}>
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
		{:else if shownGroup}
			<div class="text-duvet-ink2 truncate px-1 pt-3 pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] uppercase">
				{shownGroup.space.name}
			</div>
			<div class="grid grid-cols-8 gap-0.5">
				{#each shownGroup.items as ce (ce.id)}
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
