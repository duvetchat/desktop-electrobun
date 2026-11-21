<script lang="ts">
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import type { Snippet } from "svelte";
	import { ContextMenu } from "bits-ui";
	import { MENU_PANEL } from "./recipes";

	// A menu on a right-click: the same glass panel and items as Menu (MenuItem, MenuSeparator, MenuSub), opened at
	// the pointer. What is right-clicked is the `target` snippet, which spreads the props it gets on its element.
	let {
		open = $bindable(false),
		onOpenChange = undefined,
		onCloseAutoFocus = undefined,
		disabled = false,
		label = undefined,
		class: className = "",
		target,
		children,
	}: {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		/** Where the focus goes as it closes, when not back to what was right-clicked: preventDefault() keeps it. */
		onCloseAutoFocus?: (event: Event) => void;
		/** Leaves the right-click to the system's own menu. */
		disabled?: boolean;
		label?: string;
		class?: string;
		target: Snippet<[Record<string, unknown>]>;
		children: Snippet;
	} = $props();

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts).
	const layer = $derived(open ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});
</script>

<ContextMenu.Root bind:open {onOpenChange}>
	<ContextMenu.Trigger {disabled}>
		{#snippet child({ props })}
			{@render target(props)}
		{/snippet}
	</ContextMenu.Trigger>
	<ContextMenu.Portal>
		{#if layer}
			<!-- The panel's positioner takes no layer of its own: this holds it, at the overlay's (lib/overlay-layers.ts). -->
			<div class="fixed top-0 left-0" style={layerStyle(layer)}>
				<ContextMenu.Content
					collisionPadding={10}
					{onCloseAutoFocus}
					aria-label={label}
					class="{MENU_PANEL} origin-(--bits-floating-transform-origin) {className}"
				>
					{@render children()}
				</ContextMenu.Content>
			</div>
		{/if}
	</ContextMenu.Portal>
</ContextMenu.Root>
