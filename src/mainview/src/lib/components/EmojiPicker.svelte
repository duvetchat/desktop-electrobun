<script lang="ts">
	import { emojiDataNow, loadEmojiData, toTwemojiUrl, type EmojiEntry } from "$lib/emoji";
	import type { SpaceEmoji } from "$lib/types";
	import { getAvatarURL, getHostURL } from "$lib/common/common";
	import SpaceIcon from "$lib/components/SpaceIcon.svelte";
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

	let searchEl: HTMLInputElement;
</script>

<div
	class="rounded-card border-duvet-line bg-duvet-card shadow-duvet-float flex h-105 w-90 flex-col overflow-hidden border font-[inherit]"
	role="dialog"
	aria-label="Emoji picker"
>
	<!-- Search bar -->
	<div class="border-duvet-line flex shrink-0 items-center gap-2 border-b px-3 pt-2.5 pb-2">
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="text-duvet-ink2 shrink-0"
			aria-hidden="true"
		>
			<circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
		</svg>
		<input
			bind:this={searchEl}
			bind:value={searchQuery}
			type="text"
			placeholder="Search emoji..."
			class="text-duvet-ink placeholder:text-duvet-ink2/60 min-w-0 flex-1 border-none bg-transparent text-[13px] outline-none"
			aria-label="Search emoji"
			autocomplete="off"
		/>
		{#if searchQuery}
			<button
				class="text-duvet-ink2 hover:text-duvet-ink flex shrink-0 cursor-pointer items-center rounded-[3px] border-none bg-none p-0.5"
				onclick={() => (searchQuery = "")}
				aria-label="Clear search"
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
				>
			</button>
		{/if}
	</div>

	{#if !isSearching}
		<!-- Category tabs: each Space's, then the dataset's -->
		<div
			class="border-duvet-line flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2.5 pt-1.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			role="tablist"
			aria-label="Emoji categories"
			onwheel={(e) => scrollSideways(e, e.currentTarget)}
		>
			{#each groups as group, i (group.space.id)}
				<button
					role="tab"
					aria-selected={activeCategory === i}
					aria-label={group.space.name}
					class="flex shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-none px-1.25 py-1 transition-[opacity,background] duration-120 {activeCategory ===
					i
						? 'bg-duvet-ink/10 opacity-100'
						: 'hover:bg-duvet-ink/10 opacity-55 hover:opacity-85'}"
					onclick={() => (activeCategory = i)}
					title={group.space.name}
				>
					<SpaceIcon src={getAvatarURL(group.space.id, group.space.icon)} name={group.space.name} size={20} />
				</button>
			{/each}
			{#each emojiCategories as cat, i}
				<button
					role="tab"
					aria-selected={activeCategory === i + categoryOffset}
					aria-label={cat.label}
					class="flex shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-none px-1.25 py-1 transition-[opacity,background] duration-120 {activeCategory ===
					i + categoryOffset
						? 'bg-duvet-ink/10 opacity-100'
						: 'hover:bg-duvet-ink/10 opacity-55 hover:opacity-85'}"
					onclick={() => (activeCategory = i + categoryOffset)}
					title={cat.label}
				>
					<img src={toTwemojiUrl(cat.icon)} alt={cat.label} class="block size-5" loading="lazy" />
				</button>
			{/each}
		</div>
	{/if}

	<!-- Emoji grid -->
	<div
		class="[&::-webkit-scrollbar-thumb]:bg-duvet-ink/20 flex-1 overflow-y-auto px-2.5 pt-1.5 pb-2.5 [&::-webkit-scrollbar]:w-1.25 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
		role="tabpanel"
	>
		{#if isSearching}
			{#if searchResults.length === 0}
				<div class="text-duvet-ink2 py-7.5 text-center text-[13px]">No results for "{searchQuery}"</div>
			{:else}
				<div class="text-duvet-ink2 px-0.5 pt-1.5 pb-2 text-xs font-bold">Search results</div>
				<div class="grid grid-cols-8 gap-0.5">
					{#each searchResults as entry (entry.emoji + entry.name)}
						<button
							class="hover:bg-duvet-ink/10 flex cursor-pointer items-center justify-center rounded-md border-none bg-none p-1.25 transition-[background,transform] duration-100 hover:scale-[1.18] active:scale-100"
							onclick={() => pick(entry.emoji)}
							title={entry.name}
							aria-label={entry.name}
						>
							{#if "customAttachmentId" in entry}
								<img
									src="{ceHost}/attachments/{entry.customAttachmentId}"
									alt=":{entry.name}:"
									class="pointer-events-none block size-6 object-contain select-none"
									loading="lazy"
								/>
							{:else}
								<img
									src={toTwemojiUrl(entry.emoji)}
									alt={entry.emoji}
									class="pointer-events-none block size-6 select-none"
									loading="lazy"
								/>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		{:else if shownGroup}
			<div class="text-duvet-ink2 truncate px-0.5 pt-1.5 pb-2 text-xs font-bold">{shownGroup.space.name}</div>
			<div class="grid grid-cols-8 gap-0.5">
				{#each shownGroup.items as ce (ce.id)}
					<button
						class="hover:bg-duvet-ink/10 flex cursor-pointer items-center justify-center rounded-md border-none bg-none p-1.25 transition-[background,transform] duration-100 hover:scale-[1.18] active:scale-100"
						onclick={() => pick(`<:${ce.id}:>`)}
						title=":{ce.name}:"
						aria-label=":{ce.name}:"
					>
						<img
							src="{ceHost}/attachments/{ce.attachment_id}"
							alt=":{ce.name}:"
							class="pointer-events-none block size-6 object-contain select-none"
							loading="lazy"
						/>
					</button>
				{/each}
			</div>
		{:else if shownCategory}
			<div class="text-duvet-ink2 px-0.5 pt-1.5 pb-2 text-xs font-bold">
				{shownCategory.label}
			</div>
			<div class="grid grid-cols-8 gap-0.5">
				{#each shownCategory.emojis as entry (entry.emoji)}
					<button
						class="hover:bg-duvet-ink/10 flex cursor-pointer items-center justify-center rounded-md border-none bg-none p-1.25 transition-[background,transform] duration-100 hover:scale-[1.18] active:scale-100"
						onclick={() => pick(entry.emoji)}
						title={entry.name}
						aria-label={entry.name}
					>
						<img
							src={toTwemojiUrl(entry.emoji)}
							alt={entry.emoji}
							class="pointer-events-none block size-6 select-none"
							loading="lazy"
						/>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
