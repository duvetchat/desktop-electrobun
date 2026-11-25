<script lang="ts">
	import type { Snippet } from "svelte";
	import { richParts, type MessageKey, type MessageValues } from "$lib/i18n";

	// A message whose sentence has markup in it (#464): "<b>{name}</b> pinned <link>a message</link>." Each language
	// puts the tags where its sentence needs them; the caller says how each tag draws its words, as a snippet named
	// after it. A tag without one shows its words plainly.
	let {
		key,
		values = {},
		tags = {},
	}: {
		key: MessageKey;
		values?: MessageValues;
		tags?: Record<string, Snippet<[string]>>;
	} = $props();

	const parts = $derived(richParts(key, values));
</script>

<!-- On one line: a line break between the pieces would show as a space in the sentence. -->
<!-- prettier-ignore -->
{#each parts as part, index (index)}{#if typeof part === "string"}{part}{:else if tags[part.tag]}{@render tags[part.tag]?.(part.text)}{:else}{part.text}{/if}{/each}
