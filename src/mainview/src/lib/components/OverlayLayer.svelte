<script lang="ts">
	import { onDestroy, type Snippet } from "svelte";
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";

	// An overlay's layer for as long as this is mounted (lib/overlay-layers.ts): what it wraps is mounted only while
	// it's open, and sits in a holder at that layer, as a floating panel's positioner takes none of its own. For an
	// overlay there are many of, closed, at once (a profile under every author and member row): they cost nothing
	// until one opens.
	let { children }: { children: Snippet } = $props();

	const layer = claimLayer();
	onDestroy(() => releaseLayer(layer));
</script>

<div class="fixed top-0 left-0" style={layerStyle(layer)}>
	{@render children()}
</div>
