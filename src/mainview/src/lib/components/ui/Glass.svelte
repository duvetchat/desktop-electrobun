<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { GLASS, GLASS_STRONG } from "./recipes";

	// A glass surface: what floats over the app (a bar, a notice, a card over a banner). `strong` is the less
	// see-through glass of sheets and ⌘K. Its radius and size are the caller's.
	let {
		strong = false,
		class: className = "",
		children,
		...rest
	}: HTMLAttributes<HTMLDivElement> & { strong?: boolean; class?: string; children?: Snippet } = $props();
</script>

<div {...rest} class="{strong ? GLASS_STRONG : GLASS} {className}">
	{@render children?.()}
</div>
