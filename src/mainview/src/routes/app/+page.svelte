<script lang="ts">
	import { onDestroy, onMount, untrack } from "svelte";
	import { createWebSocketConnection, loadSpaceMembers } from "$lib/api/ws/connection";
	import { markStartup, reportStartup } from "$lib/startup-timing";
	import { getElectrobunRpc } from "$lib/electrobun-rpc";
	import { get } from "svelte/store";
	import { keepSessionFresh } from "$lib/api/api";
	import FriendsView from "$lib/components/FriendsView.svelte";
	import PaneView from "$lib/components/PaneView.svelte";
	import TitleStrip from "$lib/components/TitleStrip.svelte";
	import KeyboardLayer from "$lib/components/KeyboardLayer.svelte";
	import QuickSwitcher from "$lib/components/QuickSwitcher.svelte";
	import SpaceEdge from "$lib/components/SpaceEdge.svelte";
	import SpaceNav from "$lib/components/SpaceNav.svelte";
	import VoiceChat from "$lib/components/VoiceChat.svelte";
	import { createDM } from "$lib/api/conversations";
	import { getApiError } from "$lib/api/api";
	import { layoutPrefs } from "$lib/layout-prefs.svelte";
	import { firstTextRoom, type OpenChats } from "$lib/nav";
	import { currentShell } from "$lib/platform";
	import {
		clampSidebarWidth,
		keysFor,
		SIDEBAR_MAX,
		SIDEBAR_MIN,
		mergedLeaf,
		openBeside,
		openInLeaf,
		shellShortcut,
		SHELL_KEYS,
		SIDEBAR_EDGE,
		steppedTab,
		stripHalves,
		type OpenHow,
	} from "$lib/shell-layout";
	import { appChrome } from "$lib/stores/chrome.svelte";
	import { sidebar } from "$lib/stores/sidebar.svelte";
	import {
		closeTabsIn,
		conversationTab,
		filterPaneTree,
		isConversationTab,
		tabStaysOpen,
		makeLeaf,
		makeSplit,
		removeLeaf,
		spaceLanding,
		spacesAndRooms,
		updateLeaf,
	} from "$lib/pane";
	import { hasPermission, Permission, shownRooms } from "$lib/permissions";
	import {
		activeCall,
		activeVoiceRoomId,
		conversations,
		currentUser,
		friendsReady,
		gatewaySpaces,
		jumpToMessageRequest,
		botInviteRequest,
		spaceInviteRequest,
		allSpacesReady,
	} from "$lib/stores.svelte";
	import { shownUnreadConversations, shownUnreadRooms } from "$lib/notification-marks";
	import { toast } from "$lib/stores/toast.svelte";
	import CallCard from "$lib/components/CallCard.svelte";
	import StreamWindow from "$lib/components/StreamWindow.svelte";
	import { keepVoicePeopleKnown, type VoicePlace } from "$lib/voice-place";
	import { keepWatchedStreams } from "$lib/watching";
	import BotInviteModal from "$lib/components/BotInviteModal.svelte";
	import SpaceInviteModal from "$lib/components/SpaceInviteModal.svelte";
	import ReactionsDialog from "$lib/components/ReactionsDialog.svelte";
	import BanDialog from "$lib/components/BanDialog.svelte";
	import MentionNotices from "$lib/components/MentionNotices.svelte";
	import { startSystemNotifications } from "$lib/system-notifications";
	import NotificationPermissionBar from "$lib/components/NotificationPermissionBar.svelte";
	import type { PaneNode, Tab } from "$lib/types";
	import { gatewaySpaceToGuild, gatewaySpaceToMembers } from "$lib/types";
	import { userStatusCache } from "$lib/api/ws/connection";
	import { DUVET_DOMAIN } from "$lib/common/common";
	import { isUuid, type MessageLink } from "$lib/urls";

	let botInviteOpen = $state(false);
	let botInviteId = $state("");

	function openBotInvite(id: string) {
		botInviteId = id;
		botInviteOpen = true;
		history.replaceState(null, "", window.location.pathname + window.location.search);
	}

	let spaceInviteOpen = $state(false);
	let spaceInviteCode = $state("");

	function openSpaceInvite(code: string) {
		spaceInviteCode = code;
		spaceInviteOpen = true;
	}

	$effect(() => {
		const id = $botInviteRequest;
		if (id) {
			openBotInvite(id);
			botInviteRequest.set(null);
		}
	});

	$effect(() => {
		const code = $spaceInviteRequest;
		if (code) {
			openSpaceInvite(code);
			spaceInviteRequest.set(null);
		}
	});

	onMount(() => {
		markStartup("app");
		// Check for ?bot= query param (from /invite?bot=xxx redirect)
		const urlParams = new URLSearchParams(window.location.search);
		const botParam = urlParams.get("bot");
		if (botParam) {
			// Only a bot's ID: it goes into the paths of the requests about the bot, and anyone can make this link.
			if (isUuid(botParam)) {
				// Defer opening until gateway is connected and spaces are loaded
				const unsub = friendsReady.subscribe((ready) => {
					if (ready) {
						openBotInvite(botParam);
						unsub();
					}
				});
			}
			// Clean URL
			history.replaceState(null, "", window.location.pathname);
		}

		// What notifies without the focus shows as the system's notification where there is one, and a click on it opens
		// its message as a notice's does (lib/system-notifications.ts).
		void startSystemNotifications(openMentioned);

		const session = keepSessionFresh();
		// A renewal due as the app started runs once the app is up: the socket doesn't wait for it (#281).
		const stopConnected = friendsReady.subscribe((ready) => {
			if (ready) session.connected();
		});
		// The start's last steps, the first screen and the spaces, after which it's reported, to Bun too (#280).
		const reportWhenUp = () => {
			if (!get(friendsReady) || !get(allSpacesReady)) return;
			reportStartup((marks) => void getElectrobunRpc().then((rpc) => rpc?.send.startupTimings({ marks })));
		};
		const stopShown = friendsReady.subscribe((ready) => {
			if (!ready) return;
			markStartup("shown");
			reportWhenUp();
		});
		const stopSpaces = allSpacesReady.subscribe((ready) => {
			if (!ready) return;
			markStartup("spaces");
			reportWhenUp();
		});
		let conn: ReturnType<typeof createWebSocketConnection> | null = null;
		let destroyed = false;
		void session.ready.then(() => {
			if (destroyed) return;
			markStartup("session");
			conn = createWebSocketConnection();
		});
		// The streams the user watches, through reconnects, for the stream window and the voice view (desktop#299), and the
		// names and avatars of the people in their voice.
		const stopWatched = keepWatchedStreams();
		const stopPeople = keepVoicePeopleKnown(loadSpaceMembers);
		onDestroy(() => {
			destroyed = true;
			stopConnected();
			stopShown();
			stopSpaces();
			stopWatched();
			stopPeople();
			session.stop();
			conn?.destroy();
		});
	});

	// A room the user can view shows in its category, which shows with it even when the user can't view the category.
	const guilds = $derived($gatewaySpaces.map((space) => gatewaySpaceToGuild({ ...space, rooms: shownRooms(space) })));

	let activeSpaceId = $state<string | null>(null);
	let showFriendsView = $state(true);
	let activeDMId = $state<string | null>(null);
	let showGroupModal = $state(false);
	// The panels' visibility and the spaces column's and open chats' modes live in layoutPrefs, saved as they change.
	$effect(() => {
		if (!activeSpaceId && guilds.length > 0) {
			activeSpaceId = guilds.at(0)?.id ?? null;
		}
	});
	$effect(() => {
		if (!activeSpaceId) {
			return;
		}
		void 0; // sidebar handles member loading
	});
	const activeGuild = $derived(guilds.find((g) => g.id === activeSpaceId) ?? guilds.at(0) ?? null);
	const activeSpace = $derived($gatewaySpaces.find((s) => s.id === activeSpaceId) ?? null);
	const activeMembers = $derived(activeSpace ? gatewaySpaceToMembers(activeSpace, userStatusCache) : []);

	// ── Pane tree ─────────────────────────────────────────────────────────────
	const OPEN_ROOMS_KEY = "duvet.openRooms.v1";
	const initialRootPane = makeLeaf();
	let rootPane = $state<PaneNode>(initialRootPane);
	let focusedPaneId = $state<string>(initialRootPane.id);
	let hasRestoredRooms = $state(false);

	// Save pane tree to localStorage whenever it changes
	$effect(() => {
		if (!hasRestoredRooms) return;
		localStorage.setItem(OPEN_ROOMS_KEY, JSON.stringify({ pane: rootPane, activeSpaceId: sidebarSpaceId }));
	});

	const openableTab = (spaces: typeof $gatewaySpaces) => tabStaysOpen(spaces, new Set($conversations.map((c) => c.id)));

	// Restore pane tree after all SPACE_CREATE events arrive, and the conversations (friendsReady) with them
	$effect(() => {
		if (!$allSpacesReady || !$friendsReady || hasRestoredRooms) return;
		hasRestoredRooms = true;
		try {
			const raw = localStorage.getItem(OPEN_ROOMS_KEY);
			if (!raw) return;
			const saved = JSON.parse(raw) as { pane?: PaneNode; activeSpaceId?: string | null };
			if (!saved.pane) return;
			const filtered = filterPaneTree(saved.pane, openableTab($gatewaySpaces));
			if (!filtered) return;
			rootPane = filtered;
			focusedPaneId = firstLeaf(filtered).id;
			if (saved.activeSpaceId && $gatewaySpaces.some((s) => s.id === saved.activeSpaceId)) {
				sidebarSpaceId = saved.activeSpaceId;
			}
		} catch {
			localStorage.removeItem(OPEN_ROOMS_KEY);
		}
	});

	// Sidebar selection → open in focused pane. The room can be of any space (a room of another Space's tree, the quick
	// switcher): the sidebar follows it to that space, and a room picked from the friends view leaves it. `how` is the
	// press: a click opens it in the current tab, ⌘-click in a new one, ⌥-click beside (lib/shell-layout.ts).
	function onSidebarSelect(channelId: string, spaceId: string | null = sidebarSpaceId, how: OpenHow = "here") {
		const guild = spaceId ? guilds.find((g) => g.id === spaceId) : sidebarGuild;
		const ch = guild?.channels.find((c) => c.id === channelId);
		if (!guild || !ch || ch.type === "category") return;
		// A voice room opens only for someone who can join it, as its row in the sidebar has it.
		if (ch.type === "voice") {
			const space = $gatewaySpaces.find((s) => s.id === guild.id);
			const room = space?.rooms.find((r) => r.id === ch.id);
			if (!space || !room || !hasPermission(space, room, Permission.JoinVoice)) return;
		}
		activeSpaceId = guild.id;
		openTab(
			{
				channelId: ch.id,
				channelName: ch.name,
				channelType: ch.type,
				spaceId: guild.id,
			},
			how,
		);
	}

	// Opens a chat in the focused pane, or shows it when it's open there already (never a duplicate), and leaves the
	// friends view. A click puts it in the current tab, ⌘-click or a middle click in a new tab after it, and ⌥-click in
	// the pane beside, which a lone pane gets for it (BRIEF, "Tabs and panes"). From the Friends page, which stands in
	// the strip as a tab of its own, a click opens a tab rather than take over the one the page was hiding.
	function openTab(tab: Tab, how: OpenHow = "here") {
		const fromFriends = showFriendsView;
		if (showFriendsView) {
			showFriendsView = false;
			activeDMId = null;
		}
		if (how === "beside") {
			const next = openBeside(rootPane, focusedPaneId, tab);
			rootPane = next.root;
			focusedPaneId = next.focusedId;
		} else {
			const into = fromFriends ? "tab" : how;
			rootPane = updateLeaf(rootPane, focusedPaneId, (leaf) => openInLeaf(leaf, tab, into));
		}
		syncSidebarToLeaf(rootPane, focusedPaneId);
	}

	// A conversation (a DM or a group) opens as a tab, as a room does: in the pane that has it open already, or else
	// in the focused one.
	function openConversationTab(conversationId: string, how: OpenHow = "here") {
		const conv = $conversations.find((c) => c.id === conversationId);
		if (!conv) return;
		const holder = leafWithTab(rootPane, conversationId);
		if (holder) {
			focusedPaneId = holder.id;
			how = "here";
		}
		openTab(conversationTab(conv, $currentUser?.id), how);
	}

	// The stream window's click: back to the view of its voice room or call (desktop#299).
	function openVoicePlace(place: VoicePlace) {
		if (place.spaceId) onSidebarSelect(place.id, place.spaceId);
		else openConversationTab(place.id);
	}

	function leafWithTab(node: PaneNode, channelId: string): import("$lib/types").PaneLeaf | null {
		if (node.kind === "leaf") return node.tabs.some((t) => t.channelId === channelId) ? node : null;
		return leafWithTab(node.a, channelId) ?? leafWithTab(node.b, channelId);
	}

	// A jump to a conversation's message (its pins, a search, a link to it) shows its tab; the request stays for its
	// ConversationView, which jumps once it's on screen.
	let lastConversationJumpId: string | null = null;
	$effect(() => {
		const req = $jumpToMessageRequest;
		if (!req?.conversationId || req.id === lastConversationJumpId || !hasRestoredRooms) return;
		lastConversationJumpId = req.id;
		const conversationId = req.conversationId;
		untrack(() => openConversationTab(conversationId));
	});

	// A mention's notice opens its message, and so does a result of the friends view's search everywhere. A room's opens
	// in the focused pane, which the friends view would hide; a conversation's tab opens as any jump to it does (above).
	function openMentioned(link: MessageLink) {
		if (!link.conversationId && showFriendsView) {
			showFriendsView = false;
			activeDMId = null;
		}
		jumpToMessageRequest.set({ id: crypto.randomUUID(), ...link });
	}

	// Derive the active channel of the focused pane for sidebar highlight
	function findLeaf(node: PaneNode, id: string): import("$lib/types").PaneLeaf | null {
		if (node.kind === "leaf") return node.id === id ? node : null;
		return findLeaf(node.a, id) ?? findLeaf(node.b, id);
	}

	function firstLeaf(node: PaneNode): import("$lib/types").PaneLeaf {
		if (node.kind === "leaf") return node;
		return firstLeaf(node.a);
	}

	const focusedLeaf = $derived(findLeaf(rootPane, focusedPaneId));
	const sidebarActiveChannelId = $derived(focusedLeaf?.activeChannelId ?? null);
	// The conversation the focused pane shows, when its active tab is one.
	const focusedConversationId = $derived.by(() => {
		const tab = focusedLeaf?.tabs.find((t) => t.channelId === focusedLeaf.activeChannelId);
		return tab && isConversationTab(tab) ? tab.channelId : null;
	});

	// ── The focused pane's tabs, as the spaces column and its edge list them ──
	function activateTab(channelId: string) {
		if (showFriendsView) {
			showFriendsView = false;
			activeDMId = null;
		}
		handlePaneUpdate(updateLeaf(rootPane, focusedPaneId, (leaf) => ({ ...leaf, activeChannelId: channelId })));
	}

	// A tab's close button, and its menu's Close others, to the left, to the right and all: a pane of a split that
	// loses its last tab goes, a lone one stays empty.
	function closeTabs(channelIds: string[]) {
		const leaf = findLeaf(rootPane, focusedPaneId);
		if (!leaf) return;
		const { tabs, activeChannelId } = closeTabsIn(leaf, channelIds);
		if (tabs.length === 0 && rootPane.kind === "split") {
			handlePaneUpdate(removeLeaf(rootPane, leaf.id) ?? makeLeaf());
			return;
		}
		handlePaneUpdate(updateLeaf(rootPane, leaf.id, (l) => ({ ...l, tabs, activeChannelId })));
	}

	const closeTab = (channelId: string) => closeTabs([channelId]);

	function reorderTabs(tabs: Tab[]) {
		rootPane = updateLeaf(rootPane, focusedPaneId, (leaf) => ({ ...leaf, tabs }));
	}

	// A room or a conversation dropped between two of the strip's tabs: a tab there, or the one it has already.
	function dropInStrip(tab: Tab, at: number | null) {
		if (showFriendsView) {
			showFriendsView = false;
			activeDMId = null;
		}
		handlePaneUpdate(
			updateLeaf(rootPane, focusedPaneId, (leaf) => {
				if (leaf.tabs.some((t) => t.channelId === tab.channelId)) return { ...leaf, activeChannelId: tab.channelId };
				const tabs = [...leaf.tabs];
				tabs.splice(at ?? tabs.length, 0, tab);
				return { ...leaf, tabs, activeChannelId: tab.channelId };
			}),
		);
	}

	// Two of the focused pane's tabs side by side (a tab's Split with, or one dropped on another's middle): the first
	// stays where it is, shown, and the second moves to a new pane on its right.
	function splitTabs(keepId: string, moveId: string) {
		const moved = focusedLeaf?.tabs.find((t) => t.channelId === moveId);
		if (!moved || keepId === moveId) return;
		rootPane = updateLeaf(rootPane, focusedPaneId, (leaf) => ({ ...leaf, activeChannelId: keepId }));
		moveTabBetweenLeaves(moved, focusedPaneId, focusedPaneId, "right");
	}

	// Separate split view: the split's panes become tabs of the focused one.
	function separateSplit() {
		const merged = mergedLeaf(rootPane, focusedPaneId);
		rootPane = merged;
		focusedPaneId = merged.id;
		syncSidebarToLeaf(merged, merged.id);
	}

	const focusedChats: OpenChats = $derived({
		tabs: focusedLeaf?.tabs ?? [],
		activeChannelId: sidebarActiveChannelId,
		onActivate: activateTab,
		onClose: closeTab,
		onReorder: reorderTabs,
	});

	// ── The spaces column: fixed, or folded to an edge it shows from on hover ──
	// Collapsing it (the panes' toggle) folds it to the edge too.
	const navDocked = $derived(layoutPrefs.spacesColumn === "fixed" && layoutPrefs.showChannelsSidebar);
	// Hide sidebar and Show sidebar: only while the column is Fixed. One set to Auto-hide stays folded to its edge.
	const canToggleSidebar = $derived(layoutPrefs.spacesColumn === "fixed");
	function toggleSidebar() {
		layoutPrefs.showChannelsSidebar = !layoutPrefs.showChannelsSidebar;
	}

	// Its width, dragged by its right edge between 232 and 380 px, and remembered (S-09). While it's dragged the width
	// is the drag's; it is saved as the drag ends.
	let dragWidth = $state<number | null>(null);
	const sidebarWidth = $derived(dragWidth ?? sidebar.width);
	let resizeFrom: { x: number; width: number } | null = null;

	function startSidebarResize(e: PointerEvent) {
		if (e.button !== 0) return;
		e.preventDefault();
		resizeFrom = { x: e.clientX, width: sidebar.width };
		dragWidth = sidebar.width;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function moveSidebarResize(e: PointerEvent) {
		if (resizeFrom) dragWidth = clampSidebarWidth(resizeFrom.width + e.clientX - resizeFrom.x);
	}

	function endSidebarResize() {
		if (dragWidth !== null) sidebar.width = dragWidth;
		resizeFrom = null;
		dragWidth = null;
	}

	// The same edge from the keyboard: the arrows move it 16 px at a time.
	function keySidebarResize(e: KeyboardEvent) {
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
		e.preventDefault();
		sidebar.width = clampSidebarWidth(sidebar.width + (e.key === "ArrowRight" ? 16 : -16));
	}
	let navRevealed = $state(false);
	let navHovered = false;
	let navWrapEl = $state<HTMLElement | null>(null);
	let navHideTimer: ReturnType<typeof setTimeout> | undefined;

	function revealNav() {
		clearTimeout(navHideTimer);
		navRevealed = true;
	}

	function scheduleNavHide() {
		clearTimeout(navHideTimer);
		navHideTimer = setTimeout(hideNavUnlessHeld, 350);
	}

	// It stays while the pointer is on it, the keyboard's focus is in it, or a menu or dialog opened from it is open
	// (those are outside it, in portals): it checks again shortly until none is.
	function hideNavUnlessHeld() {
		if (navHovered) return;
		const held =
			!!navWrapEl?.querySelector(":focus-visible") ||
			!!document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"]');
		if (held) {
			scheduleNavHide();
			return;
		}
		navRevealed = false;
	}

	$effect(() => {
		if (navDocked) {
			clearTimeout(navHideTimer);
			navRevealed = false;
		}
	});
	onDestroy(() => clearTimeout(navHideTimer));

	// ── Quick switcher: Cmd+K on macOS, Ctrl+K elsewhere ─────────────────────
	let switcherOpen = $state(false);
	// How the switcher's pick opens: in the current tab, or in a new one (the strip's New tab), or beside (a tab's
	// Split with a chat). It goes back to the current tab as the switcher closes.
	let switcherHow = $state<OpenHow>("here");
	function openSwitcher(how: OpenHow = "here") {
		switcherHow = how;
		switcherOpen = true;
	}
	$effect(() => {
		if (!switcherOpen) switcherHow = "here";
	});

	// Which system's keys and chrome: the platform switch's answer (lib/platform.ts), in the app and in a browser.
	const shell = currentShell();
	const isMac = shell.os === "mac";
	const desktopApp = shell.chrome !== "web";
	const switcherShortcut = keysFor(isMac, SHELL_KEYS.switcher);

	// The shell's own shortcuts (lib/shell-layout.ts: shellShortcut), not over a dialog or a menu, as the others.
	function runShellShortcut(e: KeyboardEvent): boolean {
		const command = shellShortcut(e, { mac: isMac, desktop: desktopApp });
		if (!command || !$currentUser || !$friendsReady) return false;
		if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return false;
		e.preventDefault();
		if (command === "toggle-sidebar") {
			if (canToggleSidebar) toggleSidebar();
		} else if (command === "new-tab") {
			openSwitcher("tab");
		} else if (command === "close-tab") {
			if (!showFriendsView && sidebarActiveChannelId) closeTab(sidebarActiveChannelId);
		} else {
			const next = steppedTab(
				focusedTabIds,
				showFriendsView ? null : sidebarActiveChannelId,
				command === "next-tab" ? 1 : -1,
			);
			if (next) activateTab(next);
		}
		return true;
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (runShellShortcut(e)) return;
		if (e.key.toLowerCase() !== "k" || e.altKey || e.shiftKey) return;
		if (isMac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return;
		if (!$currentUser || !$friendsReady) return;
		// Not over another dialog (settings, a confirmation): it closes first.
		if (!switcherOpen && document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
		e.preventDefault();
		switcherOpen = !switcherOpen;
	}

	// ── The keyboard: the chats it moves between, and where the next unread one is ──
	const focusedTabIds = $derived(focusedChats.tabs.map((t) => t.channelId));
	// The conversations first, then each Space's rooms, as the spaces column has them.
	const unreadOrder = $derived([
		...$conversations.map((c) => c.id),
		...guilds.flatMap((g) => g.channels.map((c) => c.id)),
	]);
	const unreadChats = $derived(new Set([...$shownUnreadConversations, ...$shownUnreadRooms]));

	function openChat(id: string) {
		if ($conversations.some((c) => c.id === id)) {
			openConversationTab(id);
			return;
		}
		const guild = guilds.find((g) => g.channels.some((c) => c.id === id));
		if (guild) onSidebarSelect(id, guild.id);
	}

	// A friend picked in the switcher, or in the spaces column's online friends, without a conversation yet: one starts,
	// as the friends list's message button does.
	async function openFriendDM(userId: string, how: OpenHow = "here") {
		try {
			const conv = await createDM(userId);
			conversations.update((list) => (list.some((c) => c.id === conv.id) ? list : [conv, ...list]));
			openConversationTab(conv.id, how);
		} catch (err) {
			toast(getApiError(err, "Failed to open the conversation"), "error");
		}
	}

	// ── Sidebar space tracking (imperative to avoid reactive cycles) ─────────
	let sidebarSpaceId = $state<string | null>(null);
	// Initialise once guilds arrive

	$effect(() => {
		if (!sidebarSpaceId && guilds.length > 0) {
			sidebarSpaceId = guilds.at(0)?.id ?? null;
		}
	});

	const sidebarGuild = $derived(guilds.find((g) => g.id === sidebarSpaceId) ?? activeGuild);

	// Each Space's room whose tab the focused pane showed last, which a click on the Space goes back to (spaceLanding).
	// Only that click reads it, so it isn't state, and it lasts while the app is open.
	const lastRoomBySpace = new Map<string, string>();

	function syncSidebarToLeaf(node: PaneNode, leafId: string) {
		const leaf = findLeaf(node, leafId);
		const tab = leaf?.tabs.find((t) => t.channelId === leaf?.activeChannelId);
		// Fall back to activeSpaceId when no tab is active (e.g. all tabs closed). A conversation's tab has no space:
		// the sidebar stays where it is.
		if (tab && isConversationTab(tab)) return;
		if (tab) lastRoomBySpace.set(tab.spaceId, tab.channelId);
		sidebarSpaceId = tab?.spaceId ?? activeSpaceId ?? sidebarSpaceId;
	}

	function handlePaneUpdate(n: PaneNode) {
		rootPane = n;
		// If the focused pane was removed (e.g. user closed a split pane),
		// auto-focus the first surviving leaf so the sidebar updates correctly.
		if (!findLeaf(n, focusedPaneId)) {
			const surviving = firstLeaf(n);
			focusedPaneId = surviving.id;
			syncSidebarToLeaf(n, surviving.id);
		} else {
			// Sync sidebar after tree is updated so we always read the new activeChannelId
			syncSidebarToLeaf(n, focusedPaneId);
		}
	}

	function handleFocusChange(id: string) {
		focusedPaneId = id;
		// Sync using the current (already up-to-date) rootPane
		syncSidebarToLeaf(rootPane, id);
	}

	// The spaces and their rooms there were when they had last all arrived.
	let knownIds = new Set<string>();
	// A space that goes (deleted, or left) stops being the one shown, and takes its tabs with it, as a restore
	// leaves them out; so does a room that goes (deleted, or taken from the user). Not while a new gateway session's
	// spaces are arriving, when the list is short for a moment.
	$effect(() => {
		if (!$allSpacesReady) return;
		const spaces = $gatewaySpaces;
		const { ids, gone } = spacesAndRooms(knownIds, spaces);
		knownIds = ids;
		if (!gone) return;
		untrack(() => {
			if (activeSpaceId && !ids.has(activeSpaceId)) activeSpaceId = null;
			if (sidebarSpaceId && !ids.has(sidebarSpaceId)) sidebarSpaceId = null;
			if (hasRestoredRooms) handlePaneUpdate(filterPaneTree(rootPane, openableTab(spaces)) ?? makeLeaf());
		});
	});

	// The conversations there were when they had last loaded. One that goes (the user left the group, or was removed)
	// takes its tabs with it, as a space does.
	let knownConversationIds = new Set<string>();
	$effect(() => {
		if (!$friendsReady) return;
		const ids = new Set($conversations.map((c) => c.id));
		const gone = [...knownConversationIds].some((id) => !ids.has(id));
		knownConversationIds = ids;
		if (!gone) return;
		untrack(() => {
			if (hasRestoredRooms) handlePaneUpdate(filterPaneTree(rootPane, openableTab($gatewaySpaces)) ?? makeLeaf());
		});
	});

	// A click on a Space (its row in the column, its icon on the folded edge, Ctrl+K) takes the user to it: its tab used
	// last or another of its tabs, focusing the pane that has it, or else its first text room, opened in the focused
	// pane (spaceLanding). A Space without a text room only shows its rooms in the column.
	function handleGuildSelect(id: string, how: OpenHow = "here") {
		activeSpaceId = id;
		sidebarSpaceId = id;
		showFriendsView = false;
		activeDMId = null;
		const guild = guilds.find((g) => g.id === id);
		if (!guild) return;
		const firstRoom = firstTextRoom(guild.channels)?.id ?? null;
		const landing = spaceLanding(rootPane, focusedPaneId, id, lastRoomBySpace.get(id), firstRoom);
		if (landing?.kind === "tab") {
			focusedPaneId = landing.leafId;
			activateTab(landing.channelId);
		} else if (landing?.kind === "room") {
			onSidebarSelect(landing.channelId, id, how);
		}
	}

	// The Friends button always opens the friends list, from an open DM or group too.
	function handleFriendsSelect() {
		showFriendsView = true;
		activeSpaceId = null;
		activeDMId = null;
	}

	// When leaving voice, switch active tab away from the voice channel
	// (keep the tab so the user can rejoin; just navigate to the last text tab)
	function mapAllLeaves(node: PaneNode, fn: (l: import("$lib/types").PaneLeaf) => PaneNode): PaneNode {
		if (node.kind === "leaf") return fn(node);
		return {
			...node,
			a: mapAllLeaves(node.a, fn),
			b: mapAllLeaves(node.b, fn),
		};
	}

	function replaceLeaf(
		node: PaneNode,
		leafId: string,
		replacer: (leaf: import("$lib/types").PaneLeaf) => PaneNode,
	): PaneNode {
		if (node.kind === "leaf") {
			return node.id === leafId ? replacer(node) : node;
		}
		return {
			...node,
			a: replaceLeaf(node.a, leafId, replacer),
			b: replaceLeaf(node.b, leafId, replacer),
		};
	}

	function moveTabBetweenLeaves(
		tab: Tab,
		sourceLeafId: string,
		targetLeafId: string,
		zone: "bottom" | "right" | "left" | "top" | null,
	) {
		if (sourceLeafId === targetLeafId && zone === null) {
			return;
		}

		let next = updateLeaf(rootPane, sourceLeafId, (leaf) => {
			const idx = leaf.tabs.findIndex((t) => t.channelId === tab.channelId);
			if (idx === -1) {
				return leaf;
			}
			const tabs = leaf.tabs.filter((t) => t.channelId !== tab.channelId);
			const activeChannelId =
				leaf.activeChannelId === tab.channelId
					? ((tabs[idx] ?? tabs[idx - 1])?.channelId ?? null)
					: leaf.activeChannelId;
			return { ...leaf, tabs, activeChannelId };
		});

		const sourceLeaf = findLeaf(next, sourceLeafId);
		if (sourceLeaf && sourceLeaf.tabs.length === 0 && next.kind === "split") {
			next = removeLeaf(next, sourceLeafId) ?? makeLeaf();
		}

		if (zone === null) {
			next = updateLeaf(next, targetLeafId, (leaf) => {
				if (leaf.tabs.some((t) => t.channelId === tab.channelId)) {
					return { ...leaf, activeChannelId: tab.channelId };
				}
				return {
					...leaf,
					tabs: [...leaf.tabs, tab],
					activeChannelId: tab.channelId,
				};
			});
			rootPane = next;
			focusedPaneId = targetLeafId;
			syncSidebarToLeaf(next, targetLeafId);
			return;
		}

		let newLeafId = "";
		next = replaceLeaf(next, targetLeafId, (targetLeaf) => {
			const newLeaf = makeLeaf([tab], tab.channelId);
			newLeafId = newLeaf.id;
			if (zone === "left") return makeSplit(newLeaf, targetLeaf, "h");
			if (zone === "right") return makeSplit(targetLeaf, newLeaf, "h");
			if (zone === "top") return makeSplit(newLeaf, targetLeaf, "v");
			return makeSplit(targetLeaf, newLeaf, "v");
		});

		rootPane = next;
		focusedPaneId = newLeafId || targetLeafId;
		syncSidebarToLeaf(next, focusedPaneId);
	}

	// The app's shell has its own title line (the sidebar's header and the tab strip): the layout's slim title bar
	// stays away while it is up (Header.svelte).
	$effect(() => {
		appChrome.shellUp = !!$currentUser && $friendsReady;
		return () => {
			appChrome.shellUp = false;
		};
	});

	// What the title bar's strip shows: the focused pane's tabs, and in a split each pane's chat as one joined tab.
	// Nothing when the open chats are listed in the sidebar instead (layoutPrefs.openChats).
	const stripTabs = $derived(
		layoutPrefs.openChats === "tabs"
			? {
					tabs: focusedChats.tabs,
					activeTabId: sidebarActiveChannelId,
					leafId: focusedPaneId,
					halves: stripHalves(rootPane, focusedPaneId),
					friendsActive: showFriendsView,
					closeKeys: desktopApp ? keysFor(isMac, SHELL_KEYS.closeTab) : "Ctrl W",
					onSelect: activateTab,
					onClose: closeTabs,
					onReorder: reorderTabs,
					onChannelDrop: dropInStrip,
					onJoin: (tab: Tab) => openTab(tab, "beside"),
					onFocusHalf: handleFocusChange,
					onSeparate: rootPane.kind === "split" ? separateSplit : null,
					onSplitWith: splitTabs,
					onSplitWithChat: () => openSwitcher("beside"),
				}
			: null,
	);

	let friendsViewEverShown = $state(true);
	$effect(() => {
		if (showFriendsView) friendsViewEverShown = true;
	});

	const globalVoiceRoom = $derived(
		$activeVoiceRoomId
			? ($gatewaySpaces.flatMap((s) => s.rooms).find((r) => r.id === $activeVoiceRoomId) ?? null)
			: null,
	);
	const isCallVoice = $derived(
		$activeCall?.state === "connected" && $activeVoiceRoomId === $activeCall?.conversationId,
	);

	let prevVoiceRoomId: string | null = null;

	$effect(() => {
		const cur = $activeVoiceRoomId;
		if (prevVoiceRoomId && !cur) {
			const leftRoom = prevVoiceRoomId;
			rootPane = mapAllLeaves(rootPane, (leaf) => {
				if (leaf.activeChannelId !== leftRoom) return leaf;
				// Switch to the last non-voice tab; keep the voice tab in the list
				const prev = [...leaf.tabs].reverse().find((t) => t.channelId !== leftRoom);
				return prev ? { ...leaf, activeChannelId: prev.channelId } : leaf;
			});
		}
		prevVoiceRoomId = cur;
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if !$currentUser || !$friendsReady}
	<div class="bg-duvet-bg flex h-full items-center justify-center">
		<div class="flex flex-col items-center gap-4">
			<svg
				class="text-duvet-ink2 size-8 animate-spin"
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
			>
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
				<path
					class="opacity-75"
					fill="currentColor"
					d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
				></path>
			</svg>
			<span class="text-duvet-ink2 text-sm font-medium">Connecting…</span>
		</div>
	</div>
{:else}
	<!-- The shell (#357): one grid. Its top row is the window's title line, shared by the sidebar's header and the tab
	     strip; the sidebar takes the first column, top to bottom, and the chat the rest. With the sidebar folded, the
	     strip is the whole title line and the folded edge sits under it; the column then shows over the chat, so the
	     chat doesn't move. The same column is kept either way, with what's open in it. -->
	<div
		class="bg-duvet-bg text-duvet-ink grid h-full grid-rows-[52px_minmax(0,1fr)] overflow-hidden {dragWidth !== null
			? 'cursor-col-resize select-none'
			: ''}"
		style="grid-template-columns: {navDocked ? sidebarWidth : SIDEBAR_EDGE}px minmax(0, 1fr)"
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			bind:this={navWrapEl}
			class="relative z-40 col-start-1 flex min-h-0 min-w-0 {navDocked ? 'row-span-2 row-start-1' : 'row-start-2'}"
			onpointerenter={() => {
				if (navDocked) return;
				navHovered = true;
				revealNav();
			}}
			onpointerleave={() => {
				if (navDocked) return;
				navHovered = false;
				scheduleNavHide();
			}}
			onfocusin={() => !navDocked && revealNav()}
			onfocusout={() => !navDocked && scheduleNavHide()}
		>
			{#if !navDocked}
				<SpaceEdge
					{guilds}
					selectedSpaceId={showFriendsView ? null : sidebarSpaceId}
					isFriendsActive={showFriendsView}
					openChats={focusedChats}
					onSpaceSelect={handleGuildSelect}
					onFriendsSelect={handleFriendsSelect}
				/>
			{/if}
			<!-- Folded, the column slides out from under the edge (which stays on top) and back under it, fading as it
				 goes; its visibility flips at the start of the reveal and the end of the hide. -->
			<div
				class={navDocked
					? "h-full w-full min-w-0"
					: `shadow-duvet-float absolute top-0 left-full h-full overflow-hidden rounded-r-[18px] transition-[opacity,translate,visibility] duration-200 motion-reduce:transition-none ${navRevealed ? "visible translate-x-0 opacity-100 ease-out" : "invisible -translate-x-full opacity-0 ease-in"}`}
				style={navDocked ? undefined : `width: ${sidebar.width}px`}
				inert={!navDocked && !navRevealed}
			>
				<SpaceNav
					{guilds}
					selectedSpaceId={sidebarGuild?.id ?? null}
					activeChannelId={sidebarActiveChannelId}
					isFriendsActive={showFriendsView}
					activeConversationId={showFriendsView ? null : focusedConversationId}
					openChats={layoutPrefs.openChats === "vertical" ? focusedChats : null}
					shortcutLabel={switcherShortcut}
					showUser={navDocked}
					onHideSidebar={navDocked && canToggleSidebar ? toggleSidebar : null}
					sidebarKeys={keysFor(isMac, SHELL_KEYS.sidebar)}
					onOpenMessage={openMentioned}
					onSpaceSelect={handleGuildSelect}
					onRoomSelect={(spaceId, roomId, how) => onSidebarSelect(roomId, spaceId, how)}
					onFriendsSelect={handleFriendsSelect}
					onConversationSelect={openConversationTab}
					onNewGroup={() => {
						showGroupModal = true;
					}}
					onOpenSwitcher={() => openSwitcher()}
					onFriend={(userId) => void openFriendDM(userId)}
				/>
			</div>
			{#if navDocked}
				<!-- The sidebar's right edge resizes it. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
				<div
					class="hover:bg-duvet-accent-tint focus-visible:bg-duvet-accent-tint absolute inset-y-0 -right-[3px] z-10 w-1.5 cursor-col-resize touch-none transition-colors duration-150 outline-none motion-reduce:transition-none {dragWidth !==
					null
						? 'bg-duvet-accent-tint'
						: ''}"
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize the sidebar"
					aria-valuemin={SIDEBAR_MIN}
					aria-valuemax={SIDEBAR_MAX}
					aria-valuenow={sidebarWidth}
					tabindex="0"
					onpointerdown={startSidebarResize}
					onpointermove={moveSidebarResize}
					onpointerup={endSidebarResize}
					onpointercancel={endSidebarResize}
					onkeydown={keySidebarResize}
				></div>
			{/if}
		</div>

		<TitleStrip
			class="row-start-1 {navDocked ? 'border-duvet-line col-start-2 border-l' : 'col-span-2 col-start-1'}"
			lead={!navDocked}
			onShowSidebar={!navDocked && canToggleSidebar ? toggleSidebar : null}
			sidebarKeys={keysFor(isMac, SHELL_KEYS.sidebar)}
			tabBar={stripTabs}
			onNewTab={() => openSwitcher("tab")}
			newTabKeys={desktopApp ? keysFor(isMac, SHELL_KEYS.newTab) : undefined}
		/>

		<div class="border-duvet-line col-start-2 row-start-2 flex min-h-0 min-w-0 border-l">
			<div class="bg-duvet-bg relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{#if friendsViewEverShown}
					<div class="flex min-h-0 flex-1 flex-col {showFriendsView ? '' : 'hidden'}">
						<FriendsView
							bind:activeConversationId={activeDMId}
							bind:showGroupModal
							onOpenConversation={openConversationTab}
							onOpenMessage={openMentioned}
						/>
					</div>
				{/if}
				<div class="flex min-h-0 flex-1 flex-col {showFriendsView ? 'hidden' : ''}">
					<PaneView
						node={rootPane}
						onUpdate={handlePaneUpdate}
						onMoveTab={moveTabBetweenLeaves}
						onClose={null}
						guild={activeGuild}
						spaceId={activeSpaceId}
						space={activeSpace}
						members={activeMembers}
						{focusedPaneId}
						onFocus={handleFocusChange}
						isActive={!showFriendsView}
					/>
				</div>
			</div>
			<!-- Nothing is docked beside the chat (#357): a room's members open from the faces in its pane's bar
			     (MembersButton), which load the Space's first page of members themselves; a conversation's from its own. -->
		</div>
	</div>
{/if}

<!-- Global VoiceChat: mounted outside all navigation so audio never cuts. It stays while a new gateway session's
     spaces load, which have no rooms until then, and joins its room again; it goes if the room isn't among them. -->
{#if $activeVoiceRoomId && (globalVoiceRoom || isCallVoice || !$allSpacesReady)}
	{#key $activeVoiceRoomId}
		<div class="hidden" aria-hidden="true">
			<VoiceChat channelId={$activeVoiceRoomId} />
		</div>
	{/key}
{/if}

<!-- Global call UI: the card of a call ringing here or placed from here, in the bottom right corner -->
{#if $activeCall}
	<CallCard onOpen={openConversationTab} />
{/if}

<!-- A stream shared or watched, while its room's or call's view isn't on screen. Only once the app is up: a READY
     empties the panes, and it would show over the loading screen until they're back. -->
{#if $currentUser && $friendsReady}
	<StreamWindow onOpen={openVoicePlace} />
{/if}

{#if $currentUser && $friendsReady}
	<KeyboardLayer
		{isMac}
		tabs={focusedTabIds}
		activeId={showFriendsView ? null : sidebarActiveChannelId}
		onActivate={activateTab}
		{unreadOrder}
		unread={unreadChats}
		onOpenChat={openChat}
	/>
{/if}

<!-- Its pick opens in the current tab; from the strip's New tab in a new one, from Split with a chat beside. -->
<QuickSwitcher
	bind:open={switcherOpen}
	onSpace={(spaceId) => handleGuildSelect(spaceId, switcherHow)}
	onRoom={(spaceId, roomId) => onSidebarSelect(roomId, spaceId, switcherHow)}
	onConversation={(conversationId) => openConversationTab(conversationId, switcherHow)}
	onFriend={(userId) => void openFriendDM(userId, switcherHow)}
/>

<BotInviteModal bind:open={botInviteOpen} bind:botUserId={botInviteId} />
<SpaceInviteModal bind:open={spaceInviteOpen} bind:inviteCode={spaceInviteCode} />
<ReactionsDialog />
<BanDialog />
{#if $currentUser && $friendsReady}
	<MentionNotices onOpen={openMentioned} />
	<NotificationPermissionBar />
{/if}
