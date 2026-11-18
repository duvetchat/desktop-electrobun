<script lang="ts">
	import { getHostURL } from "$lib/common/common";
	import { renderEmoji } from "$lib/emoji";
	import type { CustomEmojiMap } from "$lib/markdown";
	import type { MessageReaction } from "$lib/types";

	// A reaction's emoji: one of the space's own as its image, any other through renderEmoji, which shows a Unicode
	// emoji's Twemoji, and the name of a custom one the space doesn't have (a conversation has none).
	let {
		reaction,
		customEmojiMap = {},
	}: { reaction: Pick<MessageReaction, "emoji_name" | "emoji_id">; customEmojiMap?: CustomEmojiMap } = $props();

	const host = getHostURL();
	const custom = $derived(
		reaction.emoji_id && Object.hasOwn(customEmojiMap, reaction.emoji_id) ? customEmojiMap[reaction.emoji_id] : null,
	);
</script>

{#if custom}
	<img src="{host}/attachments/{custom.attachment_id}" alt=":{custom.name}:" class="size-4 object-contain" />
{:else}
	{@html renderEmoji(reaction.emoji_name)}
{/if}
