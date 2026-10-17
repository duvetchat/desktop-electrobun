<script lang="ts">
	import { conversations, currentUser, unreadConversations } from "$lib/stores.svelte";
	import { get } from "svelte/store";
	import { UsersRound } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import UserStatusBar from "$lib/components/UserStatusBar.svelte";
	import type { Conversation } from "$lib/api/conversations";
	import { getAvatarURL } from "$lib/common/common";

	let {
		activeConversationId = null,
		onSelect,
		onNewGroup,
	}: {
		activeConversationId?: string | null;
		onSelect: (id: string) => void;
		onNewGroup?: () => void;
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
</script>

<div
	class="flex h-full w-60 shrink-0 flex-col overflow-hidden border-r border-stone-800 bg-[linear-gradient(180deg,oklch(0.215_0.01_80),oklch(0.185_0.008_80))] text-stone-100/90"
>
	<div class="flex h-10 shrink-0 items-center justify-between border-b border-stone-800 px-3">
		<span class="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Direct Messages</span>
		{#if onNewGroup}
			<button
				class="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-stone-800 hover:text-zinc-200"
				onclick={onNewGroup}
				title="New group"
			>
				<UsersRound class="size-3.5" />
			</button>
		{/if}
	</div>

	<div class="flex-1 overflow-y-auto py-1">
		{#each $conversations as conv (conv.id)}
			<button
				class="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors
					{activeConversationId === conv.id
					? 'bg-stone-700/60 text-stone-100'
					: 'text-stone-400 hover:bg-stone-800/60 hover:text-stone-200'}"
				onclick={() => onSelect(conv.id)}
			>
				<div class="shrink-0">
					<UserAvatar src={convAvatarSrc(conv)} name={convTitle(conv)} size={32} />
				</div>
				<div class="flex min-w-0 flex-1 flex-col">
					<span class="truncate text-sm leading-tight font-medium">{convTitle(conv)}</span>
					<span class="truncate text-xs opacity-50">{convSubtitle(conv)}</span>
				</div>
				{#if $unreadConversations.has(conv.id)}
					<span class="ml-1 size-2 shrink-0 rounded-full bg-white"></span>
				{/if}
			</button>
		{/each}
	</div>

	<UserStatusBar />
</div>
