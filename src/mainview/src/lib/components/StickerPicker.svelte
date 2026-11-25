<script lang="ts">
	import { gridKeys } from "$lib/grid-keys";
	import type { SpaceSticker } from "$lib/types";
	import { Sticker as StickerIcon } from "@lucide/svelte";
	import { getAvatarURL, getHostURL } from "$lib/common/common";
	import PickerSearch from "$lib/components/PickerSearch.svelte";
	import SpaceIcon from "$lib/components/ui/SpaceIcon.svelte";
	import { GLASS, OVERLINE } from "$lib/components/ui/recipes";
	import type { PickerGroup } from "$lib/space-emojis";

	const host = getHostURL();

	// The stickers of every Space the user is in, wherever they write: a section for each Space with stickers, in the
	// order pickerGroups gives; a search looks in all of them.
	let { groups = [], onSelect }: { groups?: PickerGroup<SpaceSticker>[]; onSelect: (sticker: SpaceSticker) => void } =
		$props();

	let searchQuery = $state("");

	const filtered = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return groups;
		return groups
			.map((g) => ({ ...g, items: g.items.filter((s) => s.name.toLowerCase().includes(q)) }))
			.filter((g) => g.items.length > 0);
	});
</script>

<!-- A named group: the popover that holds it is the dialog (the message box's, or a message's Add reaction). -->
<div
	class="{GLASS} text-duvet-ink flex h-[440px] max-h-[calc(100vh-20px)] w-[372px] max-w-[calc(100vw-20px)] flex-col overflow-hidden rounded-[20px]"
	role="group"
	aria-label="Sticker picker"
>
	<PickerSearch bind:value={searchQuery} placeholder="Search stickers" label="Search stickers" />

	<!-- Sticker grid -->
	<div class="min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 pb-2">
		{#if groups.length === 0}
			<div class="text-duvet-ink2 flex h-full flex-col items-center justify-center gap-2 text-center">
				<StickerIcon size={32} strokeWidth={1.5} aria-hidden="true" />
				<p class="text-xs">No stickers available</p>
			</div>
		{:else if filtered.length === 0}
			<div class="text-duvet-ink2 py-8 text-center text-[13px]">No results for "{searchQuery}"</div>
		{:else}
			{#each filtered as group (group.space.id)}
				<div class="{OVERLINE} flex items-center gap-1.5 px-1 pt-3 pb-1.5">
					<span class="contents" aria-hidden="true">
						<SpaceIcon
							src={group.space.icon ? getAvatarURL(group.space.id, group.space.icon) : null}
							name={group.space.name}
							size={16}
						/>
					</span>
					<span class="truncate">{group.space.name}</span>
				</div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="grid grid-cols-3 gap-1" onkeydown={gridKeys}>
					{#each group.items as sticker (sticker.id)}
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
			{/each}
		{/if}
	</div>
</div>
