<script lang="ts">
	import { Users as UsersIcon } from "@lucide/svelte";
	import { conversations, currentUser, pendingFriendRequests } from "$lib/stores.svelte";
	import { shownMentionCounts, shownUnreadConversations, shownUnreadRooms } from "$lib/notification-marks";
	import { groupSpaces, spaceNews, type OpenChats } from "$lib/nav";
	import { tabNews, tabTitle } from "$lib/pane";
	import { navPrefs } from "$lib/nav-prefs.svelte";
	import type { Guild } from "$lib/types";
	import SpaceIcon from "$lib/components/ui/SpaceIcon.svelte";
	import TabIcon from "$lib/components/TabIcon.svelte";
	import ProfileRow from "$lib/components/ProfileRow.svelte";

	/** The sidebar folded to an edge, under the title line (#357): Friends, the focused pane's open chats, the pinned
	 * spaces and those with news, and the user with the media controls. Hovering it, or moving the keyboard's focus into
	 * it, shows the whole sidebar over the chat. */
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
		new Map(guilds.map((g) => [g.id, spaceNews(g.channels, $shownUnreadRooms, $shownMentionCounts)])),
	);
	const shownSpaces = $derived.by(() => {
		const groups = groupSpaces(
			guilds.map((g) => g.id),
			navPrefs.pinned,
			(id) => newsBySpace.get(id)?.unread ?? false,
		);
		const ids = [...groups.pinned, ...groups.news];
		// The selected space shows too, wherever it is in the column.
		if (selectedSpaceId && !ids.includes(selectedSpaceId)) ids.push(selectedSpaceId);
		return ids.map((id) => guilds.find((g) => g.id === id)).filter((g): g is Guild => !!g);
	});
	const dmNews = $derived($pendingFriendRequests.length + $shownUnreadConversations.size > 0);

	const iconFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-duvet-accent";
</script>

{#snippet pip()}
	<span class="border-duvet-sb-ring bg-duvet-accent absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2"></span>
{/snippet}

<div class="bg-duvet-sb-bg relative z-10 flex h-full w-[60px] flex-col items-center pt-2">
	<button
		type="button"
		class="relative flex size-9 shrink-0 items-center justify-center rounded-full {isFriendsActive
			? 'bg-duvet-accent-tint text-duvet-accent-text'
			: 'bg-duvet-secondary-fill text-duvet-accent-text'} {iconFocus}"
		aria-label="Friends"
		title="Friends"
		aria-pressed={isFriendsActive}
		data-jump
		onclick={onFriendsSelect}
	>
		<UsersIcon class="size-4" />
		{#if dmNews}{@render pip()}{/if}
	</button>

	<div
		class="mt-2 flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
	>
		{#if openChats.tabs.length}
			<div class="bg-duvet-sb-edge h-px w-6 shrink-0 rounded-full"></div>
			{#each openChats.tabs as tab (tab.channelId)}
				{@const isActive = tab.channelId === openChats.activeChannelId && !isFriendsActive}
				{@const unread =
					!isActive && tabNews(tab, $shownUnreadRooms, $shownUnreadConversations, $shownMentionCounts).unread}
				{@const title = tabTitle(tab, $conversations, $currentUser?.id)}
				<button
					type="button"
					class="relative flex size-9 shrink-0 items-center justify-center rounded-[10px] transition-colors duration-[120ms] motion-reduce:transition-none {isActive
						? 'bg-duvet-accent-tint'
						: 'hover:bg-duvet-sb-hover'} {iconFocus}"
					aria-label={title}
					aria-current={isActive ? "true" : undefined}
					{title}
					data-jump
					onclick={() => openChats.onActivate(tab.channelId)}
				>
					<TabIcon {tab} size={16} />
					{#if unread}{@render pip()}{/if}
				</button>
			{/each}
		{/if}

		{#if shownSpaces.length}
			<div class="bg-duvet-sb-edge h-px w-6 shrink-0 rounded-full"></div>
			{#each shownSpaces as guild (guild.id)}
				{@const isSelected = guild.id === selectedSpaceId && !isFriendsActive}
				<button
					type="button"
					class="relative shrink-0 rounded-[8px] {isSelected
						? 'outline-duvet-accent outline-2 outline-offset-2'
						: ''} {iconFocus}"
					aria-label={guild.name}
					aria-current={isSelected ? "true" : undefined}
					title={guild.name}
					data-jump
					onclick={() => onSpaceSelect(guild.id)}
				>
					<SpaceIcon src={guild.icon_url || null} name={guild.name} size={30} />
					{#if newsBySpace.get(guild.id)?.unread}{@render pip()}{/if}
				</button>
			{/each}
		{/if}
	</div>

	<ProfileRow collapsed />
</div>
