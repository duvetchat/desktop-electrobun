<script lang="ts">
	import type { Component, Snippet } from "svelte";
	import { DropdownMenu } from "bits-ui";
	import { Check } from "@lucide/svelte";
	import { menuItemClass } from "./recipes";

	// An item of a Menu, a ContextMenu or a MenuSub (bits-ui's menus share their items): an icon slot, its label with
	// an optional hint under it, a check when it's a choice that is on, and its shortcut. With `checked` set, on or
	// off, it is a checkbox item: one without an icon shows its check in the icon's place.
	let {
		icon: Glyph = undefined,
		hint = undefined,
		keys = undefined,
		danger = false,
		checked = undefined,
		disabled = false,
		closeOnSelect = true,
		onSelect = undefined,
		children,
	}: {
		icon?: Component<{ size?: number | string }>;
		hint?: string;
		/** The shortcut, already written for this system ("⌘K", "Ctrl K"). */
		keys?: string;
		danger?: boolean;
		checked?: boolean;
		disabled?: boolean;
		closeOnSelect?: boolean;
		onSelect?: () => void;
		children: Snippet;
	} = $props();
</script>

{#snippet body()}
	{#if Glyph}
		<span class="grid w-[18px] shrink-0 place-items-center {danger ? '' : 'text-duvet-ink2'}"><Glyph size={16} /></span>
	{:else if checked !== undefined}
		<span class="text-duvet-accent-text grid w-[18px] shrink-0 place-items-center">
			{#if checked}<Check size={15} />{/if}
		</span>
	{/if}
	<span class="flex min-w-0 flex-1 flex-col gap-px">
		<span class="truncate">{@render children()}</span>
		{#if hint}<span class="text-duvet-ink2 text-[11px] leading-[1.2] font-normal">{hint}</span>{/if}
	</span>
	{#if Glyph && checked}<Check size={15} class="text-duvet-accent-text shrink-0" />{/if}
	{#if keys}
		<span class="text-duvet-ink2 shrink-0 pl-3 text-[11.5px] leading-none font-normal tracking-[0.02em]">{keys}</span>
	{/if}
{/snippet}

{#if checked === undefined}
	<DropdownMenu.Item {disabled} {closeOnSelect} {onSelect} class={menuItemClass(danger)}>
		{@render body()}
	</DropdownMenu.Item>
{:else}
	<DropdownMenu.CheckboxItem {checked} {disabled} {closeOnSelect} {onSelect} class={menuItemClass(danger)}>
		{@render body()}
	</DropdownMenu.CheckboxItem>
{/if}
