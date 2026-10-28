<script lang="ts">
	import {
		AtSign as AtSignIcon,
		ChevronDown as ChevronDownIcon,
		ChevronRight as ChevronRightIcon,
		Ellipsis as EllipsisIcon,
		Folder as FolderIcon,
		FolderMinus as FolderMinusIcon,
		FolderPlus as FolderPlusIcon,
		Hash as HashIcon,
		LogOut as LogOutIcon,
		Pin as PinIcon,
		PinOff as PinOffIcon,
		Plus as PlusIcon,
		Search as SearchIcon,
		Settings as GearSixIcon,
		Volume2 as SpeakerSimpleHighIcon,
		X as XIcon,
	} from "@lucide/svelte";
	import { ContextMenu, DropdownMenu } from "bits-ui";
	import { tick, untrack } from "svelte";
	import { leaveSpace } from "$lib/api/spaces";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { promptDialog } from "$lib/stores/prompt.svelte";
	import { hasPermission, hasSpacePermission, Permission } from "$lib/permissions";
	import {
		conversations,
		currentUser,
		gatewaySpaces,
		mentionCounts,
		pendingFriendRequests,
		unreadChannels,
		unreadConversations,
	} from "$lib/stores.svelte";
	import { groupSpaces, spaceNews, type OpenChats, type SpaceNews } from "$lib/nav";
	import { createFolderWith, moveSpaceToFolder, navPrefs, toggleFolder, togglePinned } from "$lib/nav-prefs.svelte";
	import { isConversationTab, tabDragData, tabNews, tabTitle } from "$lib/pane";
	import type { Guild } from "$lib/types";
	import AddSpaceModal from "$lib/components/AddSpaceModal.svelte";
	import ChannelsSidebar from "$lib/components/ChannelsSidebar.svelte";
	import DMSidebar from "$lib/components/DMSidebar.svelte";
	import SpaceIcon from "$lib/components/SpaceIcon.svelte";
	import TabIcon from "$lib/components/TabIcon.svelte";
	import UserStatusBar from "$lib/components/UserStatusBar.svelte";

	let {
		guilds,
		selectedSpaceId = null,
		activeChannelId = null,
		isFriendsActive = false,
		activeConversationId = null,
		openChats = null,
		shortcutLabel = "Ctrl K",
		onSpaceSelect,
		onRoomSelect,
		onFriendsSelect,
		onConversationSelect,
		onNewGroup,
		onOpenSwitcher,
	}: {
		guilds: Guild[];
		/** The space whose rooms show as a tree under its row. */
		selectedSpaceId?: string | null;
		/** The focused pane's active room, which its row marks. */
		activeChannelId?: string | null;
		isFriendsActive?: boolean;
		activeConversationId?: string | null;
		openChats?: OpenChats | null;
		shortcutLabel?: string;
		onSpaceSelect: (spaceId: string) => void;
		onRoomSelect: (spaceId: string, roomId: string) => void;
		onFriendsSelect: () => void;
		onConversationSelect: (conversationId: string) => void;
		onNewGroup: () => void;
		onOpenSwitcher: () => void;
	} = $props();

	const newsBySpace = $derived(
		Object.fromEntries(guilds.map((g) => [g.id, spaceNews(g.channels, $unreadChannels, $mentionCounts)])) as Record<
			string,
			SpaceNews
		>,
	);

	// The selected space stays in the group it was in when it was selected: moving its row would mount its rooms'
	// tree again, and close what was open in it (a room's settings, the create room dialog).
	let frozenNews = $state<{ spaceId: string; news: boolean } | null>(null);
	$effect(() => {
		const id = selectedSpaceId;
		untrack(() => {
			const news = id ? newsBySpace[id] : undefined;
			frozenNews = id && news ? { spaceId: id, news: news.unread } : null;
		});
	});

	const groups = $derived(
		groupSpaces(
			guilds.map((g) => g.id),
			navPrefs.pinned,
			navPrefs.folders,
			(id) => (frozenNews?.spaceId === id ? frozenNews.news : (newsBySpace[id]?.unread ?? false)),
		),
	);
	const guildById = $derived(new Map(guilds.map((g) => [g.id, g])));

	let quietOpen = $state(false);
	// The selected space's tree can be folded by clicking its row again.
	let treeFolded = $state(false);
	$effect(() => {
		void selectedSpaceId;
		treeFolded = false;
	});

	const expandedSpaceId = $derived(isFriendsActive ? null : selectedSpaceId);
	const shownQuiet = $derived(quietOpen ? groups.quiet : groups.quiet.filter((id) => id === expandedSpaceId));
	const foldedQuietCount = $derived(groups.quiet.length - shownQuiet.length);

	const dmBadge = $derived($pendingFriendRequests.length + $unreadConversations.size);

	// The spaces the user owns, which the API won't let them leave: they can only delete one.
	const ownedSpaceIds = $derived(
		new Set($gatewaySpaces.filter((s) => s.owner_id === $currentUser?.id).map((s) => s.id)),
	);

	function selectSpace(id: string) {
		if (id === expandedSpaceId) {
			treeFolded = !treeFolded;
			return;
		}
		onSpaceSelect(id);
	}

	// ── The space's actions: the server rail's and the space header's menus ──────
	let channelsRef = $state<ReturnType<typeof ChannelsSidebar> | null>(null);
	let showAddSpace = $state(false);

	// The settings and the create room dialog belong to the space's tree, which shows for the selected space only.
	async function withTreeOf(spaceId: string, action: (tree: ReturnType<typeof ChannelsSidebar>) => void) {
		if (spaceId !== expandedSpaceId) onSpaceSelect(spaceId);
		treeFolded = false;
		await tick();
		if (channelsRef) action(channelsRef);
	}

	function handleLeave(guild: Guild) {
		void confirmAction(`Leave "${guild.name}"? You'll need an invite to join it again.`, "Leave", () =>
			leaveSpace(guild.id),
		);
	}

	async function newFolderWith(spaceId: string) {
		const name = await promptDialog("Folder name", "My folder");
		if (!name?.trim()) return;
		createFolderWith(name.trim(), spaceId);
	}

	type SpaceAction = {
		label: string;
		icon: typeof PinIcon;
		onSelect: () => void;
		danger?: boolean;
		separatorBefore?: boolean;
	};

	function spaceActions(guild: Guild): SpaceAction[] {
		const space = $gatewaySpaces.find((s) => s.id === guild.id);
		const pinned = navPrefs.pinned.includes(guild.id);
		const folder = navPrefs.folders.find((f) => f.guildIds.includes(guild.id));
		const actions: SpaceAction[] = [
			{
				label: pinned ? "Unpin" : "Pin to top",
				icon: pinned ? PinOffIcon : PinIcon,
				onSelect: () => togglePinned(guild.id),
			},
			{
				label: "Space settings",
				icon: GearSixIcon,
				onSelect: () => void withTreeOf(guild.id, (tree) => tree.openServerSettings()),
			},
		];
		// The API creates a room for ManageChannels in the space
		if (space && hasSpacePermission(space, Permission.ManageChannels)) {
			actions.push({
				label: "Create channel",
				icon: PlusIcon,
				onSelect: () => void withTreeOf(guild.id, (tree) => tree.openCreateChannel()),
			});
		}
		// The folders of the old server rail: the space moves between them, or into a new one.
		const folderActions: SpaceAction[] = navPrefs.folders
			.filter((f) => f.id !== folder?.id)
			.map((f) => ({
				label: `Move to ${f.name}`,
				icon: FolderIcon,
				onSelect: () => moveSpaceToFolder(guild.id, f.id),
			}));
		if (folder) {
			folderActions.push({
				label: `Take out of ${folder.name}`,
				icon: FolderMinusIcon,
				onSelect: () => moveSpaceToFolder(guild.id, null),
			});
		}
		folderActions.push({ label: "New folder…", icon: FolderPlusIcon, onSelect: () => void newFolderWith(guild.id) });
		folderActions[0].separatorBefore = true;
		actions.push(...folderActions);
		if (!ownedSpaceIds.has(guild.id)) {
			actions.push({
				label: "Leave space",
				icon: LogOutIcon,
				onSelect: () => handleLeave(guild),
				danger: true,
				separatorBefore: true,
			});
		}
		return actions;
	}

	// The rooms a space with news shows while it isn't selected: those with unread messages, and the voice rooms
	// with people in them the user can join.
	function roomsWithNews(guild: Guild) {
		const space = $gatewaySpaces.find((s) => s.id === guild.id);
		return guild.channels.filter((ch) => {
			if (ch.type === "text") return $unreadChannels.has(ch.id) || !!$mentionCounts[ch.id];
			if (ch.type !== "voice" || !ch.voiceUsers?.length || !space) return false;
			const room = space.rooms.find((r) => r.id === ch.id);
			return !!room && hasPermission(space, room, Permission.JoinVoice);
		});
	}

	function conversationKind(conversationId: string) {
		return $conversations.find((c) => c.id === conversationId)?.type === 2 ? "Group" : "Direct message";
	}

	function spaceNameOf(spaceId: string) {
		return guildById.get(spaceId)?.name ?? "";
	}

	// ── Open chats: drag to reorder ─────────────────────────────────────────────
	let draggedTabId = $state<string | null>(null);

	function dropTabOn(targetId: string) {
		if (!openChats || !draggedTabId || draggedTabId === targetId) return;
		const tabs = [...openChats.tabs];
		const from = tabs.findIndex((t) => t.channelId === draggedTabId);
		const to = tabs.findIndex((t) => t.channelId === targetId);
		if (from === -1 || to === -1) return;
		const [moved] = tabs.splice(from, 1);
		tabs.splice(to, 0, moved);
		openChats.onReorder(tabs);
	}

	const rowFocus = "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-duvet-accent";
	const menuContentClass = "z-200 min-w-48 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-duvet-float";
	const menuItemClass =
		"flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-100 transition-colors data-highlighted:bg-zinc-700 hover:bg-zinc-700";
</script>

{#snippet countPill(count: number, label: string)}
	<span
		class="bg-duvet-accent text-duvet-on-accent flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold"
		aria-label={label}>{count > 99 ? "99+" : count}</span
	>
{/snippet}

{#snippet sectionHeader(title: string)}
	<h3 class="text-duvet-ink2 mx-1.5 mt-3 mb-1 text-[13px] font-bold select-none">{title}</h3>
{/snippet}

{#snippet spaceRow(guild: Guild)}
	{@const news = newsBySpace[guild.id]}
	{@const expanded = guild.id === expandedSpaceId && !treeFolded}
	{@const isSelected = guild.id === expandedSpaceId}
	{@const actions = spaceActions(guild)}
	<li>
		<ContextMenu.Root>
			<ContextMenu.Trigger>
				{#snippet child({ props })}
					<div {...props} class="group/space rounded-row hover:bg-duvet-card/70 relative flex items-center">
						<button
							type="button"
							class="rounded-row flex min-w-0 flex-1 items-center gap-2.5 p-1.5 text-left text-[15px] {rowFocus}
								{news?.unread || isSelected ? 'text-duvet-ink font-bold' : 'text-duvet-ink2 hover:text-duvet-ink font-medium'}"
							aria-expanded={isSelected ? expanded : undefined}
							aria-current={isSelected ? "true" : undefined}
							onclick={() => selectSpace(guild.id)}
						>
							<!-- The row reads as the space's name, not its monogram as well. -->
							<span class="contents" aria-hidden="true"
								><SpaceIcon src={guild.icon_url || null} name={guild.name} size={28} class="rounded-[9px]" /></span
							>
							<span class="min-w-0 flex-1 truncate">{guild.name}</span>
							{#if news?.inVoice}
								<span
									class="text-duvet-ink2 flex shrink-0 items-center gap-1 text-xs font-normal"
									aria-label="{news.inVoice} in voice"
								>
									<span class="bg-duvet-alive size-2 rounded-full"></span>{news.inVoice}
								</span>
							{/if}
							{#if news?.mentions}
								{@render countPill(news.mentions, `${news.mentions} mentions`)}
							{/if}
							{#if isSelected}
								<ChevronDownIcon
									class="text-duvet-ink2 size-3.5 shrink-0 transition-transform motion-reduce:transition-none {expanded
										? ''
										: '-rotate-90'}"
									aria-hidden="true"
								/>
							{/if}
						</button>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="text-duvet-ink2 hover:bg-duvet-chosen hover:text-duvet-chosen-ink mr-1 flex size-6 shrink-0 items-center justify-center rounded-md opacity-0 group-focus-within/space:opacity-100 group-hover/space:opacity-100 data-[state=open]:opacity-100 {rowFocus}"
								aria-label="{guild.name} options"
							>
								<EllipsisIcon class="size-4" />
							</DropdownMenu.Trigger>
							<DropdownMenu.Portal>
								<DropdownMenu.Content class={menuContentClass} sideOffset={4} align="start">
									{#each actions as action (action.label)}
										{#if action.separatorBefore}
											<DropdownMenu.Separator class="my-1 border-t border-zinc-700" />
										{/if}
										<DropdownMenu.Item
											class="{menuItemClass} {action.danger ? 'text-red-400' : ''}"
											onSelect={action.onSelect}
										>
											<action.icon class="size-4 {action.danger ? '' : 'text-zinc-400'}" />
											{action.label}
										</DropdownMenu.Item>
									{/each}
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
					</div>
				{/snippet}
			</ContextMenu.Trigger>
			<ContextMenu.Portal>
				<ContextMenu.Content class={menuContentClass}>
					{#each actions as action (action.label)}
						{#if action.separatorBefore}
							<ContextMenu.Separator class="my-1 border-t border-zinc-700" />
						{/if}
						<ContextMenu.Item class="{menuItemClass} {action.danger ? 'text-red-400' : ''}" onSelect={action.onSelect}>
							<action.icon class="size-4 {action.danger ? '' : 'text-zinc-400'}" />
							{action.label}
						</ContextMenu.Item>
					{/each}
				</ContextMenu.Content>
			</ContextMenu.Portal>
		</ContextMenu.Root>

		{#if isSelected}
			{#if expanded}
				<ChannelsSidebar
					bind:this={channelsRef}
					embedded
					{guild}
					channels={guild.channels}
					{activeChannelId}
					onSelect={(roomId) => onRoomSelect(guild.id, roomId)}
				/>
			{/if}
		{:else if news?.unread || news?.inVoice}
			{@const rooms = roomsWithNews(guild)}
			{#if rooms.length > 0}
				<ul class="border-duvet-line mb-1 ml-[19px] flex flex-col gap-px border-l-2 py-0.5 pl-2.5">
					{#each rooms as room (room.id)}
						{@const mentions = $mentionCounts[room.id] ?? 0}
						<li>
							<button
								type="button"
								class="hover:bg-duvet-card flex h-8 w-full items-center gap-1.5 rounded-[10px] px-2 text-left text-sm {rowFocus}
									{room.type === 'text' ? 'text-duvet-ink font-bold' : 'text-duvet-ink2 hover:text-duvet-ink'}"
								onclick={() => onRoomSelect(guild.id, room.id)}
							>
								{#if room.type === "voice"}
									<SpeakerSimpleHighIcon class="text-duvet-alive size-4 shrink-0" />
								{:else}
									<HashIcon class="text-duvet-ink2 size-4 shrink-0" />
								{/if}
								<span class="min-w-0 flex-1 truncate">{room.name}</span>
								{#if mentions}
									{@render countPill(mentions, `${mentions} mentions`)}
								{:else if room.type === "voice"}
									<span class="text-duvet-ink2 shrink-0 text-xs">{room.voiceUsers?.length}</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</li>
{/snippet}

<nav class="bg-duvet-sunk text-duvet-ink flex h-full w-[280px] flex-col" aria-label="Spaces and chats">
	<div class="shrink-0 px-2.5 pt-3 pb-1">
		<button
			type="button"
			class="rounded-row bg-duvet-bg text-duvet-ink2 shadow-duvet-press hover:text-duvet-ink flex h-9 w-full items-center gap-2.5 px-3 text-left text-[13.5px] transition-colors {rowFocus}"
			onclick={onOpenSwitcher}
			aria-haspopup="dialog"
			aria-keyshortcuts={shortcutLabel.startsWith("⌘") ? "Meta+K" : "Control+K"}
		>
			<SearchIcon class="size-4 shrink-0" />
			<span class="min-w-0 flex-1 truncate">Search or jump to…</span>
			<kbd
				class="bg-duvet-card text-duvet-ink2 shadow-duvet-raised shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold"
				>{shortcutLabel}</kbd
			>
		</button>
	</div>

	<div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2">
		{#if openChats}
			{@render sectionHeader("Open")}
			{#if openChats.tabs.length === 0}
				<p class="text-duvet-ink2 mx-1.5 mb-1 text-[13px]">Pick a room to open it here</p>
			{/if}
			<ul class="flex flex-col gap-px" aria-label="Open chats">
				{#each openChats.tabs as tab (tab.channelId)}
					{@const isActive = tab.channelId === openChats.activeChannelId}
					{@const news = tabNews(tab, $unreadChannels, $unreadConversations, $mentionCounts)}
					{@const mentions = news.mentions}
					{@const unread = !isActive && news.unread}
					{@const title = tabTitle(tab, $conversations, $currentUser?.id)}
					<li
						class="group/open rounded-row relative {isActive
							? 'bg-duvet-card shadow-duvet-raised'
							: 'hover:bg-duvet-card/70'} {draggedTabId === tab.channelId ? 'opacity-40' : ''}"
						draggable="true"
						ondragstart={(e) => {
							draggedTabId = tab.channelId;
							e.dataTransfer!.effectAllowed = "move";
							// The data a room's drag carries, so a pane takes it as a room or conversation to open.
							e.dataTransfer!.setData("text/plain", tabDragData(tab));
						}}
						ondragover={(e) => {
							if (!draggedTabId) return;
							e.preventDefault();
						}}
						ondrop={(e) => {
							if (!draggedTabId) return;
							e.preventDefault();
							dropTabOn(tab.channelId);
							draggedTabId = null;
						}}
						ondragend={() => (draggedTabId = null)}
					>
						<button
							type="button"
							class="rounded-row flex w-full items-center gap-2.5 px-2 py-1.5 pr-8 text-left {rowFocus}"
							aria-current={isActive ? "true" : undefined}
							onclick={() => openChats.onActivate(tab.channelId)}
						>
							<span class="bg-duvet-bg shadow-duvet-press flex size-7 shrink-0 items-center justify-center rounded-lg">
								<TabIcon {tab} size={isConversationTab(tab) ? 20 : 14} />
							</span>
							<span class="flex min-w-0 flex-1 flex-col leading-tight">
								<span
									class="truncate text-sm {isActive || unread
										? 'text-duvet-ink font-bold'
										: 'text-duvet-ink2 font-medium'}">{title}</span
								>
								<span class="text-duvet-ink2 truncate text-xs"
									>{isConversationTab(tab) ? conversationKind(tab.channelId) : spaceNameOf(tab.spaceId)}</span
								>
							</span>
							{#if mentions && !isActive}
								<span class="group-focus-within/open:hidden group-hover/open:hidden">
									{@render countPill(mentions, `${mentions} mentions`)}
								</span>
							{/if}
						</button>
						<button
							type="button"
							class="text-duvet-ink2 hover:bg-duvet-chosen hover:text-duvet-chosen-ink absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md opacity-0 group-focus-within/open:opacity-100 group-hover/open:opacity-100 {rowFocus}"
							aria-label="Close {title}"
							onclick={() => openChats.onClose(tab.channelId)}
						>
							<XIcon class="size-3.5" />
						</button>
					</li>
				{/each}
			</ul>
			{@render sectionHeader("Spaces")}
		{/if}

		<div class={openChats ? "" : "mt-1"}>
			<div
				class="group/dm rounded-row flex items-center {isFriendsActive ? 'bg-duvet-card/70' : 'hover:bg-duvet-card/70'}"
			>
				<button
					type="button"
					class="rounded-row flex min-w-0 flex-1 items-center gap-2.5 p-1.5 text-left text-[15px] {rowFocus}
						{isFriendsActive || dmBadge ? 'text-duvet-ink font-bold' : 'text-duvet-ink2 hover:text-duvet-ink font-medium'}"
					aria-expanded={isFriendsActive || !!activeConversationId}
					onclick={onFriendsSelect}
				>
					<span
						class="bg-duvet-card text-duvet-ink shadow-duvet-raised flex size-7 shrink-0 items-center justify-center rounded-[9px]"
					>
						<AtSignIcon class="size-4" />
					</span>
					<span class="min-w-0 flex-1 truncate">Direct messages</span>
					{#if dmBadge}
						{@render countPill(dmBadge, `${dmBadge} new`)}
					{/if}
				</button>
			</div>
			<!-- The conversations show under the row in the friends view, and while the focused pane shows one of them. -->
			{#if isFriendsActive || activeConversationId}
				<DMSidebar embedded {activeConversationId} onSelect={onConversationSelect} {onNewGroup} />
			{/if}
		</div>

		{#if groups.pinned.length}
			{@render sectionHeader("Pinned")}
			<ul class="flex flex-col gap-px">
				{#each groups.pinned as id (id)}
					{@const guild = guildById.get(id)}
					{#if guild}{@render spaceRow(guild)}{/if}
				{/each}
			</ul>
		{/if}

		{#each groups.folders as group (group.folder.id)}
			<button
				type="button"
				class="text-duvet-ink2 hover:text-duvet-ink mx-0.5 mt-3 mb-1 flex items-center gap-1 rounded-md px-1 text-left text-[13px] font-bold {rowFocus}"
				aria-expanded={!group.folder.collapsed}
				onclick={() => toggleFolder(group.folder.id)}
			>
				{#if group.folder.collapsed}
					<ChevronRightIcon class="size-3.5" aria-hidden="true" />
				{:else}
					<ChevronDownIcon class="size-3.5" aria-hidden="true" />
				{/if}
				<span class="truncate">{group.folder.name}</span>
			</button>
			{#if !group.folder.collapsed || group.spaceIds.includes(expandedSpaceId ?? "")}
				<ul class="flex flex-col gap-px">
					{#each group.folder.collapsed ? group.spaceIds.filter((id) => id === expandedSpaceId) : group.spaceIds as id (id)}
						{@const guild = guildById.get(id)}
						{#if guild}{@render spaceRow(guild)}{/if}
					{/each}
				</ul>
			{/if}
		{/each}

		{#if groups.news.length}
			{@render sectionHeader("With news")}
			<ul class="flex flex-col gap-px">
				{#each groups.news as id (id)}
					{@const guild = guildById.get(id)}
					{#if guild}{@render spaceRow(guild)}{/if}
				{/each}
			</ul>
		{/if}

		{#if groups.quiet.length}
			<!-- The Open list already put a "Spaces" header above the direct messages. -->
			{#if !openChats && !groups.pinned.length && !groups.news.length && !groups.folders.length}
				{@render sectionHeader("Spaces")}
			{/if}
			<ul class="mt-1 flex flex-col gap-px">
				{#each shownQuiet as id (id)}
					{@const guild = guildById.get(id)}
					{#if guild}{@render spaceRow(guild)}{/if}
				{/each}
			</ul>
			{#if foldedQuietCount > 0 || quietOpen}
				<button
					type="button"
					class="rounded-row text-duvet-ink2 hover:bg-duvet-card/70 hover:text-duvet-ink mt-px flex w-full items-center gap-2.5 p-1.5 text-left text-[15px] font-medium {rowFocus}"
					aria-expanded={quietOpen}
					onclick={() => (quietOpen = !quietOpen)}
				>
					<span
						class="bg-duvet-card shadow-duvet-raised flex size-7 shrink-0 items-center justify-center rounded-[9px] text-xs font-bold"
						>{quietOpen ? groups.quiet.length : foldedQuietCount}</span
					>
					<span class="min-w-0 flex-1 truncate">
						{#if quietOpen}Fold quiet Spaces{:else}{foldedQuietCount} quiet {foldedQuietCount === 1
								? "Space"
								: "Spaces"}{/if}
					</span>
					{#if quietOpen}
						<ChevronDownIcon class="size-3.5 shrink-0" aria-hidden="true" />
					{:else}
						<ChevronRightIcon class="size-3.5 shrink-0" aria-hidden="true" />
					{/if}
				</button>
			{/if}
		{/if}

		<button
			type="button"
			class="rounded-row text-duvet-ink2 hover:bg-duvet-card/70 hover:text-duvet-ink mt-3 flex w-full items-center gap-2.5 p-1.5 text-left text-sm font-medium {rowFocus}"
			onclick={() => (showAddSpace = true)}
		>
			<span
				class="border-duvet-line text-duvet-ink2 flex size-7 shrink-0 items-center justify-center rounded-[9px] border border-dashed"
			>
				<PlusIcon class="size-4" />
			</span>
			Join or create a Space
		</button>
	</div>

	<div class="shrink-0 px-2.5 pb-2.5">
		<div class="rounded-card bg-duvet-card shadow-duvet-raised overflow-hidden">
			<UserStatusBar />
		</div>
	</div>
</nav>

<AddSpaceModal bind:open={showAddSpace} />
