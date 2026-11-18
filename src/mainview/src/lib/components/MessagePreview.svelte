<script lang="ts">
	import { Hash as HashIcon, Phone as PhoneIcon } from "@lucide/svelte";
	import { onMount } from "svelte";
	import AuthorTag from "$lib/components/AuthorTag.svelte";
	import DeferredResponse from "$lib/components/DeferredResponse.svelte";
	import MessageAttachments from "$lib/components/MessageAttachments.svelte";
	import MessageCards from "$lib/components/MessageCards.svelte";
	import MessageComponents from "$lib/components/MessageComponents.svelte";
	import MessageReactions from "$lib/components/MessageReactions.svelte";
	import MessageReference from "$lib/components/MessageReference.svelte";
	import MessageText from "$lib/components/MessageText.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { toggleReaction } from "$lib/api/reactions";
	import { callNoticeLine, callNoticeText, type CallNoticeLine } from "$lib/call-notices";
	import { copyCode } from "$lib/code-copy";
	import { largeEmojis } from "$lib/emoji";
	import type { CustomEmojiMap } from "$lib/markdown";
	import { nameColor } from "$lib/name-colors";
	import { onReactionChange, withReaction } from "$lib/reactions";
	import { currentUser, openRoomMention, reactorsRequest } from "$lib/stores.svelte";
	import {
		isComponentsV2,
		isLoading,
		MessageType,
		previewReplacesText,
		type MemberOnSidebar,
		type Message,
		type MessageReaction,
	} from "$lib/types";
	import { formatShortDateTime } from "$lib/utils/time";

	// A message as the search results, the pinned messages list and a thread show it: its channel (when given), what it
	// answers (a reply's quote, who used a bot's interaction), its author with their role's colour and a bot's or
	// webhook's tag, its date, and its content as the chat shows it, through the same pieces (MessageText, MessageCards,
	// MessageAttachments, MessageComponents, MessageReactions), smaller: its text clamped to six lines, its media in
	// 320 × 240, and no interaction sent from its components. A click on something that acts there (a link, a button, a
	// file) is that thing's; what holds the preview leaves those clicks alone. onPreview opens an image. The text is
	// marked data-search-content for the search's highlights. A thread can start at a call notice, which says what its
	// row in the chat does.
	let {
		message,
		spaceId = "",
		channelId,
		roomName = null,
		members = [],
		mentionMap = {},
		customEmojiMap = {},
		quotedCall = null,
		onPreview,
	}: {
		message: Message;
		/** The message's space, "" in a conversation, and its room or conversation: where its reactions and quote go. */
		spaceId?: string;
		channelId: string;
		roomName?: string | null;
		/** The room's or the conversation's members: who the author is among them, for the colour of their name. */
		members?: MemberOnSidebar[];
		mentionMap?: Record<string, string>;
		customEmojiMap?: CustomEmojiMap;
		/** What a reply's quoted call notice says, when the list around it has the notice (a thread does). */
		quotedCall?: CallNoticeLine | null;
		onPreview: (src: string, alt?: string) => void;
	} = $props();

	// The user's membership of the conversation (their member_id), minted as they joined it: a call notice from before
	// doesn't say they missed the call.
	const joined = $derived(members.find((m) => m.id === $currentUser?.id)?.member_id);
	const callLine = $derived(callNoticeLine(message, $currentUser?.id, joined));
	const author = $derived(members.find((m) => m.id === message.author_id));
	const text = $derived(message.content ?? "");

	// The content shows six lines; Show more shows the rest. clamped says whether the six hide some of it,
	// measured once the content is laid out, and again when it or its width changes.
	let contentEl = $state<HTMLElement | null>(null);
	let expanded = $state(false);
	let clamped = $state(false);
	$effect(() => {
		if (!contentEl || !text || expanded) return;
		const el = contentEl;
		const measure = () => (clamped = el.scrollHeight > el.clientHeight + 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});

	// Its reactions, kept up with the ones that come and go while it shows: what lists it read it once.
	let changed = $state.raw<{ of: Message; reactions: MessageReaction[] } | null>(null);
	const reactions = $derived(changed?.of === message ? changed.reactions : (message.reactions ?? []));
	onMount(() =>
		onReactionChange((change) => {
			if (change.message_id === message.id) changed = { of: message, reactions: withReaction(reactions, change) };
		}),
	);

	function toggle(reaction: MessageReaction) {
		const me = $currentUser?.id;
		if (!me) return;
		const { emoji_name, emoji_id } = reaction;
		void toggleReaction({ spaceId, channelId }, { id: message.id, reactions }, me, emoji_name, emoji_id);
	}
</script>

{#if roomName !== null}
	<div class="text-xxs text-duvet-ink2 flex items-center gap-0.5 font-semibold">
		<HashIcon class="size-3" />
		{roomName}
	</div>
{/if}
<!-- A room's mention opens the room; the search result or pin around it doesn't take the click too. A code block's
     button copies its code, which the keyboard reaches as a button. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="flex flex-col" onclickcapture={openRoomMention} onclick={copyCode}>
	<MessageReference {message} {quotedCall} {mentionMap} {customEmojiMap} {spaceId} {channelId} />
	<div class="flex items-start gap-2.5">
		<div class="mt-0.5 shrink-0">
			<UserAvatar src={message.author_avatar_url} name={message.author_name} size={32} />
		</div>
		<div class="flex min-w-0 flex-1 flex-col">
			<div class="flex items-baseline gap-1.5">
				<span class="text-duvet-ink truncate text-sm font-semibold" style={author ? nameColor(author) : ""}
					>{message.author_name}</span
				>
				<AuthorTag {message} />
				<span class="text-duvet-ink2 shrink-0 text-[11px] tabular-nums">{formatShortDateTime(message.created_at)}</span>
			</div>
			{#if callLine}
				<p class="text-duvet-ink2 flex items-center gap-1.5 text-sm">
					<PhoneIcon class="size-4 shrink-0 {callLine.missed ? 'text-duvet-danger' : 'text-duvet-ink2'}" />
					{callNoticeText(callLine)}
				</p>
			{/if}
			{#if message.type === MessageType.Voice || message.sticker_attachment_id}
				<MessageAttachments {message} channelName={roomName ?? ""} {onPreview} maxWidth={320} maxHeight={240} />
			{:else if isLoading(message)}
				<DeferredResponse {message} />
			{:else if isComponentsV2(message)}
				<!-- The components are all of it: its files show where they place them -->
				<MessageComponents components={message.components ?? []} {mentionMap} {customEmojiMap} {onPreview} compact />
			{:else}
				{#if text && !previewReplacesText(message)}
					<div
						bind:this={contentEl}
						data-search-content
						class="font-content text-duvet-ink text-sm wrap-break-word whitespace-pre-wrap {expanded
							? ''
							: 'line-clamp-6'}"
					>
						<MessageText
							content={text}
							large={largeEmojis(text)}
							{mentionMap}
							{customEmojiMap}
							edited={message.updated_at !== message.created_at ? "edited" : null}
						/>
					</div>
					{#if clamped}
						<button
							type="button"
							class="text-duvet-ink2 hover:text-duvet-ink mt-0.5 self-start text-xs font-medium hover:underline"
							onclick={() => (expanded = !expanded)}
						>
							{expanded ? "Show less" : "Show more"}
						</button>
					{/if}
				{/if}
				<MessageCards content={text} embeds={message.embeds} onPreview={(src) => onPreview(src)} compact />
				<MessageAttachments {message} channelName={roomName ?? ""} {onPreview} maxWidth={320} maxHeight={240} />
				{#if message.components?.length}
					<MessageComponents components={message.components} {mentionMap} {customEmojiMap} {onPreview} compact />
				{/if}
			{/if}
			<MessageReactions
				{reactions}
				{customEmojiMap}
				onToggle={toggle}
				onShowReactors={(r) =>
					reactorsRequest.set({ messageId: message.id, reactions, picked: r.emoji_name, members, customEmojiMap })}
			/>
		</div>
	</div>
</div>
