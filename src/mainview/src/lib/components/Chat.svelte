<script lang="ts">
import {
	Search as MagnifyingGlassIcon,
	Bookmark as BookmarkSimpleIcon,
	Hash as HashIcon,
} from "@lucide/svelte";

import { onMount, onDestroy } from "svelte";
import ChatInput from "$lib/components/ChatInput.svelte";
import MessageList from "$lib/components/MessageList.svelte";
import type { Message, MemberOnSidebar, GatewaySpace, MessageReference } from "$lib/types";
import { MessageReferenceType } from "$lib/types";
import { sendMessage, sendTypingIndicator } from "$lib/api/messages";
import { currentUser, channelMessages, typingUsers } from "$lib/stores.svelte";
import TypingIndicator from "$lib/components/TypingIndicator.svelte";

let {
	messages,
	members = [],
	channelName,
	channelId,
	spaceId = "",
	space = null,
	isInitialLoading = false,
	isLoadingMore = false,
	isLoadingMoreBelow = false,
	hasMoreMessages = true,
	hasMoreMessagesBelow = false,
	highlightedMessageId = null,
	unreadAfterMessageId = null,
	onLoadMore = () => {},
	onLoadMoreBelow = () => {},
	showHeader = true,
	placeholder = undefined,
	failedNonces = $bindable(new Set<string>()),
	isAtBottom = $bindable(true),
	onSend = undefined,
	onSaveEdit = undefined,
	onDeleteMsg = undefined,
	onRetry = undefined,
	onDismiss = undefined,
	sendTyping = undefined,
}: {
	messages: Message[];
	members?: MemberOnSidebar[];
	channelName: string;
	channelId: string;
	spaceId?: string;
	space?: GatewaySpace | null;
	isInitialLoading?: boolean;
	isLoadingMore?: boolean;
	isLoadingMoreBelow?: boolean;
	hasMoreMessages?: boolean;
	hasMoreMessagesBelow?: boolean;
	highlightedMessageId?: string | null;
	unreadAfterMessageId?: string | null;
	onLoadMore?: () => Promise<void> | void;
	onLoadMoreBelow?: () => Promise<void> | void;
	showHeader?: boolean;
	placeholder?: string;
	failedNonces?: Set<string>;
	isAtBottom?: boolean;
	onSend?: (content: string, nonce: string, ref: MessageReference | undefined) => Promise<void>;
	onSaveEdit?: (msgId: string, content: string) => void | Promise<void>;
	onDeleteMsg?: (msgId: string) => Promise<void>;
	onRetry?: (message: Message) => void;
	onDismiss?: (nonce: string) => void;
	sendTyping?: () => void;
} = $props();
let replyTo = $state<Message | null>(null);
let chatInputRef = $state<{ focus: () => void } | null>(null);
let lastTypingSent = 0;
let editingMessageId = $state<string | null>(null);
let editContent = $state("");
let editMessageIndex = $state<number | null>(null);
let replyMessageIndex = $state<number | null>(null);

$effect(() => {
	if (editingMessageId === null) {
		editMessageIndex = null;
	}
});

$effect(() => {
	if (replyTo === null) {
		replyMessageIndex = null;
	}
});

function getOwnMessages() {
	const user = $currentUser;
	if (!user) return [];
	return [...messages]
		.filter((m) => m.author_id === user.id && !failedNonces.has(m.nonce ?? ""))
		.sort(
			(a, b) =>
				new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
		);
}

function tryEditAtIndex(index: number) {
	const msgs = getOwnMessages();
	if (index < 0 || index >= msgs.length) return false;
	editMessageIndex = index;
	editingMessageId = msgs[index].id;
	editContent = msgs[index].content;
	return true;
}

function tryEditLastMessage() {
	tryEditAtIndex(0);
}

function getAllMessages() {
	return [...messages].sort(
		(a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
	);
}

function tryReplyAtIndex(index: number) {
	const msgs = getAllMessages();
	if (index < 0 || index >= msgs.length) return false;
	replyMessageIndex = index;
	replyTo = msgs[index];
	return true;
}

function isOtherInputActive() {
	const active = document.activeElement;
	return (
		active &&
		(active as HTMLElement).dataset?.chatinput !== "true" &&
		(active.tagName === "INPUT" ||
			active.tagName === "TEXTAREA" ||
			(active as HTMLElement).isContentEditable)
	);
}

function handleGlobalKeyDown(event: KeyboardEvent) {
	const isCtrlShiftUp =
		event.ctrlKey && event.shiftKey && event.key === "ArrowUp";
	const isCtrlShiftDown =
		event.ctrlKey && event.shiftKey && event.key === "ArrowDown";

	if (isCtrlShiftUp) {
		event.preventDefault();
		const nextIndex = editMessageIndex === null ? 0 : editMessageIndex + 1;
		tryEditAtIndex(nextIndex);
		return;
	}

	if (isCtrlShiftDown) {
		event.preventDefault();
		if (editMessageIndex === null) return;
		if (editMessageIndex === 0) {
			editingMessageId = null;
			editContent = "";
			editMessageIndex = null;
		} else {
			tryEditAtIndex(editMessageIndex - 1);
		}
		return;
	}

	const isCtrlUp = event.ctrlKey && !event.shiftKey && event.key === "ArrowUp";
	const isCtrlDown = event.ctrlKey && !event.shiftKey && event.key === "ArrowDown";

	if (isCtrlUp) {
		event.preventDefault();
		const nextIndex = replyMessageIndex === null ? 0 : replyMessageIndex + 1;
		tryReplyAtIndex(nextIndex);
		return;
	}

	if (isCtrlDown) {
		event.preventDefault();
		if (replyMessageIndex === null) return;
		if (replyMessageIndex === 0) {
			replyTo = null;
		} else {
			tryReplyAtIndex(replyMessageIndex - 1);
		}
		return;
	}

	if (isOtherInputActive()) return;
}

onMount(() => window.addEventListener("keydown", handleGlobalKeyDown));
onDestroy(() => {
	if (typeof window === "undefined") return;
	window.removeEventListener("keydown", handleGlobalKeyDown);
});

async function handleSendMessage(content: string) {
	const nonce = crypto.randomUUID();
	const user = $currentUser;
	if (!user) return;

	const ref = replyTo ? {
		type: MessageReferenceType.Reply,
		message_id: replyTo.id,
		room_id: channelId,
	} as MessageReference : undefined;

	replyTo = null;

	if (onSend) {
		try { await onSend(content, nonce, ref); }
		catch { failedNonces = new Set(failedNonces).add(nonce); }
		return;
	}

	const isoNow = new Date().toISOString();
	const pendingMessage = {
		id: nonce,
		content,
		author_id: user.id,
		author_name: user.alias ?? user.username,
		author_avatar_url: user.avatar ?? null,
		created_at: isoNow,
		updated_at: isoNow,
		nonce,
		...(ref ? {
			referenced_message: {
				id: ref.message_id,
				content: messages.find(m => m.id === ref.message_id)?.content ?? "",
				author_id: messages.find(m => m.id === ref.message_id)?.author_id ?? "",
				author_name: messages.find(m => m.id === ref.message_id)?.author_name ?? "",
				author_avatar: messages.find(m => m.id === ref.message_id)?.author_avatar_url ?? null,
				created_at: messages.find(m => m.id === ref.message_id)?.created_at ?? isoNow,
			}
		} : {}),
	} as any;

	channelMessages.update((all) => ({
		...all,
		[channelId]: [...(all[channelId] ?? []), pendingMessage],
	}));

	sendMessage(channelId, content, nonce, ref).catch(() => {
		failedNonces = new Set(failedNonces).add(nonce);
	});
}

function handleReply(message: Message) {
	replyTo = message;
	chatInputRef?.focus();
}

function retryMessage(message: Message) {
	if (onRetry) { onRetry(message); return; }
	const nonce = message.nonce!;
	const newSet = new Set(failedNonces);
	newSet.delete(nonce);
	failedNonces = newSet;
	sendMessage(channelId, message.content, nonce).catch(() => {
		failedNonces = new Set(failedNonces).add(nonce);
	});
}

function handleTyping(text: string) {
	if (!text) return;
	const now = Date.now();
	const user = $currentUser;
	if (user) {
		typingUsers.update((all) => {
			const filtered = (all[channelId] ?? []).filter((u) => u.user_id !== user.id);
			return { ...all, [channelId]: [...filtered, { user_id: user.id, username: user.username, alias: user.alias ?? null, avatar: user.avatar ?? null, timestamp: now }] };
		});
	}
	if (now - lastTypingSent < 3000) return;
	lastTypingSent = now;
	if (sendTyping) { sendTyping(); return; }
	sendTypingIndicator(channelId);
}

function dismissFailedMessage(nonce: string) {
	if (onDismiss) { onDismiss(nonce); return; }
	const newSet = new Set(failedNonces);
	newSet.delete(nonce);
	failedNonces = newSet;
	channelMessages.update((all) => ({
		...all,
		[channelId]: (all[channelId] ?? []).filter((m) => m.nonce !== nonce),
	}));
}

</script>

<div class="flex flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,oklch(0.22_0.01_80),oklch(0.19_0.008_80))]">
  {#if showHeader}
	<div
	class="flex h-10 shrink-0 items-center justify-between border-b border-stone-800 bg-stone-950/45 px-3 font-semibold text-stone-100"
	>
    <div class="flex flex-row gap-2 items-center">
      <HashIcon class="size-5 text-zinc-400" />
      {channelName}
    </div>
    <div class="flex flex-row gap-3 items-center">
		<BookmarkSimpleIcon
			class="size-4 text-zinc-400 duration-100 hover:scale-[1.05] active:scale-[0.95] hover:text-zinc-200"
		/>
	  <div class="relative flex h-8 w-48 items-center rounded-lg border border-stone-800/90 bg-stone-900/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors focus-within:border-stone-600/80 focus-within:bg-stone-900/65">
		<MagnifyingGlassIcon
	            class="absolute left-2.5 size-3.5 text-stone-500"
			/>
        <input
          placeholder="Search messages"
		  class="h-full w-full border-none bg-transparent pl-8 pr-2.5 text-xs font-medium text-stone-100 placeholder:text-stone-500/90 focus:outline-none focus:ring-0"
        />
      </div>
    </div>
  </div>
  {/if}

  <MessageList
    {messages}
    {members}
    {channelId}
    {spaceId}
    {space}
    {isInitialLoading}
    {isLoadingMore}
    {isLoadingMoreBelow}
    {hasMoreMessages}
    {hasMoreMessagesBelow}
    highlightedMessageId={replyTo?.id ?? highlightedMessageId}
    {unreadAfterMessageId}
    {onLoadMore}
    {onLoadMoreBelow}
    {failedNonces}
    bind:isAtBottom
    {onSaveEdit}
    {onDeleteMsg}
    bind:editingMessageId
    bind:editContent
    onRetry={retryMessage}
    onDismiss={dismissFailedMessage}
    onReply={handleReply}
  />

	<div class="relative w-full">
		<div
			class="absolute bottom-0 z-10 h-5 w-full bg-linear-to-t from-stone-950/45 to-transparent pointer-events-none"
		></div>
  </div>
  <!-- Typing indicator -->
  <TypingIndicator channelId={channelId} />
  <!-- Bottom input bar -->
  <div
		class="relative flex min-h-16 max-h-48 flex-row items-end gap-2 border-t border-stone-800 bg-stone-950/45 px-3 py-2"
	>
    {#if replyTo}
        <div class="absolute bottom-full left-0 right-0 flex items-center justify-between bg-stone-900/90 border-t border-stone-800 px-3 py-1.5 text-xs text-zinc-400">
            <span>Replying to <span class="font-semibold text-zinc-200">{replyTo.author_name}</span></span>
            <button
                class="text-zinc-500 hover:text-zinc-300 transition-colors"
                onclick={() => { replyTo = null; }}
                aria-label="Cancel reply"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
        </div>
    {/if}
    <ChatInput
      bind:this={chatInputRef}
      placeholder={placeholder ?? `Message #${channelName}`}
      onSubmit={handleSendMessage}
      onArrowUpWhenEmpty={tryEditLastMessage}
      onValueChange={handleTyping}
    />
  </div>
</div>
