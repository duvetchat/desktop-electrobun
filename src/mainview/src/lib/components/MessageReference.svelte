<script lang="ts">
	import { Phone as PhoneIcon } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { callNoticeText, type CallNoticeLine } from "$lib/call-notices";
	import { getAvatarURL } from "$lib/common/common";
	import { quoteJump } from "$lib/jumps";
	import { renderMarkdownLine, type CustomEmojiMap } from "$lib/markdown";
	import { jumpToMessageRequest, roomNames } from "$lib/stores.svelte";
	import { quotedAuthorName, type Message } from "$lib/types";

	// What a message answers, above it, as the chat and the previews (pins, search results, a thread) show it: a reply's
	// quote of the message it replies to, which a click jumps to, or "Original message was deleted"; or, on a bot's
	// message for an interaction, who used it, which a click takes to the component's message. A connector comes down
	// from the column of the author's avatar (gutter: its width and the space after it) to the line. A quoted call
	// notice says what its row does (quotedCall), which only the list showing it knows.
	let {
		message,
		quotedCall = null,
		mentionMap = {},
		customEmojiMap = {},
		spaceId,
		channelId,
		gutter = "mr-3 w-10",
	}: {
		message: Pick<Message, "referenced_message" | "interaction_metadata" | "author_name">;
		quotedCall?: CallNoticeLine | null;
		mentionMap?: Record<string, string>;
		customEmojiMap?: CustomEmojiMap;
		/** The message's space, "" in a conversation, and its room or conversation. */
		spaceId: string;
		channelId: string;
		gutter?: string;
	} = $props();

	const locale = typeof navigator !== "undefined" ? navigator.language : "en-US";

	// A reply's quote goes to the message it quotes, in the reply's room or conversation.
	function jumpToQuoted() {
		const link = message.referenced_message && quoteJump(message.referenced_message, { spaceId, channelId });
		if (link) jumpToMessageRequest.set({ id: crypto.randomUUID(), ...link });
	}
</script>

{#snippet connector()}
	<!-- An L from the middle of the avatar's column -->
	<div class="flex shrink-0 items-center justify-end {gutter}">
		<div class="rounded-tl-5px h-3.5 w-[calc(50%+1px)] border-t-2 border-l-2 border-zinc-500/60"></div>
	</div>
{/snippet}

{#if message.referenced_message}
	{@const ref = message.referenced_message}
	<div class="mb-0.5 flex min-w-0 items-start">
		{@render connector()}
		{#if !ref.created_at}
			<!-- The referenced message is gone: the API sends only the reference then -->
			<span class="-translate-y-1.25 text-xs text-zinc-500 italic">Original message was deleted</span>
		{:else}
			<!-- Reply preview -->
			<button
				type="button"
				class="flex min-w-0 -translate-y-1.25 cursor-pointer items-start gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-100"
				onclick={jumpToQuoted}
			>
				{#if quotedCall}
					<!-- A call notice has no text: what its row says, which names its caller -->
					<PhoneIcon class="size-4 shrink-0 {quotedCall.missed ? 'text-red-400' : 'text-zinc-500'}" />
					<span class="truncate opacity-80">{callNoticeText(quotedCall)}</span>
				{:else}
					<UserAvatar
						src={getAvatarURL(ref.author_id ?? "", ref.author_avatar)}
						name={ref.author_name ?? "?"}
						size={16}
					/>
					<span class="shrink-0 font-medium text-zinc-300">{quotedAuthorName(ref.author_name, ref)}</span>
					{#if ref.content}
						<span class="msg-content truncate opacity-80"
							>{@html renderMarkdownLine(ref.content, mentionMap, customEmojiMap, $roomNames)}</span
						>
					{:else}
						<!-- No text to show: only files, a sticker or components -->
						<span class="truncate italic opacity-80">Click to see message</span>
					{/if}
				{/if}
				<span class="shrink-0 opacity-50"
					>{new Date(ref.created_at).toLocaleTimeString(locale, {
						hour: "2-digit",
						minute: "2-digit",
					})}</span
				>
			</button>
		{/if}
	</div>
{:else if message.interaction_metadata}
	{@const used = message.interaction_metadata}
	{@const usedBy = used.user.alias ?? used.user.username}
	<!-- Who used the interaction this message answers; a click goes to the component's message -->
	<div class="mb-0.5 flex min-w-0 items-start">
		{@render connector()}
		<button
			type="button"
			class="flex min-w-0 -translate-y-1.25 items-center gap-1.5 text-xs text-zinc-400 transition-colors {used.interacted_message_id
				? 'cursor-pointer hover:text-zinc-100'
				: 'cursor-default'}"
			onclick={() => {
				if (!used.interacted_message_id) return;
				jumpToMessageRequest.set({
					id: crypto.randomUUID(),
					spaceId,
					roomId: channelId,
					messageId: used.interacted_message_id,
				});
			}}
		>
			<UserAvatar src={getAvatarURL(used.user.id, used.user.avatar)} name={usedBy} size={16} />
			<span class="shrink-0 font-medium text-zinc-300">{usedBy}</span>
			<span class="truncate"
				>used <span class="font-medium text-zinc-300">{used.name ? `/${used.name}` : message.author_name}</span></span
			>
		</button>
	</div>
{/if}
