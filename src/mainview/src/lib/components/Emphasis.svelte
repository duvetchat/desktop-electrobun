<script lang="ts">
	import type { Snippet } from "svelte";
	import { EMPHASIS_TAGS } from "$lib/urls";

	// The emphasis markdown wraps a bare link in (parseTextSegments' marks, outermost first): the tags renderMarkdown
	// puts around text with those marks, around what this wraps. Without marks, it's that alone.
	let { marks = [], children }: { marks?: string[]; children: Snippet } = $props();
</script>

{#snippet wrapped(rest: string[])}{#if rest.length > 0}<svelte:element this={EMPHASIS_TAGS[rest[0]]}
			>{@render wrapped(rest.slice(1))}</svelte:element
		>{:else}{@render children()}{/if}{/snippet}
{@render wrapped(marks)}
