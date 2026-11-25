<script lang="ts">
	import type { Snippet } from "svelte";
	import { CARD, GROUP_TITLE, NOTE } from "./recipes";

	// A group of settings (#357, DESIGN-MAP.md S-47): its title, a card of rows split by hairlines, and a note under
	// it. With `plain` the card's inside is the caller's own (a form, a preview), padded.
	let {
		title = undefined,
		note = undefined,
		plain = false,
		class: className = "",
		actions = undefined,
		children,
	}: {
		title?: string;
		note?: string;
		plain?: boolean;
		class?: string;
		/** What sits at the right of the title: the group's own button. */
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section class="flex flex-col gap-2.5">
	{#if title || actions}
		<div class="flex min-h-6 items-center gap-2">
			{#if title}<h3 class="{GROUP_TITLE} min-w-0 flex-1">{title}</h3>{:else}<span class="flex-1"></span>{/if}
			{@render actions?.()}
		</div>
	{/if}
	<div class="{CARD} {plain ? 'p-5' : 'divide-duvet-line divide-y'} {className}">
		{@render children()}
	</div>
	{#if note}<p class={NOTE}>{note}</p>{/if}
</section>
