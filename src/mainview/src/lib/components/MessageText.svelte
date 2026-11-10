<script lang="ts">
	import Emphasis from "$lib/components/Emphasis.svelte";
	import { parseTextSegments, renderMarkdown, type CustomEmojiMap } from "$lib/markdown";
	import {
		botInviteRequest,
		gatewaySpaces,
		jumpToMessageRequest,
		roomNames,
		spaceInviteRequest,
	} from "$lib/stores.svelte";
	import { cardLink, parseDuvetLink, type MessageLink } from "$lib/urls";

	// A message's text as the chat and the previews (pins, search results, a thread) show it: a bare link opens its page,
	// one of Duvet's own links reads as the cards under the text do (cardLink, parseDuvetLink: a message's as a chip of its
	// room, which jumps to it, an invite's as a button that opens it), and the rest goes through renderMarkdown, its
	// emojis large in a message of only emojis. What follows the text says when it was edited.
	let {
		content,
		large = false,
		mentionMap = {},
		customEmojiMap = {},
		edited = null,
	}: {
		content: string;
		large?: boolean;
		mentionMap?: Record<string, string>;
		customEmojiMap?: CustomEmojiMap;
		/** What "(…)" after the text says: that it was edited, and when. Nothing for a message never edited. */
		edited?: string | null;
	} = $props();

	// One of Duvet's own links, on duvet.chat or this app's own pages, read as the API reads it (lib/urls.ts).
	const duvetLinkOf = (url: string) => parseDuvetLink(url, window.location.origin);

	function resolveMessageLink(link: MessageLink): MessageLink & { spaceName: string; roomName: string } {
		if (link.conversationId) return { ...link, spaceName: "", roomName: "Direct Message" };
		const sp = $gatewaySpaces.find((s) => s.id === link.spaceId);
		const rm = sp?.rooms.find((r) => r.id === link.roomId);
		return { ...link, spaceName: sp?.name ?? "Unknown Space", roomName: rm?.name ?? "unknown" };
	}
</script>

{#each parseTextSegments(content) as segment}
	{#if segment.type === "link"}
		{@const link = cardLink(segment.content)}
		{@const card = duvetLinkOf(link)}
		<!-- One of Duvet's own links reads as the cards do (cardLink): what follows it is text. Emphasis around a link
		     wraps it (parseTextSegments) -->
		<Emphasis marks={segment.emphasis}>
			{#if card && "message" in card}
				{@const resolved = resolveMessageLink(card.message)}
				<button
					type="button"
					class="mx-0.5 inline-flex cursor-pointer items-center gap-1 rounded border border-zinc-600/50 bg-zinc-700/70 px-1.5 py-0.5 align-middle text-zinc-300 transition-colors hover:bg-zinc-600/80 hover:text-white"
					onclick={(e) => {
						e.stopPropagation();
						jumpToMessageRequest.set({ id: crypto.randomUUID(), ...card.message });
					}}
					title="{resolved.spaceName} › #{resolved.roomName}"
				>
					<span class="text-xs text-zinc-400">#</span>
					<span class="text-xs font-medium">{resolved.roomName}</span>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="10"
						height="10"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="shrink-0 text-zinc-400"><path d="m9 18 6-6-6-6" /></svg
					>
				</button>{segment.content.slice(link.length)}
			{:else if card}
				<button
					type="button"
					class="cursor-pointer text-stone-300 hover:underline"
					onclick={(e) => {
						e.stopPropagation();
						if ("bot" in card) botInviteRequest.set(card.bot);
						else spaceInviteRequest.set(card.code);
					}}>{link}</button
				>{segment.content.slice(link.length)}
			{:else}
				<a
					href={segment.content}
					target="_blank"
					rel="noopener noreferrer"
					class="text-stone-300 hover:underline"
					onclick={(e) => {
						e.stopPropagation();
					}}>{segment.content}</a
				>
			{/if}
		</Emphasis>
	{:else}
		{@html renderMarkdown(segment.content, large, mentionMap, customEmojiMap, $roomNames)}
	{/if}
{/each}
{#if edited}
	<span class="text-xxs ml-1 text-zinc-500">({edited})</span>
{/if}
