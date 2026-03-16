<script lang="ts">
import { onMount } from "svelte";
import { get } from "svelte/store";
import { currentUser, dmMessages, friends } from "$lib/stores.svelte";
import {
	getDirectMessages,
	sendDirectMessage,
	sendConversationTyping,
	updateDirectMessage,
	deleteDirectMessage,
	addConversationMember,
	removeConversationMember,
	type Conversation,
	type ConversationMember,
	type DirectMessage,
} from "$lib/api/conversations";
import { getUser, type Friend, type UserPublic } from "$lib/api/friends";
import type { Message, MessageReference } from "$lib/types";
import { MessageSquare, UserPlus, Users } from "@lucide/svelte";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import Chat from "$lib/components/Chat.svelte";
import GuildMemberSidebar from "$lib/components/GuildMemberSidebar.svelte";
import type { MemberOnSidebar } from "$lib/types";

let { conversation, onMemberAdded = undefined }: {
	conversation: Conversation;
	onMemberAdded?: (member: ConversationMember) => void;
} = $props();

let isLoading = $state(true);
let isLoadingMore = $state(false);
let hasMore = $state(true);
let failedNonces = $state(new Set<string>());
let showMemberList = $state(true);
let showAddMemberModal = $state(false);
let addMemberLoading = $state(false);
let addMemberError = $state("");
let eligibleFriends = $state<Friend[]>([]);
let friendUserMap = $state(new Map<string, UserPublic>());

const me = $derived(get(currentUser));
const isOwner = $derived(me?.id === conversation.owner_id);

const convMembers = $derived<MemberOnSidebar[]>(
	conversation.members.map((m) => ({
		id: m.user_id,
		member_id: m.id,
		username: m.users?.alias ?? m.users?.username ?? m.user_id.slice(0, 8),
		raw_username: m.users?.username ?? m.user_id.slice(0, 8),
		avatar_url: m.users?.avatar ?? null,
		banner_url: m.users?.banner ?? null,
		status: m.users?.status_id === 1 ? "online" : m.users?.status_id === 2 ? "dnd" : "offline",
		is_bot: false,
		is_owner: m.user_id === conversation.owner_id,
		roles: [],
	})),
);

function getFriendOtherId(friend: Friend): string {
	const user = get(currentUser);
	return friend.sender_id === user?.id ? friend.recipient_id : friend.sender_id;
}

async function openAddMemberModal() {
	const memberIds = new Set(conversation.members.map((m) => m.user_id));
	eligibleFriends = get(friends).filter((f) => !memberIds.has(getFriendOtherId(f)));
	showAddMemberModal = true;
	addMemberError = "";

	const ids = eligibleFriends.map(getFriendOtherId).filter((id) => !friendUserMap.has(id));
	const results = await Promise.allSettled(
		ids.map(async (id) => {
			const user = await getUser(id);
			return [id, user] as const;
		}),
	);
	const newMap = new Map(friendUserMap);
	for (const r of results) {
		if (r.status === "fulfilled") newMap.set(r.value[0], r.value[1]);
	}
	friendUserMap = newMap;
}

async function handleAddMember(userId: string) {
	addMemberLoading = true;
	addMemberError = "";
	try {
		const newMember = await addConversationMember(conversation.id, userId);
		onMemberAdded?.(newMember);
		showAddMemberModal = false;
	} catch (err) {
		addMemberError = err instanceof Error ? err.message : "Failed to add member";
	} finally {
		addMemberLoading = false;
	}
}

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
	if (conversation.type === 2) return conversation.name ?? "Group";
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

async function dmHandleSend(content: string, nonce: string, _ref: MessageReference | undefined) {
	const user = get(currentUser);
	if (!user) return;
	const isoNow = new Date().toISOString();
	const pending: DirectMessage = {
		id: nonce, room_id: null, conversation_id: conversation.id,
		author_id: user.id, content,
		created_at: isoNow, updated_at: isoNow, deleted_at: null, nonce,
	};
	dmMessages.update((all) => ({ ...all, [conversation.id]: [...(all[conversation.id] ?? []), pending] }));
	const real = await sendDirectMessage(conversation.id, content, nonce);
	dmMessages.update((all) => {
		const existing = all[conversation.id] ?? [];
		if (!existing.some((m) => m.id === nonce)) return all;
		return { ...all, [conversation.id]: existing.filter((m) => m.id !== real.id).map((m) => m.id === nonce ? real : m) };
	});
}

async function dmSaveEdit(messageId: string, content: string) {
	const updated = await updateDirectMessage(conversation.id, messageId, content);
	dmMessages.update((all) => {
		const existing = all[conversation.id] ?? [];
		return { ...all, [conversation.id]: existing.map((m) => m.id === messageId ? { ...m, ...updated } : m) };
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

async function handleRemoveMember(userId: string) {
	await removeConversationMember(conversation.id, userId);
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
			<span class="ml-1 text-xs text-zinc-500">{conversation.members.length} members</span>
		{/if}
		<div class="ml-auto flex items-center gap-1">
			{#if conversation.type === 2 && isOwner}
				<button
					class="flex items-center gap-1 rounded px-2 py-1 text-xs font-normal text-zinc-400 hover:bg-stone-800 hover:text-zinc-200"
					onclick={openAddMemberModal}
					title="Add member"
				>
					<UserPlus class="size-3.5" />
					Add
				</button>
			{/if}
			{#if conversation.type === 2}
				<button
					class="flex items-center gap-1 rounded px-2 py-1 text-xs font-normal {showMemberList ? 'bg-stone-800 text-zinc-200' : 'text-zinc-400 hover:bg-stone-800 hover:text-zinc-200'}"
					onclick={() => { showMemberList = !showMemberList; }}
					title="Members"
				>
					<Users class="size-3.5" />
				</button>
			{/if}
		</div>
	</div>

	<!-- Body: messages + optional member sidebar -->
	<div class="flex flex-1 overflow-hidden">
		<Chat
			showHeader={false}
			{messages}
			channelId={conversation.id}
			channelName={conversationTitle()}
			placeholder={`Message ${conversationTitle()}`}
			isInitialLoading={isLoading}
			{isLoadingMore}
			hasMoreMessages={hasMore}
			onLoadMore={handleLoadMore}
			bind:failedNonces
			onSend={dmHandleSend}
			onSaveEdit={dmSaveEdit}
			onDeleteMsg={dmDelete}
			onRetry={dmRetry}
			onDismiss={dmDismiss}
			sendTyping={() => sendConversationTyping(conversation.id).catch(() => {})}
		/>

		<!-- Member list sidebar -->
		{#if conversation.type === 2 && showMemberList}
			<GuildMemberSidebar
				overrideMembers={convMembers}
				channelId={conversation.id}
				onRemoveMember={isOwner ? handleRemoveMember : undefined}
			/>
		{/if}
	</div>
</div>

{#if showAddMemberModal}
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
	role="button"
	tabindex="-1"
	onclick={() => { showAddMemberModal = false; }}
	onkeydown={() => {}}
>
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="flex w-80 flex-col gap-3 rounded-lg border border-stone-700 bg-stone-900 p-6"
		role="dialog"
		onclick={(e) => e.stopPropagation()}
		onkeydown={() => {}}
	>
		<h3 class="text-sm font-semibold text-stone-100">Add member</h3>
		{#if eligibleFriends.length === 0}
			<p class="py-4 text-center text-xs text-zinc-500">No friends available to add</p>
		{:else}
			<div class="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
				{#each eligibleFriends as friend (friend.id)}
					{@const uid = getFriendOtherId(friend)}
					{@const user = friendUserMap.get(uid)}
					<button
						class="flex items-center gap-2 rounded px-3 py-2 text-left hover:bg-stone-800 disabled:opacity-50"
						onclick={() => handleAddMember(uid)}
						disabled={addMemberLoading}
					>
						<UserAvatar
							src={user?.avatar ?? null}
							name={user?.alias ?? user?.username ?? "?"}
							size={32}
						/>
						<div class="flex flex-col min-w-0">
							<span class="text-sm text-stone-200">{user?.alias ?? user?.username ?? uid}</span>
							<span class="text-xs text-zinc-500">@{user?.username ?? uid}</span>
						</div>
					</button>
				{/each}
			</div>
		{/if}
		{#if addMemberError}
			<p class="rounded bg-red-900/20 px-3 py-2 text-xs text-red-400">{addMemberError}</p>
		{/if}
		<button
			class="self-end text-xs text-zinc-500 hover:text-zinc-300"
			onclick={() => { showAddMemberModal = false; }}
		>
			Cancel
		</button>
	</div>
</div>
{/if}
