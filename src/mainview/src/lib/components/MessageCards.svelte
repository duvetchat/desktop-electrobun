<script lang="ts">
	import BotInviteEmbed from "$lib/components/BotInviteEmbed.svelte";
	import EmbedCard from "$lib/components/EmbedCard.svelte";
	import InviteEmbed from "$lib/components/InviteEmbed.svelte";
	import MessageLinkEmbed from "$lib/components/MessageLinkEmbed.svelte";
	import type { Embed } from "$lib/types";
	import { duvetLinksIn } from "$lib/markdown";
	import type { MessageLink } from "$lib/urls";

	// The cards under a message's text, as the chat and the previews (pins, search results, a thread) show them: those of
	// Duvet's own links, whose previews the API leaves out for them (a space's invites, then bots', then messages'), then
	// its link previews (EmbedCard), smaller in a preview (compact). onPreview opens an embed's image.
	let {
		content,
		embeds,
		onPreview,
		compact = false,
	}: {
		content: string;
		embeds: Embed[] | null | undefined;
		onPreview: (src: string) => void;
		compact?: boolean;
	} = $props();

	const cards = $derived.by(() => {
		const inviteCodes: string[] = [];
		const botInviteIds: string[] = [];
		const messageLinks: MessageLink[] = [];
		for (const link of duvetLinksIn(content, window.location.origin)) {
			if ("message" in link) messageLinks.push(link.message);
			else if ("code" in link) inviteCodes.push(link.code);
			else botInviteIds.push(link.bot);
		}
		return { inviteCodes, botInviteIds, messageLinks };
	});
</script>

{#if cards.inviteCodes.length > 0}
	<div class="flex flex-col gap-2">
		{#each cards.inviteCodes as code}
			<InviteEmbed {code} />
		{/each}
	</div>
{/if}
{#if cards.botInviteIds.length > 0}
	<div class="flex flex-col gap-2">
		{#each cards.botInviteIds as botId}
			<BotInviteEmbed botUserId={botId} />
		{/each}
	</div>
{/if}
{#if cards.messageLinks.length > 0}
	<div class="flex flex-col gap-1">
		{#each cards.messageLinks as ml}
			<MessageLinkEmbed
				spaceId={ml.spaceId}
				roomId={ml.roomId}
				messageId={ml.messageId}
				conversationId={ml.conversationId}
			/>
		{/each}
	</div>
{/if}
{#if embeds && embeds.length > 0}
	<div class="flex flex-col gap-1">
		{#each embeds as embed}
			<EmbedCard {embed} {compact} onImageClick={(src) => onPreview(src)} />
		{/each}
	</div>
{/if}
