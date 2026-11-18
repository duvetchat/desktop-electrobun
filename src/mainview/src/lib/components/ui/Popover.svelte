<script lang="ts">
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import type { Snippet } from "svelte";
	import { Popover } from "bits-ui";
	import { GLASS } from "./recipes";

	// A popover: a glass panel against what opened it (8 px), below if it fits, else above, kept 10 px from the
	// window's edges. What opens it is the `trigger` snippet, which spreads the props it gets on its element. Its
	// width is the caller's (class); its corners are 20 px unless the class says otherwise.
	let {
		open = $bindable(false),
		onOpenChange = undefined,
		side = "bottom",
		align = "start",
		sideOffset = 8,
		label = undefined,
		class: className = "rounded-[20px]",
		trigger,
		children,
	}: {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		side?: "top" | "bottom" | "left" | "right";
		align?: "start" | "center" | "end";
		sideOffset?: number;
		/** The panel's name for a screen reader. */
		label?: string;
		class?: string;
		trigger: Snippet<[Record<string, unknown>]>;
		children: Snippet;
	} = $props();

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts).
	const layer = $derived(open ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});
</script>

<Popover.Root bind:open {onOpenChange}>
	<Popover.Trigger>
		{#snippet child({ props })}
			{@render trigger(props)}
		{/snippet}
	</Popover.Trigger>
	<Popover.Portal>
		{#if layer}
			<!-- The panel's positioner takes no layer of its own: this holds it, at the overlay's (lib/overlay-layers.ts). -->
			<div class="fixed top-0 left-0" style={layerStyle(layer)}>
				<Popover.Content
					{side}
					{align}
					{sideOffset}
					collisionPadding={10}
					role="dialog"
					aria-label={label}
					class="{GLASS} animate-float-in z-[1000] origin-(--bits-floating-transform-origin) overflow-hidden outline-none {className}"
				>
					{@render children()}
				</Popover.Content>
			</div>
		{/if}
	</Popover.Portal>
</Popover.Root>
