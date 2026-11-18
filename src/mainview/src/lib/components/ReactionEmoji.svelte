<script lang="ts">
	import { getHostURL, isUuid } from "$lib/common/common";
	import { renderEmoji } from "$lib/emoji";
	import { CUSTOM_EMOJI_CLASS } from "$lib/emoji-retry";
	import { emojiImageUrl, type CustomEmojiMap } from "$lib/markdown";
	import type { MessageReaction } from "$lib/types";

	// A reaction's emoji: a custom one the map has as its image; one it doesn't (of a Space the user isn't in) from the
	// API's /emojis/{id}, named as the reaction names it; a Unicode one through renderEmoji, its Twemoji.
	let {
		reaction,
		customEmojiMap = {},
	}: { reaction: Pick<MessageReaction, "emoji_name" | "emoji_id">; customEmojiMap?: CustomEmojiMap } = $props();

	const host = getHostURL();
	const custom = $derived(
		reaction.emoji_id && Object.hasOwn(customEmojiMap, reaction.emoji_id) ? customEmojiMap[reaction.emoji_id] : null,
	);
	const elsewhere = $derived(!custom && reaction.emoji_id ? emojiImageUrl(reaction.emoji_id) : null);
	// An app that didn't know the emoji's name sent its ID as one: no name to show.
	const label = $derived(isUuid(reaction.emoji_name) ? ":emoji:" : `:${reaction.emoji_name}:`);
</script>

{#if custom}
	<img src="{host}/attachments/{custom.attachment_id}" alt=":{custom.name}:" class="size-5 object-contain" />
{:else if elsewhere}
	<img src={elsewhere} alt={label} title={label} class="size-5 object-contain {CUSTOM_EMOJI_CLASS}" />
{:else}
	{@html renderEmoji(reaction.emoji_name)}
{/if}
