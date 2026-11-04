<script lang="ts">
	import { conversations, currentUser, unreadConversations } from "$lib/stores.svelte";
	import { get } from "svelte/store";
	import { UsersRound } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import UserStatusBar from "$lib/components/UserStatusBar.svelte";
	import type { Conversation } from "$lib/api/conversations";
	import { getAvatarURL } from "$lib/common/common";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import { getUserMobileOnly, getUserOnlineStatus } from "$lib/api/ws/connection";
	import { userStatusToString, type MemberOnSidebar } from "$lib/types";
	import { conversationTab, tabDragData } from "$lib/pane";

	let {
		activeConversationId = null,
		onSelect,
		onNewGroup,
		embedded = false,
	}: {
		activeConversationId?: string | null;
		onSelect: (id: string) => void;
		onNewGroup?: () => void;
		/** Drawn as a tree under the Direct messages row of the spaces column, which has the user's bar: only the
		 * conversations show, without a column of their own. */
		embedded?: boolean;
	} = $props();

	function convTitle(conv: Conversation): string {
		const me = get(currentUser);
		if (conv.type === 2) return conv.name ?? "Group";
		const other = conv.members.find((m) => m.user_id !== me?.id);
		return other?.user?.alias ?? other?.user?.username ?? "DM";
	}

	function convSubtitle(conv: Conversation): string {
		if (conv.type === 2) return `${conv.members.length} members`;
		return "Direct message";
	}

	function convAvatarSrc(conv: Conversation): string | null | undefined {
		if (conv.type === 2) return null;
		const me = get(currentUser);
		const other = conv.members.find((m) => m.user_id !== me?.id);
		return getAvatarURL(other?.user_id ?? "", other?.user?.avatar);
	}

	// The other member's status, in a DM (a group has none), offline included, as the member list shows it, and whether
	// they're connected only from the mobile app. Statuses come through spaces, friendships and conversations, so someone
	// who is neither our friend nor in a space with us shows theirs too.
	function convStatus(conv: Conversation): { status: MemberOnSidebar["status"]; mobileOnly: boolean } | null {
		if (conv.type === 2) return null;
		const other = conv.members.find((m) => m.user_id !== get(currentUser)?.id);
		if (!other) return { status: "offline", mobileOnly: false };
		return {
			status: userStatusToString(getUserOnlineStatus(other.user_id)),
			mobileOnly: getUserMobileOnly(other.user_id),
		};
	}
</script>

{#snippet conversationList()}
	{#each $conversations as conv (conv.id)}
		{@const shown = convStatus(conv)}
		{@const unread = $unreadConversations.has(conv.id)}
		<button
			class="focus-visible:outline-duvet-accent flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors focus-visible:outline-2
				{activeConversationId === conv.id
				? 'bg-duvet-accent-tint text-duvet-accent-text'
				: unread
					? 'text-duvet-ink hover:bg-duvet-card'
					: 'text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink'}"
			aria-current={activeConversationId === conv.id ? "true" : undefined}
			data-jump
			onclick={() => onSelect(conv.id)}
			draggable="true"
			ondragstart={(e) => {
				// Dragged onto a pane, it opens there as a tab, or splits it, as a room does.
				e.dataTransfer!.effectAllowed = "copyMove";
				e.dataTransfer!.setData("text/plain", tabDragData(conversationTab(conv, get(currentUser)?.id)));
			}}
		>
			<div class="relative shrink-0">
				<UserAvatar src={convAvatarSrc(conv)} name={convTitle(conv)} size={embedded ? 26 : 32} />
				{#if shown}
					<StatusDot
						status={shown.status}
						mobileOnly={shown.mobileOnly}
						class="text-duvet-sunk absolute -right-0.5 -bottom-0.5 w-3 border-2"
					/>
				{/if}
			</div>
			<div class="flex min-w-0 flex-1 flex-col">
				<span class="truncate text-sm leading-tight {unread ? 'font-bold' : 'font-medium'}">{convTitle(conv)}</span>
				<span class="text-duvet-ink2 truncate text-xs">{convSubtitle(conv)}</span>
			</div>
			{#if unread}
				<span class="bg-duvet-accent ml-1 size-2 shrink-0 rounded-full" aria-label="Unread"></span>
			{/if}
		</button>
	{/each}
{/snippet}

{#if embedded}
	<div
		class="border-duvet-line mb-1 ml-[19px] flex flex-col gap-px border-l-2 py-0.5 pl-2.5"
		role="group"
		aria-label="Conversations"
	>
		{#if onNewGroup}
			<button
				class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink focus-visible:outline-duvet-accent flex h-8 w-full items-center gap-1.5 rounded-[10px] px-2 text-left text-sm transition-colors focus-visible:outline-2"
				onclick={onNewGroup}
			>
				<UsersRound class="size-4" />
				New group
			</button>
		{/if}
		{@render conversationList()}
		{#if $conversations.length === 0}
			<p class="text-duvet-ink2 px-2 py-1.5 text-[13px]">No conversations yet</p>
		{/if}
	</div>
{:else}
	<div
		class="border-duvet-line bg-duvet-sunk text-duvet-ink flex h-full w-60 shrink-0 flex-col overflow-hidden border-r"
	>
		<div class="border-duvet-line flex h-10 shrink-0 items-center justify-between border-b px-3">
			<span class="text-duvet-ink2 text-[13px] font-bold">Direct messages</span>
			{#if onNewGroup}
				<button
					class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors"
					onclick={onNewGroup}
					title="New group"
					aria-label="New group"
				>
					<UsersRound class="size-3.5" />
				</button>
			{/if}
		</div>

		<div class="flex flex-1 flex-col gap-px overflow-y-auto p-1">
			{@render conversationList()}
		</div>

		<UserStatusBar />
	</div>
{/if}
