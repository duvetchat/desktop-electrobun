<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { GLASS } from "$lib/components/ui/recipes";

	// A notice: what drops in at the top of the window when something happens elsewhere (a mention, a message, an
	// incoming call). This is its frame alone, glass with 18 px corners, arriving on the spring; what it says and does
	// is its content's. MentionNotices stacks the mentions' and takes a call's above them (its `children`).
	let {
		class: className = "",
		children,
		...rest
	}: Omit<HTMLAttributes<HTMLDivElement>, "class"> & { class?: string; children: Snippet } = $props();
</script>

<div
	{...rest}
	class="{GLASS} animate-notice-in text-duvet-ink pointer-events-auto flex items-start rounded-[18px] text-left {className}"
>
	{@render children()}
</div>
