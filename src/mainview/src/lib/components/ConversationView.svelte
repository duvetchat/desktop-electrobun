<script lang="ts">
import { onMount } from "svelte";
import { get } from "svelte/store";
import { currentUser, dmMessages } from "$lib/stores.svelte";
import {
	getDirectMessages,
	sendDirectMessage,
	updateDirectMessage,
	deleteDirectMessage,
	type Conversation,
	type DirectMessage,
} from "$lib/api/conversations";
import type { Message } from "$lib/types";
import { MessageSquare } from "@lucide/svelte";
import MessageList from "$lib/components/MessageList.svelte";
import ChatInput from "$lib/components/ChatInput.svelte";

let { conversation }: { conversation: Conversation } = $props();

let isLoading = $state(true);
let isLoadingMore = $state(false);
let hasMore = $state(true);
let failedNonces = $state(new Set<string>());
let editingMessageId = $state<string | null>(null);
let editContent = $state("");

const me = $derived(get(currentUser));

// Map DirectMessage → Message for MessageList
function toMessage(msg: DirectMessage): Message {
	const member = conversation.members.find((m) => m.user_id === msg.author_id);
	return {
		id: msg.id,
		content: msg.content,
		author_id: msg.author_id,
		author_name:
			msg.users?.alias ?? msg.users?.username ??
			member?.users?.alias ?? member?.users?.username ??
			msg.author_id.slice(0, 8),
		author_avatar_url: msg.users?.avatar ?? member?.users?.avatar ?? null,
		created_at: msg.created_at,
		updated_at: msg.updated_at,
		nonce: msg.nonce,
	};
}

const messages = $derived(
	($dmMessages[conversation.id] ?? []).map(toMessage),
);

function conversationTitle(): string {
	if (conversation.type === 2) return conversation.name ?? "Grupo";
	const other = conversation.members.find((m) => m.user_id !== me?.id);
	return other?.users?.alias ?? other?.users?.username ?? "DM";
}

async function loadMessages(before?: Date) {
	try {
		const fetched = await getDirectMessages(conversation.id, before);
		hasMore = fetched.length === 100;
		dmMessages.update((all) => {
			const existing = all[conversation.id] ?? [];
			const existingIds = new Set(existing.map((m) => m.id));
			const newMsgs = fetched.filter((m) => !existingIds.has(m.id));
			return { ...all, [conversation.id]: [...newMsgs, ...existing] };
		});
	} catch (err) {
		console.error("[DM] Failed to load messages:", err);
	}
}

async function handleLoadMore() {
	if (isLoadingMore || !hasMore) return;
	isLoadingMore = true;
	const all = get(dmMessages)[conversation.id] ?? [];
	const oldest = all.length > 0 ? new Date(all[0].created_at) : undefined;
	await loadMessages(oldest);
	isLoadingMore = false;
}

function handleSend(content: string) {
	const user = get(currentUser);
	if (!user) return;

	const nonce = crypto.randomUUID();
	const isoNow = new Date().toISOString();
	const pending: DirectMessage = {
		id: nonce,
		room_id: null,
		conversation_id: conversation.id,
		author_id: user.id,
		content,
		created_at: isoNow,
		updated_at: isoNow,
		deleted_at: null,
		nonce,
	};

	dmMessages.update((all) => ({
		...all,
		[conversation.id]: [...(all[conversation.id] ?? []), pending],
	}));

	sendDirectMessage(conversation.id, content, nonce).then((real) => {
		dmMessages.update((all) => {
			const existing = all[conversation.id] ?? [];
			if (!existing.some((m) => m.id === nonce)) return all;
			return {
				...all,
				[conversation.id]: existing
					.filter((m) => m.id !== real.id)
					.map((m) => (m.id === nonce ? real : m)),
			};
		});
	}).catch(() => {
		failedNonces = new Set(failedNonces).add(nonce);
	});
}

async function dmSaveEdit(messageId: string, content: string) {
	const updated = await updateDirectMessage(conversation.id, messageId, content);
	dmMessages.update((all) => {
		const existing = all[conversation.id] ?? [];
		return {
			...all,
			[conversation.id]: existing.map((m) => m.id === messageId ? { ...m, ...updated } : m),
		};
	});
}

async function dmDelete(messageId: string) {
	await deleteDirectMessage(conversation.id, messageId);
	dmMessages.update((all) => ({
		...all,
		[conversation.id]: (all[conversation.id] ?? []).filter((m) => m.id !== messageId),
	}));
}

function dmRetry(message: Message) {
	const nonce = message.nonce!;
	failedNonces = new Set([...failedNonces].filter((n) => n !== nonce));
	sendDirectMessage(conversation.id, message.content, nonce).catch(() => {
		failedNonces = new Set(failedNonces).add(nonce);
	});
}

function dmDismiss(nonce: string) {
	failedNonces = new Set([...failedNonces].filter((n) => n !== nonce));
	dmMessages.update((all) => ({
		...all,
		[conversation.id]: (all[conversation.id] ?? []).filter((m) => m.nonce !== nonce),
	}));
}

function handleArrowUpWhenEmpty() {
	const user = get(currentUser);
	if (!user) return;
	const msgs = get(dmMessages)[conversation.id] ?? [];
	const lastOwn = [...msgs]
		.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
		.find((m) => m.author_id === user.id && m.id !== m.nonce);
	if (lastOwn) {
		editingMessageId = lastOwn.id;
		editContent = lastOwn.content;
	}
}

onMount(async () => {
	await loadMessages();
	isLoading = false;
});
</script>

<div class="flex flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,oklch(0.22_0.01_80),oklch(0.19_0.008_80))]">
	<!-- Header -->
	<div class="flex h-10 shrink-0 items-center gap-2 border-b border-stone-800 bg-stone-950/45 px-3 font-semibold text-stone-100">
		<MessageSquare class="size-4 text-zinc-400" />
		<span>{conversationTitle()}</span>
		{#if conversation.type === 2}
			<span class="ml-1 text-xs text-zinc-500">{conversation.members.length} miembros</span>
		{/if}
	</div>

	<!-- Messages -->
	<MessageList
		{messages}
		isInitialLoading={isLoading}
		{isLoadingMore}
		hasMoreMessages={hasMore}
		onLoadMore={handleLoadMore}
		{failedNonces}
		onRetry={dmRetry}
		onDismiss={dmDismiss}
		onSaveEdit={dmSaveEdit}
		onDeleteMsg={dmDelete}
		bind:editingMessageId
		bind:editContent
	/>

	<!-- Input -->
	<div class="relative flex min-h-16 max-h-48 flex-row items-end gap-2 border-t border-stone-800 bg-stone-950/45 px-3 py-2">
		<ChatInput
			placeholder={`Mensaje a ${conversationTitle()}`}
			onSubmit={handleSend}
			onArrowUpWhenEmpty={handleArrowUpWhenEmpty}
		/>
	</div>
</div>
