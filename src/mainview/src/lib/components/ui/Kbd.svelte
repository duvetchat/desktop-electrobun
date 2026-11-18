<script lang="ts">
	import type { Snippet } from "svelte";

	// A key cap: a shortcut's key or keys, as the app writes them ("⌘K", "Ctrl K").
	let { class: className = "", children }: { class?: string; children: Snippet } = $props();
</script>

<kbd
	class="bg-duvet-kbd text-duvet-ink2 inline-flex h-[18px] items-center rounded-[5px] px-[5px] text-[10.5px] leading-none font-medium tracking-[0.02em] whitespace-nowrap shadow-[inset_0_-1px_0_var(--duvet-line)] {className}"
>
	{@render children()}
</kbd>
