<script lang="ts">
	import type { SpaceSticker } from "$lib/types";
	import { getAvatarURL, getHostURL } from "$lib/common/common";
	import SpaceIcon from "$lib/components/SpaceIcon.svelte";
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

<div
	class="rounded-card border-duvet-line bg-duvet-card shadow-duvet-float flex h-105 w-90 flex-col overflow-hidden border font-[inherit]"
	role="dialog"
	aria-label="Sticker picker"
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
			bind:value={searchQuery}
			type="text"
			placeholder="Search stickers..."
			class="text-duvet-ink placeholder:text-duvet-ink2/60 min-w-0 flex-1 border-none bg-transparent text-[13px] outline-none"
			aria-label="Search stickers"
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

	<!-- Sticker grid -->
	<div
		class="[&::-webkit-scrollbar-thumb]:bg-duvet-ink/20 flex-1 overflow-y-auto px-3 py-3 [&::-webkit-scrollbar]:w-1.25 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
	>
		{#if groups.length === 0}
			<div class="flex h-full flex-col items-center justify-center text-center">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="32"
					height="32"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="text-duvet-ink2/60 mb-2"
					><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" /><path
						d="M14 3v4a2 2 0 0 0 2 2h4"
					/></svg
				>
				<p class="text-duvet-ink2/60 text-xs">No stickers available</p>
			</div>
		{:else if filtered.length === 0}
			<div class="text-duvet-ink2 py-7.5 text-center text-[13px]">No results for "{searchQuery}"</div>
		{:else}
			{#each filtered as group (group.space.id)}
				<div class="text-duvet-ink2 flex items-center gap-1.5 px-0.5 pb-2 text-xs font-bold not-first:pt-3">
					<SpaceIcon src={getAvatarURL(group.space.id, group.space.icon)} name={group.space.name} size={16} />
					<span class="truncate">{group.space.name}</span>
				</div>
				<div class="grid grid-cols-3 gap-2">
					{#each group.items as sticker (sticker.id)}
						<button
							class="hover:bg-duvet-ink/10 flex cursor-pointer items-center justify-center rounded-lg border-none bg-none p-2 transition-[background,transform] duration-100 hover:scale-105 active:scale-100"
							onclick={() => onSelect(sticker)}
							title={sticker.name}
							aria-label={sticker.name}
						>
							<img
								src="{host}/attachments/{sticker.attachment_id}"
								alt={sticker.name}
								class="pointer-events-none h-25 w-25 object-contain select-none"
								loading="lazy"
							/>
						</button>
					{/each}
				</div>
			{/each}
		{/if}
	</div>
</div>
