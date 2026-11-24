<script lang="ts">
	import { CornerUpLeft as ReplyIcon, Phone as PhoneIcon, SquareSlash as CommandIcon } from "@lucide/svelte";
	import Rich from "$lib/components/Rich.svelte";
	import { callNoticeSentence, type CallNoticeWords } from "$lib/call-notices";
	import { t } from "$lib/i18n";
	import { quoteJump } from "$lib/jumps";
	import { renderMarkdownLine, type CustomEmojiMap } from "$lib/markdown";
	import { messageTextClass } from "$lib/message-styles";
	import { jumpToMessageRequest, roomNames } from "$lib/stores.svelte";
	import { quotedAuthorName, type Message } from "$lib/types";

	// What a message answers, above it, as the chat and the previews (pins, search results, a thread) show it: a reply's
	// strip, with who wrote the message it replies to and one line of it, which a click jumps to, or "Original message
	// was deleted"; or, on a bot's message for an interaction, who used it, which a click takes to the component's
	// message. A quoted call notice says what its row does (quotedCall), which only the list showing it knows.
	let {
		message,
		quotedCall = null,
		mentionMap = {},
		customEmojiMap = {},
		spaceId,
		channelId,
	}: {
		message: Pick<Message, "referenced_message" | "interaction_metadata" | "author_name">;
		quotedCall?: CallNoticeWords | null;
		mentionMap?: Record<string, string>;
		customEmojiMap?: CustomEmojiMap;
		/** The message's space, "" in a conversation, and its room or conversation. */
		spaceId: string;
		channelId: string;
	} = $props();

	const STRIP = "text-duvet-ink2 flex max-w-full min-w-0 items-center gap-[5px] px-1 text-[12.5px] leading-[1.3]";

	// A reply's quote goes to the message it quotes, in the reply's room or conversation.
	function jumpToQuoted() {
		const link = message.referenced_message && quoteJump(message.referenced_message, { spaceId, channelId });
		if (link) jumpToMessageRequest.set({ id: crypto.randomUUID(), ...link });
	}
</script>

{#if message.referenced_message}
	{@const ref = message.referenced_message}
	{#if !ref.created_at}
		<!-- The referenced message is gone: the API sends only the reference then -->
		<span class="{STRIP} italic">
			<ReplyIcon size={12} class="shrink-0" />
			{t("chat_quote_deleted")}
		</span>
	{:else}
		<button
			type="button"
			class="{STRIP} hover:text-duvet-ink cursor-pointer text-left transition-colors motion-reduce:transition-none"
			onclick={jumpToQuoted}
		>
			{#if quotedCall}
				<!-- A call notice has no text: what its row says, which names its caller -->
				<PhoneIcon class="size-3.5 shrink-0 {quotedCall.missed ? 'text-duvet-danger' : 'text-duvet-ink2'}" />
				<span class="truncate">{callNoticeSentence(quotedCall)}</span>
			{:else}
				<ReplyIcon size={12} class="shrink-0" />
				<span class="text-duvet-ink shrink-0 font-semibold">{quotedAuthorName(ref.author_name, ref)}</span>
				{#if ref.content}
					<span class="msg-content font-content truncate {messageTextClass()}"
						>{@html renderMarkdownLine(ref.content, mentionMap, customEmojiMap, $roomNames)}</span
					>
				{:else}
					<!-- No text to show: only files, a sticker or components -->
					<span class="truncate italic">{t("chat_quote_without_text")}</span>
				{/if}
			{/if}
		</button>
	{/if}
{:else if message.interaction_metadata}
	{@const used = message.interaction_metadata}
	{@const usedBy = used.user.alias ?? used.user.username}
	<!-- Who used the interaction this message answers; a click goes to the component's message -->
	<button
		type="button"
		class="{STRIP} text-left transition-colors motion-reduce:transition-none {used.interacted_message_id
			? 'hover:text-duvet-ink cursor-pointer'
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
		<CommandIcon size={12} class="shrink-0" />
		<Rich
			key="chat_interaction_used"
			values={{ user: usedBy, command: used.name ? `/${used.name}` : message.author_name }}
			tags={{ who: user, what: command }}
		/>
	</button>
{/if}

<!-- Who used a bot's interaction, and what they used: its command, or the bot's name for a button or a menu. Each
     piece is a flex item of the strip, so the name is never cut and only the command truncates. -->
{#snippet user(text: string)}<span class="text-duvet-ink shrink-0 font-semibold">{text}</span>{/snippet}
{#snippet command(text: string)}<span class="text-duvet-ink min-w-0 truncate font-medium">{text}</span>{/snippet}
