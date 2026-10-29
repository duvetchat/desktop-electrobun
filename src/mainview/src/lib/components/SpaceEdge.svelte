<script lang="ts">
	import { AtSign as AtSignIcon } from "@lucide/svelte";
	import mascot from "$lib/assets/icon.svg";
	import {
		conversations,
		currentUser,
		mentionCounts,
		pendingFriendRequests,
		unreadChannels,
		unreadConversations,
	} from "$lib/stores.svelte";
	import { groupSpaces, spaceNews, type OpenChats } from "$lib/nav";
	import { tabNews, tabTitle } from "$lib/pane";
	import { navPrefs } from "$lib/nav-prefs.svelte";
	import type { Guild } from "$lib/types";
	import SpaceIcon from "$lib/components/SpaceIcon.svelte";
	import TabIcon from "$lib/components/TabIcon.svelte";
	import UserStatusBar from "$lib/components/UserStatusBar.svelte";

	/** The spaces column folded to an edge: Direct messages, the focused pane's open chats, the pinned spaces and those
	 * with news, and the user. Hovering it, or moving the keyboard's focus into it, shows the whole column over the chat. */
	let {
		guilds,
		selectedSpaceId = null,
		isFriendsActive = false,
		openChats,
		onSpaceSelect,
		onFriendsSelect,
	}: {
		guilds: Guild[];
		selectedSpaceId?: string | null;
		isFriendsActive?: boolean;
		openChats: OpenChats;
		onSpaceSelect: (spaceId: string) => void;
		onFriendsSelect: () => void;
	} = $props();

	const newsBySpace = $derived(
		new Map(guilds.map((g) => [g.id, spaceNews(g.channels, $unreadChannels, $mentionCounts)])),
	);
	const shownSpaces = $derived.by(() => {
		const groups = groupSpaces(
			guilds.map((g) => g.id),
			navPrefs.pinned,
			[],
			(id) => newsBySpace.get(id)?.unread ?? false,
		);
		const ids = [...groups.pinned, ...groups.news];
		// The selected space shows too, wherever it is in the column.
		if (selectedSpaceId && !ids.includes(selectedSpaceId)) ids.push(selectedSpaceId);
		return ids.map((id) => guilds.find((g) => g.id === id)).filter((g): g is Guild => !!g);
	});
	const dmNews = $derived($pendingFriendRequests.length + $unreadConversations.size > 0);

	const iconFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-duvet-accent";
</script>

{#snippet pip()}
	<span class="border-duvet-sunk bg-duvet-accent absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2"></span>
{/snippet}

<div class="bg-duvet-sunk relative z-10 flex h-full w-[60px] flex-col items-center pt-3">
	<img src={mascot} alt="" class="mb-2 size-8 shrink-0 select-none" draggable="false" />
	<button
		type="button"
		class="rounded-row shadow-duvet-raised relative flex size-9 shrink-0 items-center justify-center {isFriendsActive
			? 'bg-duvet-chosen text-duvet-chosen-ink'
			: 'bg-duvet-card text-duvet-ink'} {iconFocus}"
		aria-label="Direct messages"
		aria-pressed={isFriendsActive}
		onclick={onFriendsSelect}
	>
		<AtSignIcon class="size-4" />
		{#if dmNews}{@render pip()}{/if}
	</button>

	<div
		class="mt-2 flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
	>
		{#if openChats.tabs.length}
			<div class="bg-duvet-line h-0.5 w-6 shrink-0 rounded-full"></div>
			{#each openChats.tabs as tab (tab.channelId)}
				{@const isActive = tab.channelId === openChats.activeChannelId && !isFriendsActive}
				{@const unread = !isActive && tabNews(tab, $unreadChannels, $unreadConversations, $mentionCounts).unread}
				{@const title = tabTitle(tab, $conversations, $currentUser?.id)}
				<button
					type="button"
					class="rounded-row relative flex size-9 shrink-0 items-center justify-center {isActive
						? 'bg-duvet-chosen text-duvet-chosen-ink shadow-duvet-raised'
						: 'bg-duvet-card shadow-duvet-raised'} {iconFocus}"
					aria-label={title}
					aria-current={isActive ? "true" : undefined}
					{title}
					onclick={() => openChats.onActivate(tab.channelId)}
				>
					<TabIcon {tab} size={16} />
					{#if unread}{@render pip()}{/if}
				</button>
			{/each}
		{/if}

		{#if shownSpaces.length}
			<div class="bg-duvet-line h-0.5 w-6 shrink-0 rounded-full"></div>
			{#each shownSpaces as guild (guild.id)}
				{@const isSelected = guild.id === selectedSpaceId && !isFriendsActive}
				<button
					type="button"
					class="relative shrink-0 rounded-[9px] {isSelected
						? 'outline-duvet-ink outline-2 outline-offset-2'
						: ''} {iconFocus}"
					aria-label={guild.name}
					aria-current={isSelected ? "true" : undefined}
					title={guild.name}
					onclick={() => onSpaceSelect(guild.id)}
				>
					<SpaceIcon src={guild.icon_url || null} name={guild.name} size={30} class="rounded-[9px]" />
					{#if newsBySpace.get(guild.id)?.unread}{@render pip()}{/if}
				</button>
			{/each}
		{/if}
	</div>

	<UserStatusBar collapsed />
</div>
