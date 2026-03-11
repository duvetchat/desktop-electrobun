<script lang="ts">
import {
	Image as GifIcon,
	Search as MagnifyingGlassIcon,
	Bookmark as BookmarkSimpleIcon,
	Hash as HashIcon,
} from "@lucide/svelte";
import { Popover } from "bits-ui";

import { onMount, onDestroy } from "svelte";
import GifPicker from "$lib/components/GifPicker.svelte";
import ChatInput from "$lib/components/ChatInput.svelte";
import MessageList from "$lib/components/MessageList.svelte";
import type { Message, MemberOnSidebar, GatewaySpace } from "$lib/types";
import { sendMessage } from "$lib/api/messages";
import { currentUser, channelMessages } from "$lib/stores.svelte";

let {
	messages,
	members = [],
	channelName,
	channelId,
	space = null,
	isInitialLoading = false,
	isLoadingMore = false,
	hasMoreMessages = true,
	onLoadMore = () => {},
}: {
	messages: Message[];
	members?: MemberOnSidebar[];
	channelName: string;
	channelId: string;
	space?: GatewaySpace | null;
	isInitialLoading?: boolean;
	isLoadingMore?: boolean;
	hasMoreMessages?: boolean;
	onLoadMore?: () => Promise<void> | void;
} = $props();

let showGifPicker = $state(false);
let failedNonces = $state(new Set<string>());
let editingMessageId = $state<string | null>(null);
let editContent = $state("");
let editMessageIndex = $state<number | null>(null);

$effect(() => {
	if (editingMessageId === null) {
		editMessageIndex = null;
	}
});

function getOwnMessages() {
	const user = $currentUser;
	if (!user) return [];
	return [...($channelMessages[channelId] ?? [])]
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

	if (isOtherInputActive()) return;
}

onMount(() => window.addEventListener("keydown", handleGlobalKeyDown));
onDestroy(() => {
	if (typeof window === "undefined") return;
	window.removeEventListener("keydown", handleGlobalKeyDown);
});

function handleSendMessage(content: string) {
	const nonce = crypto.randomUUID();
	const user = $currentUser;
	if (!user) return;

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
	} as any;

	channelMessages.update((all) => ({
		...all,
		[channelId]: [...(all[channelId] ?? []), pendingMessage],
	}));

	sendMessage(channelId, content, nonce).catch(() => {
		failedNonces = new Set(failedNonces).add(nonce);
	});
}

function retryMessage(message: Message) {
	const nonce = message.nonce!;
	const newSet = new Set(failedNonces);
	newSet.delete(nonce);
	failedNonces = newSet;
	sendMessage(channelId, message.content, nonce).catch(() => {
		failedNonces = new Set(failedNonces).add(nonce);
	});
}

function dismissFailedMessage(nonce: string) {
	const newSet = new Set(failedNonces);
	newSet.delete(nonce);
	failedNonces = newSet;
	channelMessages.update((all) => ({
		...all,
		[channelId]: (all[channelId] ?? []).filter((m) => m.nonce !== nonce),
	}));
}

function handleGifSelect(url: string) {
	showGifPicker = false;
	const nonce = crypto.randomUUID();
	const user = $currentUser;
	if (!user) return;
	const isoNow = new Date().toISOString();
	channelMessages.update((all) => ({
		...all,
		[channelId]: [
			...(all[channelId] ?? []),
			{
				id: nonce,
				content: url,
				author_id: user.id,
				author_name: user.alias ?? user.username,
				author_avatar_url: user.avatar ?? null,
				created_at: isoNow,
				updated_at: isoNow,
				nonce,
			} as any,
		],
	}));
	sendMessage(channelId, url, nonce).catch(console.error);
}

onMount(() => {
	// ChatInput handles its own focus
});
</script>

<div class="flex flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,oklch(0.22_0.01_80),oklch(0.19_0.008_80))]">
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

  <MessageList
    {messages}
    {members}
    {channelId}
    {space}
    {isInitialLoading}
    {isLoadingMore}
    {hasMoreMessages}
    {onLoadMore}
    {failedNonces}
    bind:editingMessageId
    bind:editContent
    onRetry={retryMessage}
    onDismiss={dismissFailedMessage}
  />

	<div class="relative w-full">
		<div
			class="absolute bottom-0 z-10 h-5 w-full bg-linear-to-t from-stone-950/45 to-transparent pointer-events-none"
		></div>
  </div>
  <!-- Bottom input bar -->
  <div
		class="relative flex min-h-16 max-h-48 flex-row items-end gap-2 border-t border-stone-800 bg-stone-950/45 px-3 py-2"
	>
    <!-- ChatInput: contenteditable with emoji rendering + autocomplete + emoji picker -->
    <ChatInput
      placeholder={`Message #${channelName}`}
      onSubmit={handleSendMessage}
      onArrowUpWhenEmpty={tryEditLastMessage}
    />

    <!-- GIF picker button -->
		<Popover.Root bind:open={showGifPicker}>
			<Popover.Trigger
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-stone-700 bg-stone-900/70 text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100 outline-none"
				title="Open GIF picker"
				aria-label="Open GIF picker"
			>
				<GifIcon class="size-5" />
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					side="top"
					align="end"
					sideOffset={10}
					class="z-80"
				>
					<GifPicker onSelect={handleGifSelect} />
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
  </div>
</div>
