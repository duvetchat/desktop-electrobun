<script lang="ts">
	import {
		CheckCheck as CheckCheckIcon,
		ChevronDown as ChevronDownIcon,
		Ellipsis as EllipsisIcon,
		History as HistoryIcon,
		Layers as LayersIcon,
		LayoutGrid as LayoutGridIcon,
		LogOut as LogOutIcon,
		MessageCircle as MessageCircleIcon,
		PanelLeft as PanelLeftIcon,
		Pin as PinIcon,
		PinOff as PinOffIcon,
		Plus as PlusIcon,
		Search as SearchIcon,
		Settings as GearSixIcon,
		SquarePen as SquarePenIcon,
		Users as UsersIcon,
		X as XIcon,
	} from "@lucide/svelte";
	import { tick, untrack } from "svelte";
	import { ackRoom } from "$lib/api/messages";
	import { leaveSpace } from "$lib/api/spaces";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { hasSpacePermission, Permission } from "$lib/permissions";
	import {
		conversations,
		currentUser,
		gatewaySpaces,
		lastReadRooms,
		mentionCounts,
		pendingFriendRequests,
		typingNow,
		unreadChannels,
	} from "$lib/stores.svelte";
	import { shownMentionCounts, shownUnreadConversations, shownUnreadRooms } from "$lib/notification-marks";
	import { typingSentence } from "$lib/typing";
	import { newestKnownIn } from "$lib/jumps";
	import {
		clickFoldsSpace,
		groupSpaces,
		spaceListRows,
		spaceNews,
		spaceReadAll,
		type OpenChats,
		type SpaceNews,
	} from "$lib/nav";
	import { navPrefs, togglePinned } from "$lib/nav-prefs.svelte";
	import { isConversationTab, tabDragData, tabNews, tabTitle } from "$lib/pane";
	import { currentShell } from "$lib/platform";
	import {
		chipCount,
		friendRequestsLabel,
		mentionsLabel,
		openHow,
		quietSpacesLabel,
		spaceUnfolded,
		type OpenHow,
		type SidebarFilter,
	} from "$lib/shell-layout";
	import { sidebar } from "$lib/stores/sidebar.svelte";
	import type { Guild } from "$lib/types";
	import type { MessageLink } from "$lib/urls";
	import logoOnLight from "$lib/assets/logo/app-icon-rounded.svg";
	import logoOnDark from "$lib/assets/logo/app-icon-colored.svg";
	import AddSpaceModal from "$lib/components/AddSpaceModal.svelte";
	import CallHistory from "$lib/components/CallHistory.svelte";
	import ChannelsSidebar from "$lib/components/ChannelsSidebar.svelte";
	import DMSidebar from "$lib/components/DMSidebar.svelte";
	import DragRegion from "$lib/components/DragRegion.svelte";
	import MediaControls from "$lib/components/MediaControls.svelte";
	import { liveMedia } from "$lib/media-source";
	import { mediaPopOut } from "$lib/media-popout.svelte";
	import NotificationSubmenu from "$lib/components/NotificationSubmenu.svelte";
	import NowSection from "$lib/components/NowSection.svelte";
	import ProfileRow from "$lib/components/ProfileRow.svelte";
	import ProfileControls from "$lib/components/ProfileControls.svelte";
	import TabIcon from "$lib/components/TabIcon.svelte";
	import VoiceNoteBar from "$lib/components/VoiceNoteBar.svelte";
	import WindowControls from "$lib/components/WindowControls.svelte";
	import ContextMenu from "$lib/components/ui/ContextMenu.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import Kbd from "$lib/components/ui/Kbd.svelte";
	import Menu from "$lib/components/ui/Menu.svelte";
	import MenuItem from "$lib/components/ui/MenuItem.svelte";
	import MenuSeparator from "$lib/components/ui/MenuSeparator.svelte";
	import Popover from "$lib/components/ui/Popover.svelte";
	import Segmented from "$lib/components/ui/Segmented.svelte";
	import SpaceIcon from "$lib/components/ui/SpaceIcon.svelte";
	import Tooltip from "$lib/components/ui/Tooltip.svelte";
	import { countBadgeClass, iconButtonClass, MENU_PANEL, menuItemClass } from "$lib/components/ui/recipes";

	// The sidebar (#357, S-03 to S-07, S-09): one column. Its header is half of the window's title line; under it the
	// field that opens the quick switcher; then Chats and Spaces as two sections of one list, or one of them alone
	// (the switch at its foot); then what is going on now; and at the bottom the playback bar, the media controls, the
	// profile row and the All · Chats · Spaces switch. A Space is a tree under its row: its categories and rooms, each
	// voice room with who's in it. Busy Spaces are open and quiet ones folded.
	let {
		guilds,
		selectedSpaceId = null,
		activeChannelId = null,
		isFriendsActive = false,
		activeConversationId = null,
		openChats = null,
		shortcutLabel = "Ctrl K",
		showUser = true,
		onHideSidebar = null,
		sidebarKeys = undefined,
		onOpenMessage = undefined,
		onSpaceSelect,
		onRoomSelect,
		onFriendsSelect,
		onConversationSelect,
		onNewGroup,
		onOpenSwitcher,
		onFriend,
	}: {
		guilds: Guild[];
		/** The space the focused pane is in. */
		selectedSpaceId?: string | null;
		/** The focused pane's active room, which its row marks. */
		activeChannelId?: string | null;
		isFriendsActive?: boolean;
		activeConversationId?: string | null;
		openChats?: OpenChats | null;
		shortcutLabel?: string;
		/** Off when the column shows beside the folded edge, which already has the user's controls and whose title line
		 * is the tab strip's. */
		showUser?: boolean;
		/** Hides the sidebar (its header's button); null where it shows over the chat, beside the folded edge. */
		onHideSidebar?: (() => void) | null;
		sidebarKeys?: string;
		/** Opens a call's notice in its conversation, from the call history. */
		onOpenMessage?: (link: MessageLink) => void;
		/** A Space, a room or a chat picked, and how its press opens it (lib/shell-layout.ts: openHow). */
		onSpaceSelect: (spaceId: string, how: OpenHow) => void;
		onRoomSelect: (spaceId: string, roomId: string, how: OpenHow) => void;
		onFriendsSelect: () => void;
		onConversationSelect: (conversationId: string, how: OpenHow) => void;
		onNewGroup: () => void;
		onOpenSwitcher: () => void;
		/** Opens the direct message with a friend, as the quick switcher's friends do. */
		onFriend: (userId: string) => void;
	} = $props();

	const shell = currentShell();
	const mac = shell.os === "mac";
	let callsOpen = $state(false);

	const newsBySpace = $derived(
		Object.fromEntries(
			guilds.map((g) => [g.id, spaceNews(g.channels, $shownUnreadRooms, $shownMentionCounts)]),
		) as Record<string, SpaceNews>,
	);

	// The selected space stays in the group it was in when it was selected: moving its row behind the quiet Spaces'
	// row would take its rooms' tree away, and close what was open in it (a room's settings, the create room dialog).
	let frozenNews = $state<{ spaceId: string; news: boolean } | null>(null);
	$effect(() => {
		const id = selectedSpaceId;
		untrack(() => {
			const news = id ? newsBySpace[id] : undefined;
			frozenNews = id && news ? { spaceId: id, news: news.unread } : null;
		});
	});

	// Pinned Spaces first, in the order pinned; then those with news; then the quiet ones.
	const groups = $derived(
		groupSpaces(
			guilds.map((g) => g.id),
			navPrefs.pinned,
			(id) => (frozenNews?.spaceId === id ? frozenNews.news : (newsBySpace[id]?.unread ?? false)),
		),
	);
	const guildById = $derived(new Map(guilds.map((g) => [g.id, g])));

	let quietOpen = $state(false);
	const expandedSpaceId = $derived(isFriendsActive ? null : selectedSpaceId);
	// The quiet Spaces wait behind their own row, the one the focused pane is in excepted, which shows under it
	// (spaceListRows). One list, keyed by Space, the quiet row among them: a Space that gets news, or is pinned, moves in
	// it without its tree being taken away.
	const rows = $derived(spaceListRows(groups, quietOpen, expandedSpaceId));

	// Each Space's tree, shut or opened by the user (its caret), until the app closes. Without their say a busy Space
	// is open and a quiet one shut (spaceUnfolded).
	let treeChoice = $state<Record<string, boolean>>({});
	function unfolded(guild: Guild): boolean {
		const news = newsBySpace[guild.id];
		return spaceUnfolded(treeChoice[guild.id], {
			selected: guild.id === expandedSpaceId,
			unread: news?.unread ?? false,
			inVoice: news?.inVoice ?? 0,
		});
	}
	// Going to a Space opens its tree again, if the user had shut it.
	$effect(() => {
		const id = expandedSpaceId;
		untrack(() => {
			if (id && treeChoice[id] === false) delete treeChoice[id];
		});
	});

	const friendRequests = $derived($pendingFriendRequests.length);
	const unreadChats = $derived($shownUnreadConversations.size > 0 || friendRequests > 0);
	const unreadRooms = $derived(Object.values(newsBySpace).some((news) => news.unread));

	// The spaces the user owns, which the API won't let them leave: they can only delete one.
	const ownedSpaceIds = $derived(
		new Set($gatewaySpaces.filter((s) => s.owner_id === $currentUser?.id).map((s) => s.id)),
	);

	// A click on a Space takes the user to it, its tree open. On the Space the focused pane is in, while that pane
	// shows one of its rooms, there is nowhere to go: the click shuts or opens its tree, as its caret does.
	function selectSpace(id: string, how: OpenHow) {
		const guild = guildById.get(id);
		if (how === "here" && guild && id === expandedSpaceId && clickFoldsSpace(guild.channels, activeChannelId)) {
			treeChoice[id] = !unfolded(guild);
			return;
		}
		treeChoice[id] = true;
		onSpaceSelect(id, how);
	}

	// ── The space's actions: its row's menu, from its … button or a right click ──────
	let trees = $state<Record<string, ReturnType<typeof ChannelsSidebar> | null>>({});
	let showAddSpace = $state(false);
	// How tall the rows are, all of them: the Now section below takes the rest of the column.
	let rowsHeight = $state(0);

	// The settings and the create room dialog belong to the space's tree: it opens for them, wherever the Space is.
	async function withTreeOf(spaceId: string, action: (tree: ReturnType<typeof ChannelsSidebar>) => void) {
		if (groups.quiet.includes(spaceId)) quietOpen = true;
		treeChoice[spaceId] = true;
		await tick();
		const tree = trees[spaceId];
		if (tree) action(tree);
	}

	function handleLeave(guild: Guild) {
		void confirmAction(`Leave "${guild.name}"? You'll need an invite to join it again.`, "Leave", () =>
			leaveSpace(guild.id),
		);
	}

	// Every room of the space with news read, up to the newest message known there (spaceReadAll).
	function markAllRead(guild: Guild) {
		const read = spaceReadAll(
			guild.channels,
			{ unread: $unreadChannels, mentions: $mentionCounts, lastRead: $lastReadRooms },
			newestKnownIn,
		);
		unreadChannels.set(read.unread);
		mentionCounts.set(read.mentions);
		lastReadRooms.set(read.lastRead);
		for (const { roomId, messageId } of read.acks) {
			ackRoom(roomId, messageId).catch((err) => console.error("[ack] network error:", err));
		}
	}

	// A space's menus list these, then its Notifications submenu, then Leave Space for whoever doesn't own it.
	type SpaceAction = {
		label: string;
		icon: typeof PinIcon;
		onSelect: () => void;
	};

	function spaceActions(guild: Guild): SpaceAction[] {
		const space = $gatewaySpaces.find((s) => s.id === guild.id);
		const pinned = navPrefs.pinned.includes(guild.id);
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
				label: "Create room",
				icon: PlusIcon,
				onSelect: () => void withTreeOf(guild.id, (tree) => tree.openCreateChannel()),
			});
		}
		actions.push({ label: "Mark all as read", icon: CheckCheckIcon, onSelect: () => markAllRead(guild) });
		return actions;
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
		tabs.splice(to, 0, moved!);
		openChats.onReorder(tabs);
	}

	const FILTERS: { value: SidebarFilter; label: string; title: string; icon: typeof LayersIcon }[] = [
		{ value: "all", label: "All", title: "Chats and Spaces", icon: LayersIcon },
		{ value: "chats", label: "Chats", title: "Chats only", icon: MessageCircleIcon },
		{ value: "spaces", label: "Spaces", title: "Spaces only", icon: LayoutGridIcon },
	];

	const rowFocus = "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-duvet-accent";
	const chip = countBadgeClass("md", false);
</script>

{#snippet mentionChip(count: number)}
	<span class="{chip} bg-duvet-accent text-duvet-on-accent" role="img" aria-label={mentionsLabel(count)}
		>{chipCount(count)}</span
	>
{/snippet}

{#snippet sectionHead(title: string)}
	<h3 class="text-duvet-ink2 flex h-[30px] items-end px-2.5 pb-0.5 text-[11.5px] font-semibold select-none">{title}</h3>
{/snippet}

<!-- A Space's menu, the same from its … button and from a right click on its row. -->
{#snippet spaceMenuItems(guild: Guild)}
	{#each spaceActions(guild) as action (action.label)}
		<MenuItem icon={action.icon} onSelect={action.onSelect}>{action.label}</MenuItem>
	{/each}
{/snippet}

{#snippet leaveItem(guild: Guild)}
	{#if !ownedSpaceIds.has(guild.id)}
		<MenuSeparator />
		<MenuItem icon={LogOutIcon} danger onSelect={() => handleLeave(guild)}>Leave Space</MenuItem>
	{/if}
{/snippet}

{#snippet spaceRow(guild: Guild)}
	{@const news = newsBySpace[guild.id]}
	{@const open = unfolded(guild)}
	{@const isSelected = guild.id === expandedSpaceId}
	{@const pinned = navPrefs.pinned.includes(guild.id)}
	<!-- What the space's Default notifies: its owner's choice, only mentions until they make one. -->
	{@const spaceDefault = $gatewaySpaces.find((s) => s.id === guild.id)?.default_notifications ?? 1}
	<li>
		<ContextMenu>
			{#snippet target(props)}
				<div
					{...props}
					class="group/space hover:bg-duvet-sb-hover relative flex h-[34px] items-center gap-[3px] rounded-[10px] pr-1.5 transition-colors duration-[120ms] motion-reduce:transition-none"
				>
					<button
						type="button"
						class="text-duvet-ink2 hover:text-duvet-ink grid h-6 w-[18px] shrink-0 place-items-center rounded-md {rowFocus}"
						aria-label="{open ? 'Fold' : 'Unfold'} {guild.name}"
						aria-expanded={open}
						onclick={() => (treeChoice[guild.id] = !open)}
					>
						<ChevronDownIcon
							class="size-3 transition-transform duration-150 motion-reduce:transition-none {open ? '' : '-rotate-90'}"
							aria-hidden="true"
						/>
					</button>
					<button
						type="button"
						class="flex h-full min-w-0 flex-1 items-center gap-[7px] rounded-[10px] text-left {rowFocus}"
						aria-expanded={open}
						aria-current={isSelected ? "true" : undefined}
						data-jump
						onclick={(e) => selectSpace(guild.id, openHow(e, mac))}
						onauxclick={(e) => e.button === 1 && selectSpace(guild.id, "tab")}
					>
						<!-- The row reads as the space's name, not its monogram as well. -->
						<span class="contents" aria-hidden="true"
							><SpaceIcon src={guild.icon_url || null} name={guild.name} size={22} /></span
						>
						<span
							class="text-duvet-ink min-w-0 flex-1 truncate text-[13.5px] leading-[1.2] {news?.unread
								? 'font-semibold'
								: 'font-medium'}">{guild.name}</span
						>
						{#if pinned}
							<PinIcon class="text-duvet-ink2 size-[11px] shrink-0" role="img" aria-label="Pinned" />
						{/if}
						{#if news?.inVoice}
							<span
								class="text-duvet-ink2 flex shrink-0 items-center gap-1 text-[11.5px]"
								role="img"
								aria-label="{news.inVoice} in voice"
							>
								<span class="bg-duvet-alive size-[7px] rounded-full"></span>{news.inVoice}
							</span>
						{/if}
						{#if news?.mentions}
							{@render mentionChip(news.mentions)}
						{:else if news?.unread && !open}
							<span class="bg-duvet-ink size-[7px] shrink-0 rounded-full" role="img" aria-label="Unread"></span>
						{/if}
					</button>
					<Menu align="start" label="Space menu">
						{#snippet trigger(menuProps)}
							<button
								{...menuProps}
								type="button"
								class="{iconButtonClass(
									'sm',
								)} opacity-0 group-focus-within/space:opacity-100 group-hover/space:opacity-100 data-[state=open]:opacity-100"
								aria-label="{guild.name} options"
								title="Space menu"
							>
								<EllipsisIcon size={15} />
							</button>
						{/snippet}
						{@render spaceMenuItems(guild)}
						<NotificationSubmenu
							targetId={guild.id}
							target={0}
							inherited={spaceDefault}
							itemClass={menuItemClass()}
							contentClass={MENU_PANEL}
						/>
						{@render leaveItem(guild)}
					</Menu>
				</div>
			{/snippet}
			{@render spaceMenuItems(guild)}
			<NotificationSubmenu
				targetId={guild.id}
				target={0}
				inherited={spaceDefault}
				itemClass={menuItemClass()}
				contentClass={MENU_PANEL}
			/>
			{@render leaveItem(guild)}
		</ContextMenu>

		{#if open}
			<ChannelsSidebar
				bind:this={trees[guild.id]}
				{guild}
				channels={guild.channels}
				activeChannelId={isSelected ? activeChannelId : null}
				{mac}
				onSelect={(roomId, how) => onRoomSelect(guild.id, roomId, how)}
			/>
		{/if}
	</li>
{/snippet}

<nav class="bg-duvet-sb-bg text-duvet-ink flex h-full w-full min-w-0 flex-col" aria-label="Spaces and chats">
	<!-- The sidebar's half of the window's title line (S-03): the corner macOS's traffic lights keep, or the logo
	     elsewhere; room that drags the window; then Call history, New chat and Hide sidebar. Shown over the chat, beside
	     the folded edge, the line above is the tab strip's: only the actions stay. -->
	<div class="flex h-[52px] shrink-0 items-center gap-px pr-2">
		{#if showUser}
			{#if shell.chrome === "mac"}
				<WindowControls side="start" />
			{:else}
				<span class="ml-[18px] shrink-0" aria-hidden="true">
					<img
						src={logoOnLight}
						alt=""
						class="hidden size-[22px] rounded-md in-[.duvet-light]:block"
						draggable="false"
					/>
					<img src={logoOnDark} alt="" class="size-[22px] rounded-md in-[.duvet-light]:hidden" draggable="false" />
				</span>
			{/if}
		{/if}
		<DragRegion class="h-full flex-1" />
		<div class="titlebar-actions flex shrink-0 items-center gap-px">
			<Popover bind:open={callsOpen} label="Call history" class="w-[360px] rounded-[20px]">
				{#snippet trigger(props)}
					<IconButton {...props} label="Call history" title="Call history" active={callsOpen}>
						<HistoryIcon size={16} />
					</IconButton>
				{/snippet}
				<div class="flex max-h-[min(70vh,560px)] flex-col">
					<h2 class="text-duvet-ink shrink-0 px-4 pt-3.5 pb-2 font-serif text-[17px] leading-[1.2] font-medium">
						Call history
					</h2>
					<!-- MOUNT POINT (Calls & media): the call history's list, as that workstream draws it. -->
					<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
						<CallHistory
							onOpen={(link) => {
								callsOpen = false;
								if (onOpenMessage) onOpenMessage(link);
							}}
						/>
					</div>
				</div>
			</Popover>
			<Tooltip text="New chat">
				{#snippet trigger(props)}
					<IconButton {...props} label="New chat" onclick={onNewGroup}>
						<SquarePenIcon size={16} />
					</IconButton>
				{/snippet}
			</Tooltip>
			{#if onHideSidebar}
				<Tooltip text="Hide sidebar" keys={sidebarKeys}>
					{#snippet trigger(props)}
						<IconButton {...props} label="Hide sidebar" onclick={onHideSidebar}>
							<PanelLeftIcon size={16} />
						</IconButton>
					{/snippet}
				</Tooltip>
			{/if}
		</div>
	</div>

	<!-- The search field (S-04): it opens the quick switcher. -->
	<div class="shrink-0 px-2.5 pb-2">
		<button
			type="button"
			class="bg-duvet-sb-field text-duvet-ink2 ring-duvet-sb-edge hover:text-duvet-ink flex h-8 w-full items-center gap-2 rounded-[10px] pr-1.5 pl-2.5 text-left text-[13px] ring-[0.5px] transition-colors duration-[120ms] motion-reduce:transition-none {rowFocus}"
			onclick={onOpenSwitcher}
			aria-haspopup="dialog"
			aria-keyshortcuts={shortcutLabel.startsWith("⌘") ? "Meta+K" : "Control+K"}
		>
			<SearchIcon class="size-[15px] shrink-0" />
			<span class="min-w-0 flex-1 truncate">Search or jump to…</span>
			<Kbd>{shortcutLabel}</Kbd>
		</button>
	</div>

	<!-- The Now section sits at the column's foot, right above the bottom block, and what's left of the column stays
	     between it and the rows, whose scroller grows into it. When both don't fit, the Now section takes the room the
	     rows don't need, and half of it at least; what doesn't fit scrolls in each. -->
	<div class="flex min-h-0 flex-1 flex-col" style="--rows-height: {rowsHeight}px">
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="flex flex-col gap-2 px-2 pb-3" bind:offsetHeight={rowsHeight}>
				<!-- With the open chats set to a vertical list: the focused pane's, in place of the title bar's tabs. -->
				{#if openChats}
					<section class="flex flex-col" aria-label="Open chats">
						{@render sectionHead("Open")}
						{#if openChats.tabs.length === 0}
							<p class="text-duvet-ink2 px-2.5 py-1 text-[13px]">Pick a chat or a room to open it here</p>
						{/if}
						<ul class="flex flex-col gap-px">
							{#each openChats.tabs as tab (tab.channelId)}
								{@const isActive = tab.channelId === openChats.activeChannelId && !isFriendsActive}
								{@const news = tabNews(tab, $shownUnreadRooms, $shownUnreadConversations, $shownMentionCounts)}
								{@const mentions = news.mentions}
								{@const unread = !isActive && news.unread}
								{@const title = tabTitle(tab, $conversations, $currentUser?.id)}
								<li
									class="group/open relative rounded-xl transition-colors duration-[120ms] motion-reduce:transition-none {isActive
										? 'bg-duvet-accent-tint'
										: 'hover:bg-duvet-sb-hover'} {draggedTabId === tab.channelId ? 'opacity-40' : ''}"
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
										class="flex h-11 w-full items-center gap-2.5 rounded-xl pr-8 pl-2 text-left {rowFocus}"
										aria-current={isActive ? "true" : undefined}
										data-jump
										onclick={() => openChats.onActivate(tab.channelId)}
									>
										<span class="grid size-7 shrink-0 place-items-center">
											<TabIcon {tab} size={isConversationTab(tab) ? 22 : 15} />
										</span>
										<span class="flex min-w-0 flex-1 flex-col leading-tight">
											<span
												class="truncate text-[13.5px] {isActive || unread
													? 'text-duvet-ink font-semibold'
													: 'text-duvet-ink2 font-medium'}">{title}</span
											>
											<span class="text-duvet-ink2 truncate text-[11.5px]"
												>{typingSentence($typingNow[tab.channelId]) ??
													(isConversationTab(tab) ? conversationKind(tab.channelId) : spaceNameOf(tab.spaceId))}</span
											>
										</span>
										{#if mentions && !isActive}
											<span class="group-focus-within/open:hidden group-hover/open:hidden">
												{@render mentionChip(mentions)}
											</span>
										{/if}
									</button>
									<span
										class="absolute top-1/2 right-1.5 flex -translate-y-1/2 opacity-0 group-focus-within/open:opacity-100 group-hover/open:opacity-100"
									>
										<button
											type="button"
											class={iconButtonClass("sm")}
											aria-label="Close {title}"
											onclick={() => openChats.onClose(tab.channelId)}
										>
											<XIcon class="size-3.5" />
										</button>
									</span>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				<!-- Chats (S-05): Friends first, then the chats: the pinned ones, then the others, the latest first. -->
				{#if sidebar.filter !== "spaces"}
					<section class="flex flex-col" aria-label="Chats">
						{#if sidebar.filter === "all"}{@render sectionHead("Chats")}{/if}
						<button
							type="button"
							class="flex h-11 w-full shrink-0 items-center gap-2.5 rounded-[10px] pr-2.5 pl-2 text-left text-[13.5px] transition-colors duration-[120ms] motion-reduce:transition-none {rowFocus}
							{isFriendsActive ? 'bg-duvet-accent-tint' : 'hover:bg-duvet-sb-hover'}
							{friendRequests ? 'font-semibold' : 'font-medium'}"
							aria-current={isFriendsActive ? "page" : undefined}
							data-jump
							onclick={onFriendsSelect}
						>
							<span
								class="bg-duvet-secondary-fill text-duvet-accent-text grid size-8 shrink-0 place-items-center rounded-full"
							>
								<UsersIcon class="size-4" />
							</span>
							<span class="min-w-0 flex-1 truncate">Friends</span>
							{#if friendRequests}
								<span
									class="{chip} bg-duvet-secondary-fill text-duvet-ink"
									role="img"
									aria-label={friendRequestsLabel(friendRequests)}
									title={friendRequestsLabel(friendRequests)}>{chipCount(friendRequests)}</span
								>
							{/if}
						</button>
						<DMSidebar {activeConversationId} onSelect={onConversationSelect} folded={sidebar.filter === "all"} {mac} />
					</section>
				{/if}

				<!-- Spaces (S-06): each a tree under its row. Pinned ones first, then those with news; the quiet ones under
				     their own row, which folds them. -->
				{#if sidebar.filter !== "chats"}
					<section class="group/spaces flex flex-col" aria-label="Spaces">
						<div class="flex h-[30px] items-end justify-between pr-1 pb-0.5 pl-2.5">
							<h3 class="text-duvet-ink2 text-[11.5px] font-semibold select-none">Spaces</h3>
							<Tooltip text="Join or create a Space">
								{#snippet trigger(props)}
									<IconButton
										{...props}
										size="sm"
										label="Join or create a Space"
										class="-mb-1 opacity-0 group-focus-within/spaces:opacity-100 group-hover/spaces:opacity-100"
										onclick={() => (showAddSpace = true)}
									>
										<PlusIcon size={14} />
									</IconButton>
								{/snippet}
							</Tooltip>
						</div>

						<ul class="flex flex-col">
							{#each rows as row (row.kind === "space" ? row.id : "quiet")}
								{#if row.kind === "space"}
									{@const guild = guildById.get(row.id)}
									{#if guild}{@render spaceRow(guild)}{/if}
								{:else}
									<!-- The quiet Spaces' own head, which folds them: in one place, and reading the same, whichever
									     Space is open. -->
									<li>
										<button
											type="button"
											class="text-duvet-ink2 hover:text-duvet-ink flex h-[30px] w-full items-end gap-1 rounded-[10px] px-2.5 pb-0.5 text-left text-[11.5px] font-semibold transition-colors duration-[120ms] select-none motion-reduce:transition-none {rowFocus}"
											aria-expanded={quietOpen}
											data-jump
											onclick={() => (quietOpen = !quietOpen)}
										>
											<span class="truncate">{quietSpacesLabel(row.count)}</span>
											<ChevronDownIcon
												class="mb-[3px] size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none {quietOpen
													? ''
													: '-rotate-90'}"
												aria-hidden="true"
											/>
										</button>
									</li>
								{/if}
							{/each}
						</ul>

						{#if guilds.length === 0}
							<button
								type="button"
								class="text-duvet-ink2 hover:bg-duvet-sb-hover hover:text-duvet-ink flex h-11 w-full items-center gap-2.5 rounded-[10px] px-2 text-left text-[13.5px] font-medium {rowFocus}"
								onclick={() => (showAddSpace = true)}
							>
								<span
									class="border-duvet-line text-duvet-ink2 grid size-8 shrink-0 place-items-center rounded-[9px] border border-dashed"
								>
									<PlusIcon class="size-4" />
								</span>
								Join or create a Space
							</button>
						{/if}
					</section>
				{/if}
			</div>
		</div>

		<div class="flex max-h-[max(50%,calc(100%-var(--rows-height)))] shrink-0 flex-col">
			<NowSection
				{guilds}
				{isFriendsActive}
				{activeConversationId}
				onRoomSelect={(spaceId, roomId) => onRoomSelect(spaceId, roomId, "here")}
				onConversationSelect={(conversationId) => onConversationSelect(conversationId, "here")}
				{onFriend}
				{onFriendsSelect}
			/>
		</div>
	</div>

	<!-- The sidebar's bottom (S-07), top to bottom: the playback bar, the media controls, the user's own bar, the
	     profile row, and the All · Chats · Spaces switch. Beside the folded edge, which has the user's controls, only the
	     switch shows. -->
	<div class="flex shrink-0 flex-col gap-1 px-2.5 pt-1 pb-2.5 shadow-[0_-1px_0_var(--duvet-sb-edge)]">
		{#if showUser}
			<!-- MOUNT POINT (Calls & media): the playback bar of a voice note or an audio file. It draws nothing while
			     nothing plays. -->
			<VoiceNoteBar />
			<!-- The media controls, Calls & media's (#357): outside a call, the row of the microphone (with its picker),
			     deafen and noise suppression; in a call they grow into the call panel, whose first row says where the user
			     is, with the ping and Disconnect. One block, above the user's bar. -->
			{#if $liveMedia.place || (mediaPopOut.available && mediaPopOut.out)}
				<div class="shrink-0" data-mount="media-controls">
					<MediaControls />
				</div>
			{/if}
			<ProfileControls />
			<ProfileRow />
		{/if}
		<div class="relative">
			<Segmented options={FILTERS} bind:value={sidebar.filter} label="Show in the sidebar" class="w-full" />
			<!-- A dot marks the side that isn't listed while something there is unread. -->
			{#if sidebar.filter === "spaces" && unreadChats}
				<span
					class="bg-duvet-accent pointer-events-none absolute top-1.5 left-[calc(66.666%-12px)] size-[5px] rounded-full"
					role="img"
					aria-label="Unread chats"
				></span>
			{:else if sidebar.filter === "chats" && unreadRooms}
				<span
					class="bg-duvet-accent pointer-events-none absolute top-1.5 right-[9px] size-[5px] rounded-full"
					role="img"
					aria-label="Unread rooms"
				></span>
			{/if}
		</div>
	</div>
</nav>

<AddSpaceModal bind:open={showAddSpace} />
