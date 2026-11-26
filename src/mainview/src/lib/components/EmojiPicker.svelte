<script lang="ts">
	import { Clock as ClockIcon } from "@lucide/svelte";
	import { gridKeys } from "$lib/grid-keys";
	import { emojiDataNow, loadEmojiData, toTwemojiUrl, type EmojiEntry } from "$lib/emoji";
	import type { SpaceEmoji } from "$lib/types";
	import { getAvatarURL, getHostURL } from "$lib/common/common";
	import { t } from "$lib/i18n";
	import PickerSearch from "$lib/components/PickerSearch.svelte";
	import SpaceIcon from "$lib/components/ui/SpaceIcon.svelte";
	import { GLASS, OVERLINE } from "$lib/components/ui/recipes";
	import { customEmojiId, emojiUsed, recentEmoji, recentToShow } from "$lib/recent-emoji";
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

	// The emoji used lately (lib/recent-emoji.ts), ranked as the picker opens: the order holds while it's open. Those it
	// can draw make its first tab, Recently used: a custom emoji only while a group holds it, so one whose Space the user
	// left, or that was deleted, takes no place there. A Unicode one goes by its name in the dataset, once that's in.
	const ranked = recentEmoji();
	const customById = $derived(new Map(groups.flatMap((g) => g.items).map((ce) => [ce.id, ce])));
	const recent = $derived(recentToShow(ranked, (id) => customById.has(id)));
	const unicodeNames = $derived(new Map((emojiData?.allEmojis ?? []).map((e) => [e.emoji, e.name])));

	// Recently used comes first while it has something to show, then the Spaces' tabs, then the dataset's categories.
	const recentTabs = $derived(recent.length > 0 ? 1 : 0);
	const categoryOffset = $derived(recentTabs + groups.length);

	let searchQuery = $state("");
	let activeCategory = $state(0);
	const showingRecent = $derived(recentTabs > 0 && activeCategory === 0);
	// The Space whose tab is chosen, if one is.
	const shownGroup = $derived(groups[activeCategory - recentTabs]);
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

	// A pick counts as a use of its emoji, wherever the picker is (the message box, a reaction), as on the mobile app.
	function pick(emoji: string) {
		emojiUsed(emoji);
		onSelect(emoji);
	}
</script>

<!-- A named group: the popover that holds it is the dialog (the message box's, or a message's Add reaction). -->
<div
	class="{GLASS} text-duvet-ink flex h-[440px] max-h-[calc(100vh-20px)] w-[372px] max-w-[calc(100vw-20px)] flex-col overflow-hidden rounded-[20px]"
	role="group"
	aria-label={t("media_emoji_picker")}
>
	<PickerSearch bind:value={searchQuery} placeholder={t("media_emoji_search")} label={t("media_emoji_search")} />

	{#if !isSearching}
		<!-- Category tabs: Recently used, each Space's, then the dataset's -->
		<div
			class="border-duvet-line flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2.5 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			role="tablist"
			aria-label={t("media_emoji_categories")}
			onwheel={(e) => scrollSideways(e, e.currentTarget)}
		>
			{#if recentTabs > 0}
				<button
					role="tab"
					aria-selected={showingRecent}
					aria-label={t("media_emoji_recent")}
					class="grid h-7 w-[30px] shrink-0 cursor-pointer place-items-center rounded-lg transition-[opacity,background-color,filter] duration-[120ms] motion-reduce:transition-none {showingRecent
						? 'bg-duvet-accent-tint opacity-100'
						: 'hover:bg-duvet-hover opacity-70 grayscale hover:opacity-100 hover:grayscale-0'}"
					onclick={() => (activeCategory = 0)}
					title={t("media_emoji_recent")}
				>
					<ClockIcon size={17} />
				</button>
			{/if}
			{#each groups as group, i (group.space.id)}
				<button
					role="tab"
					aria-selected={activeCategory === i + recentTabs}
					aria-label={group.space.name}
					class="grid h-7 w-[30px] shrink-0 cursor-pointer place-items-center rounded-lg transition-[opacity,background-color,filter] duration-[120ms] motion-reduce:transition-none {activeCategory ===
					i + recentTabs
						? 'bg-duvet-accent-tint opacity-100'
						: 'hover:bg-duvet-hover opacity-70 grayscale hover:opacity-100 hover:grayscale-0'}"
					onclick={() => (activeCategory = i + recentTabs)}
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
					aria-label={t(cat.label)}
					class="grid h-7 w-[30px] shrink-0 cursor-pointer place-items-center rounded-lg transition-[opacity,background-color,filter] duration-[120ms] motion-reduce:transition-none {activeCategory ===
					i + categoryOffset
						? 'bg-duvet-accent-tint opacity-100'
						: 'hover:bg-duvet-hover opacity-70 grayscale hover:opacity-100 hover:grayscale-0'}"
					onclick={() => (activeCategory = i + categoryOffset)}
					title={t(cat.label)}
				>
					<img src={toTwemojiUrl(cat.icon)} alt={t(cat.label)} class="block size-[18px]" loading="lazy" />
				</button>
			{/each}
		</div>
	{/if}

	<!-- Emoji grid -->
	<!-- The arrows move through its emoji, a row at a time up and down (lib/grid-keys.ts). -->
	<div class="min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 pb-2" role="tabpanel" tabindex="-1" onkeydown={gridKeys}>
		{#if isSearching}
			{#if searchResults.length === 0}
				<div class="text-duvet-ink2 py-8 text-center text-[13px]">
					{t("media_picker_no_results", { query: searchQuery })}
				</div>
			{:else}
				<div class="{OVERLINE} px-1 pt-3 pb-1.5">
					{t("media_search_results")}
				</div>
				<div class="grid grid-cols-8 gap-0.5">
					{#each searchResults as entry (entry.emoji + entry.name)}
						<button
							class="hover:bg-duvet-hover focus-visible:bg-duvet-hover rounded-tile grid h-9 cursor-pointer place-items-center transition-[background-color,transform] duration-100 hover:scale-[1.12] active:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100"
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
		{:else if showingRecent}
			<div class="{OVERLINE} px-1 pt-3 pb-1.5">
				{t("media_emoji_recent")}
			</div>
			<div class="grid grid-cols-8 gap-0.5">
				{#each recent as code (code)}
					{@const id = customEmojiId(code)}
					{@const ce = id === null ? undefined : customById.get(id)}
					{@const label = ce ? `:${ce.name}:` : (unicodeNames.get(code) ?? code)}
					<button
						class="hover:bg-duvet-hover focus-visible:bg-duvet-hover rounded-tile grid h-9 cursor-pointer place-items-center transition-[background-color,transform] duration-100 hover:scale-[1.12] active:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100"
						onclick={() => pick(code)}
						title={label}
						aria-label={label}
					>
						{#if ce}
							<img
								src="{ceHost}/attachments/{ce.attachment_id}"
								alt=":{ce.name}:"
								class="pointer-events-none block size-[22px] object-contain select-none"
								loading="lazy"
							/>
						{:else}
							<img
								src={toTwemojiUrl(code)}
								alt={code}
								class="pointer-events-none block size-[22px] select-none"
								loading="lazy"
							/>
						{/if}
					</button>
				{/each}
			</div>
		{:else if shownGroup}
			<div class="text-duvet-ink2 truncate px-1 pt-3 pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] uppercase">
				{shownGroup.space.name}
			</div>
			<div class="grid grid-cols-8 gap-0.5">
				{#each shownGroup.items as ce (ce.id)}
					<button
						class="hover:bg-duvet-hover focus-visible:bg-duvet-hover rounded-tile grid h-9 cursor-pointer place-items-center transition-[background-color,transform] duration-100 hover:scale-[1.12] active:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100"
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
			<div class="{OVERLINE} px-1 pt-3 pb-1.5">
				{t(shownCategory.label)}
			</div>
			<div class="grid grid-cols-8 gap-0.5">
				{#each shownCategory.emojis as entry (entry.emoji)}
					<button
						class="hover:bg-duvet-hover focus-visible:bg-duvet-hover rounded-tile grid h-9 cursor-pointer place-items-center transition-[background-color,transform] duration-100 hover:scale-[1.12] active:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100"
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
