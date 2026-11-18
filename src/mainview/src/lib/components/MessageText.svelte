<script lang="ts">
	import { get } from "svelte/store";
	import { renderMarkdown, type CustomEmojiMap, type LinkDrawing } from "$lib/markdown";
	import { JUMBO_EMOJI, messageTextClass } from "$lib/message-styles";
	import {
		botInviteRequest,
		gatewaySpaces,
		jumpToMessageRequest,
		roomNames,
		spaceInviteRequest,
	} from "$lib/stores.svelte";

	// A message's text as the chat and the previews (pins, search results, a thread) show it: renderMarkdown draws it
	// whole, its emojis large in a message of only emojis, with its bare links. One opens its page, and one of Duvet's own
	// links reads as the cards under the text do: a message's as a chip of its room, which jumps to it, an invite's as a
	// button that opens it, whose clicks this takes. What follows the text says when it was edited.
	let {
		content,
		large = false,
		mentionMap = {},
		mentionStyles = undefined,
		customEmojiMap = {},
		edited = null,
		own = false,
	}: {
		content: string;
		large?: boolean;
		mentionMap?: Record<string, string>;
		/** The name style of each member a mention can name, by user ID: their role's colour in a Space. */
		mentionStyles?: Record<string, string>;
		customEmojiMap?: CustomEmojiMap;
		/** What "(…)" after the text says: that it was edited, and when. Nothing for a message never edited. */
		edited?: string | null;
		/** Whether the text sits in the user's own bubble, whose fills and links take the bubble's ink. */
		own?: boolean;
	} = $props();

	// Duvet's own links on duvet.chat or this app's own pages. A message's chip names its space as the spaces have it as
	// the text is drawn: they change with every presence, which would draw every message's text again.
	const links: LinkDrawing = {
		duvet: {
			ownOrigin: window.location.origin,
			spaceName: (id) => get(gatewaySpaces).find((s) => s.id === id)?.name,
		},
	};

	// A link's or a chip's click is its own: the message around it doesn't take it too.
	function openLink(e: MouseEvent) {
		const link = e.target instanceof Element ? e.target.closest<HTMLElement>(".msg-bare-link, .msg-duvet-link") : null;
		if (!link) return;
		e.stopPropagation();
		const { space, room, message, conversation, bot, invite } = link.dataset;
		if (message) {
			jumpToMessageRequest.set({
				id: crypto.randomUUID(),
				spaceId: space ?? "",
				roomId: room ?? "",
				messageId: message,
				...(conversation ? { conversationId: conversation } : {}),
			});
		} else if (bot) botInviteRequest.set(bot);
		else if (invite !== undefined) spaceInviteRequest.set(invite);
	}
</script>

<!-- The links and chips are links and buttons, which the keyboard reaches; this only hears their clicks. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<span class="contents {messageTextClass(own)} {large ? JUMBO_EMOJI : ''}" onclick={openLink}
	>{@html renderMarkdown(content, large, mentionMap, customEmojiMap, $roomNames, links, mentionStyles)}</span
>
{#if edited}
	<span class="ml-1 font-sans text-[11px] opacity-60">({edited})</span>
{/if}
