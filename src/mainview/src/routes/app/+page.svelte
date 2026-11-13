<script lang="ts">
	import { onDestroy, onMount, untrack } from "svelte";
	import { createWebSocketConnection } from "$lib/api/ws/connection";
	import { startCodeHighlighting } from "$lib/markdown";
	import { keepSessionFresh } from "$lib/api/api";
	import FriendsView from "$lib/components/FriendsView.svelte";
	import GuildMemberSidebar from "$lib/components/GuildMemberSidebar.svelte";
	import { spaceMembers } from "$lib/components/MemberList.svelte";
	import PaneView from "$lib/components/PaneView.svelte";
	import KeyboardLayer from "$lib/components/KeyboardLayer.svelte";
	import QuickSwitcher from "$lib/components/QuickSwitcher.svelte";
	import SpaceEdge from "$lib/components/SpaceEdge.svelte";
	import SpaceNav from "$lib/components/SpaceNav.svelte";
	import VoiceChat from "$lib/components/VoiceChat.svelte";
	import { createDM } from "$lib/api/conversations";
	import { getApiError } from "$lib/api/api";
	import { layoutPrefs } from "$lib/layout-prefs.svelte";
	import { membersColumnOpen, onlineCount } from "$lib/members";
	import type { OpenChats } from "$lib/nav";
	import {
		closeTabsIn,
		conversationTab,
		filterPaneTree,
		isConversationTab,
		tabStaysOpen,
		makeLeaf,
		makeSplit,
		removeLeaf,
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
	import CallModal from "$lib/components/CallModal.svelte";
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
		let conn: ReturnType<typeof createWebSocketConnection> | null = null;
		let destroyed = false;
		void session.ready.then(() => {
			if (destroyed) return;
			conn = createWebSocketConnection();
			// Shiki's highlighter (code blocks) is made now, while the socket waits on the network, rather than as the page
			// loaded, before it could open (#285).
			startCodeHighlighting();
		});
		onDestroy(() => {
			destroyed = true;
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

	// Sidebar selection → open in focused pane. The room can be of any space (an unread room under another space's
	// row, the quick switcher): the sidebar follows it to that space, and a room picked from the friends view leaves it.
	function onSidebarSelect(channelId: string, spaceId: string | null = sidebarSpaceId) {
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
		openInFocusedPane({
			channelId: ch.id,
			channelName: ch.name,
			channelType: ch.type,
			spaceId: guild.id,
		});
	}

	// Opens a tab in the focused pane, or shows it when it's open there already, and leaves the friends view.
	function openInFocusedPane(tab: Tab) {
		if (showFriendsView) {
			showFriendsView = false;
			activeDMId = null;
		}
		rootPane = updateLeaf(rootPane, focusedPaneId, (leaf) => {
			const tabs = leaf.tabs.some((t) => t.channelId === tab.channelId) ? leaf.tabs : [...leaf.tabs, tab];
			return { ...leaf, tabs, activeChannelId: tab.channelId };
		});
		syncSidebarToLeaf(rootPane, focusedPaneId);
	}

	// A conversation (a DM or a group) opens as a tab, as a room does: in the pane that has it open already, or else
	// in the focused one.
	function openConversationTab(conversationId: string) {
		const conv = $conversations.find((c) => c.id === conversationId);
		if (!conv) return;
		const holder = leafWithTab(rootPane, conversationId);
		if (holder) focusedPaneId = holder.id;
		openInFocusedPane(conversationTab(conv, $currentUser?.id));
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

	// As a tab's close button in a pane: a pane of a split that loses its last tab goes, a lone one stays empty.
	function closeTab(channelId: string) {
		const leaf = findLeaf(rootPane, focusedPaneId);
		if (!leaf) return;
		const { tabs, activeChannelId } = closeTabsIn(leaf, [channelId]);
		if (tabs.length === 0 && rootPane.kind === "split") {
			handlePaneUpdate(removeLeaf(rootPane, leaf.id) ?? makeLeaf());
			return;
		}
		handlePaneUpdate(updateLeaf(rootPane, leaf.id, (l) => ({ ...l, tabs, activeChannelId })));
	}

	function reorderTabs(tabs: Tab[]) {
		rootPane = updateLeaf(rootPane, focusedPaneId, (leaf) => ({ ...leaf, tabs }));
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
	const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
	const switcherShortcut = isMac ? "⌘K" : "Ctrl K";

	function handleWindowKeydown(e: KeyboardEvent) {
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
	async function openFriendDM(userId: string) {
		try {
			const conv = await createDM(userId);
			conversations.update((list) => (list.some((c) => c.id === conv.id) ? list : [conv, ...list]));
			openConversationTab(conv.id);
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
	const memberSidebarSpaceId = $derived(sidebarSpaceId);
	const memberSidebarSpace = $derived($gatewaySpaces.find((s) => s.id === memberSidebarSpaceId) ?? null);
	// The members column opens by itself in a busy room, unless the user opened or closed it.
	const membersColumnIsOpen = $derived(
		membersColumnOpen(layoutPrefs.membersColumn, onlineCount(spaceMembers(memberSidebarSpace))),
	);

	function syncSidebarToLeaf(node: PaneNode, leafId: string) {
		const leaf = findLeaf(node, leafId);
		const tab = leaf?.tabs.find((t) => t.channelId === leaf?.activeChannelId);
		// Fall back to activeSpaceId when no tab is active (e.g. all tabs closed). A conversation's tab has no space:
		// the sidebar stays where it is.
		if (tab && isConversationTab(tab)) return;
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

	function handleGuildSelect(id: string) {
		activeSpaceId = id;
		sidebarSpaceId = id;
		showFriendsView = false;
		activeDMId = null;
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
	<div class="bg-duvet-bg text-duvet-ink flex h-full overflow-hidden">
		<!-- The spaces column. Folded, its edge stays in the row and the column shows over the chat, so the chat
			 doesn't move. The same column is kept either way, with what's open in it. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			bind:this={navWrapEl}
			class="relative z-40 flex h-full shrink-0 {navDocked ? 'w-[280px]' : 'w-[60px]'}"
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
					? "h-full"
					: `shadow-duvet-float absolute top-0 left-full h-full overflow-hidden rounded-r-[18px] transition-[opacity,translate,visibility] duration-200 motion-reduce:transition-none ${navRevealed ? "visible translate-x-0 opacity-100 ease-out" : "invisible -translate-x-full opacity-0 ease-in"}`}
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
					onSpaceSelect={handleGuildSelect}
					onRoomSelect={(spaceId, roomId) => onSidebarSelect(roomId, spaceId)}
					onFriendsSelect={handleFriendsSelect}
					onConversationSelect={openConversationTab}
					onNewGroup={() => {
						showGroupModal = true;
					}}
					onOpenSwitcher={() => (switcherOpen = true)}
					onFriend={(userId) => void openFriendDM(userId)}
				/>
			</div>
		</div>

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
					showChannelsSidebar={navDocked}
					onToggleChannels={layoutPrefs.spacesColumn === "fixed"
						? () => (layoutPrefs.showChannelsSidebar = !layoutPrefs.showChannelsSidebar)
						: null}
					membersColumnOpen={membersColumnIsOpen}
					onMembersColumn={(open) => (layoutPrefs.membersColumn = open ? "shown" : "hidden")}
					{focusedPaneId}
					onFocus={handleFocusChange}
					isActive={!showFriendsView}
					showTabs={layoutPrefs.openChats === "tabs"}
				/>
			</div>
		</div>
		<!-- A conversation has its own members in its view: the space's show beside rooms only. -->
		{#if !showFriendsView && !focusedConversationId}
			<GuildMemberSidebar
				spaceId={memberSidebarSpaceId}
				space={memberSidebarSpace}
				channelId={sidebarActiveChannelId}
				collapsed={!membersColumnIsOpen}
			/>
		{/if}
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

<!-- Global call UI: ringing/calling overlay -->
{#if $activeCall}
	<CallModal />
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

<QuickSwitcher
	bind:open={switcherOpen}
	onSpace={handleGuildSelect}
	onRoom={(spaceId, roomId) => onSidebarSelect(roomId, spaceId)}
	onConversation={openConversationTab}
	onFriend={(userId) => void openFriendDM(userId)}
/>

<BotInviteModal bind:open={botInviteOpen} bind:botUserId={botInviteId} />
<SpaceInviteModal bind:open={spaceInviteOpen} bind:inviteCode={spaceInviteCode} />
<ReactionsDialog />
<BanDialog />
{#if $currentUser && $friendsReady}
	<MentionNotices onOpen={openMentioned} />
	<NotificationPermissionBar />
{/if}
