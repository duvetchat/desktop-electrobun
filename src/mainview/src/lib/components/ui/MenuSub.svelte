<script lang="ts">
	import type { Component, Snippet } from "svelte";
	import { DropdownMenu } from "bits-ui";
	import { ChevronRight } from "@lucide/svelte";
	import { MENU_PANEL, menuItemClass } from "./recipes";

	// A submenu, inside a Menu or a ContextMenu: an item with a chevron that opens a second panel beside the menu, 2 px
	// away, to the right, or the left at the window's edge, its first item level with its parent. The offsets are
	// measured from the item, which sits 6 px inside the menu's panel: 6 + 2 to the side, and 6 up for the panel's own
	// padding.
	let {
		label,
		icon: Glyph = undefined,
		disabled = false,
		class: className = "",
		children,
	}: {
		label: string;
		icon?: Component<{ size?: number | string }>;
		disabled?: boolean;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<DropdownMenu.Sub>
	<DropdownMenu.SubTrigger {disabled} class={menuItemClass()}>
		{#if Glyph}
			<span class="text-duvet-ink2 grid w-[18px] shrink-0 place-items-center"><Glyph size={16} /></span>
		{/if}
		<span class="min-w-0 flex-1 truncate">{label}</span>
		<ChevronRight size={14} class="text-duvet-ink2 shrink-0" />
	</DropdownMenu.SubTrigger>
	<!-- In the page's root, as the menu is: the menu's glass (its backdrop-filter) would otherwise be what this
	     panel's fixed position is measured from, and it would land beside the wrong item. -->
	<DropdownMenu.Portal>
		<DropdownMenu.SubContent
			side="right"
			align="start"
			sideOffset={8}
			alignOffset={-6}
			collisionPadding={10}
			class="{MENU_PANEL} z-[1001] origin-(--bits-floating-transform-origin) {className}"
		>
			{@render children()}
		</DropdownMenu.SubContent>
	</DropdownMenu.Portal>
</DropdownMenu.Sub>
