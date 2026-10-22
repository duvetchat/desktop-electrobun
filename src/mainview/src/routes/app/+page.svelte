<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { createWebSocketConnection } from "$lib/api/ws/connection";
	import { keepSessionFresh } from "$lib/api/api";
	import ChannelsSidebar from "$lib/components/ChannelsSidebar.svelte";
	import DMSidebar from "$lib/components/DMSidebar.svelte";
	import FriendsView from "$lib/components/FriendsView.svelte";
	import GuildMemberSidebar from "$lib/components/GuildMemberSidebar.svelte";
	import GuildSideBar from "$lib/components/GuildSidebar.svelte";
	import PaneView from "$lib/components/PaneView.svelte";
	import VoiceChat from "$lib/components/VoiceChat.svelte";
	import { makeLeaf, makeSplit, removeLeaf, updateLeaf } from "$lib/pane";
	import { canViewRoom } from "$lib/permissions";
	import {
		activeCall,
		activeVoiceRoomId,
		currentUser,
		friendsReady,
		gatewaySpaces,
		botInviteRequest,
		spaceInviteRequest,
		allSpacesReady,
	} from "$lib/stores.svelte";
	import CallModal from "$lib/components/CallModal.svelte";
	import BotInviteModal from "$lib/components/BotInviteModal.svelte";
	import SpaceInviteModal from "$lib/components/SpaceInviteModal.svelte";
	import type { PaneNode, Tab } from "$lib/types";
	import { gatewaySpaceToGuild, gatewaySpaceToMembers } from "$lib/types";
	import { userStatusCache } from "$lib/api/ws/connection";
	import { DUVET_DOMAIN } from "$lib/common/common";
	import { isUuid } from "$lib/urls";

	const layoutPrefsKey = "duvet.layout.panels.v1";

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

		try {
			const saved = localStorage.getItem(layoutPrefsKey);
			if (saved) {
				const prefs = JSON.parse(saved) as {
					showMembersSidebar?: boolean;
					showChannelsSidebar?: boolean;
				};
				if (typeof prefs.showMembersSidebar === "boolean") {
					showMembersSidebar = prefs.showMembersSidebar;
				}
				if (typeof prefs.showChannelsSidebar === "boolean") {
					showChannelsSidebar = prefs.showChannelsSidebar;
				}
			}
		} catch {
			// ignore invalid persisted layout prefs
		}
		layoutPrefsHydrated = true;

		const session = keepSessionFresh();
		let conn: ReturnType<typeof createWebSocketConnection> | null = null;
		let destroyed = false;
		void session.ready.then(() => {
			if (!destroyed) conn = createWebSocketConnection();
		});
		onDestroy(() => {
			destroyed = true;
			session.stop();
			conn?.destroy();
		});
	});

	const guilds = $derived(
		$gatewaySpaces.map((space) => {
			const visibleRooms = space.rooms.filter((room) => canViewRoom(space, room));
			const visibleIds = new Set(visibleRooms.map((r) => r.id));
			const filteredRooms = visibleRooms.filter(
				(r) =>
					r.type !== 3 ||
					!space.rooms.some((c) => c.parent_id === r.id) ||
					space.rooms.some((c) => c.parent_id === r.id && visibleIds.has(c.id)),
			);
			return gatewaySpaceToGuild({ ...space, rooms: filteredRooms });
		}),
	);

	let activeSpaceId = $state<string | null>(null);
	let showFriendsView = $state(true);
	let activeDMId = $state<string | null>(null);
	let showGroupModal = $state(false);
	let showMembersSidebar = $state(true);
	let showChannelsSidebar = $state(true);
	let layoutPrefsHydrated = $state(false);
	$effect(() => {
		if (typeof window !== "undefined" && layoutPrefsHydrated) {
			localStorage.setItem(layoutPrefsKey, JSON.stringify({ showMembersSidebar, showChannelsSidebar }));
		}
	});
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

	// Filter pane tree: remove tabs/leaves the user can no longer view
	function filterPaneTree(node: PaneNode, spaces: typeof $gatewaySpaces): PaneNode | null {
		if (node.kind === "leaf") {
			const validTabs = node.tabs.filter((tab) => {
				const space = spaces.find((s) => s.id === tab.spaceId);
				if (!space) return false;
				const room = space.rooms.find((r) => r.id === tab.channelId);
				if (!room) return false;
				return canViewRoom(space, room);
			});
			if (validTabs.length === 0) return null;
			return {
				...node,
				tabs: validTabs,
				activeChannelId: validTabs.some((t) => t.channelId === node.activeChannelId)
					? node.activeChannelId
					: validTabs[0].channelId,
			};
		}
		const a = filterPaneTree(node.a, spaces);
		const b = filterPaneTree(node.b, spaces);
		if (!a && !b) return null;
		if (!a) return b;
		if (!b) return a;
		return { ...node, a, b };
	}

	// Restore pane tree after all SPACE_CREATE events arrive
	$effect(() => {
		if (!$allSpacesReady || hasRestoredRooms) return;
		hasRestoredRooms = true;
		try {
			const raw = localStorage.getItem(OPEN_ROOMS_KEY);
			if (!raw) return;
			const saved = JSON.parse(raw) as { pane?: PaneNode; activeSpaceId?: string | null };
			if (!saved.pane) return;
			const filtered = filterPaneTree(saved.pane, $gatewaySpaces);
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

	// Sidebar selection → open in focused pane
	function onSidebarSelect(channelId: string) {
		const ch = sidebarGuild?.channels.find((c) => c.id === channelId);
		if (!ch || ch.type === "category" || !sidebarSpaceId) return;
		const tab: Tab = {
			channelId: ch.id,
			channelName: ch.name,
			channelType: ch.type,
			spaceId: sidebarSpaceId,
		};
		rootPane = updateLeaf(rootPane, focusedPaneId, (leaf) => {
			const tabs = leaf.tabs.some((t) => t.channelId === ch.id) ? leaf.tabs : [...leaf.tabs, tab];
			return { ...leaf, tabs, activeChannelId: ch.id };
		});
		syncSidebarToLeaf(rootPane, focusedPaneId);
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
	const memberSidebarMembers = $derived(
		memberSidebarSpace ? gatewaySpaceToMembers(memberSidebarSpace, userStatusCache) : [],
	);

	function syncSidebarToLeaf(node: PaneNode, leafId: string) {
		const leaf = findLeaf(node, leafId);
		const tab = leaf?.tabs.find((t) => t.channelId === leaf?.activeChannelId);
		// Fall back to activeSpaceId when no tab is active (e.g. all tabs closed)
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

{#if !$currentUser || !$friendsReady}
	<div
		class="flex h-full items-center justify-center bg-[linear-gradient(180deg,oklch(0.18_0.008_80),oklch(0.15_0.006_80))]"
	>
		<div class="flex flex-col items-center gap-4">
			<svg class="size-8 animate-spin text-zinc-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
				<path
					class="opacity-75"
					fill="currentColor"
					d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
				></path>
			</svg>
			<span class="text-sm font-medium text-zinc-500">Connecting…</span>
		</div>
	</div>
{:else}
	<div
		class="flex h-full overflow-hidden bg-[radial-gradient(120%_70%_at_85%_0%,oklch(0.28_0.012_80/.3),transparent_60%),linear-gradient(180deg,oklch(0.18_0.008_80),oklch(0.15_0.006_80))]"
	>
		<GuildSideBar
			{guilds}
			activeGuildId={showFriendsView ? null : sidebarSpaceId}
			onSelect={handleGuildSelect}
			isFriendsActive={showFriendsView}
			onFriendsSelect={handleFriendsSelect}
		/>
		{#if showFriendsView}
			<DMSidebar
				activeConversationId={activeDMId}
				onSelect={(id) => {
					activeDMId = id;
				}}
				onNewGroup={() => {
					showGroupModal = true;
				}}
			/>
		{:else if sidebarGuild}
			<ChannelsSidebar
				guild={sidebarGuild}
				channels={sidebarGuild.channels}
				activeChannelId={sidebarActiveChannelId}
				onSelect={onSidebarSelect}
				showChannels={showChannelsSidebar}
			/>
		{/if}

		<div
			class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,oklch(0.205_0.01_80),oklch(0.18_0.008_80))]"
		>
			{#if friendsViewEverShown}
				<div class="flex min-h-0 flex-1 flex-col {showFriendsView ? '' : 'hidden'}">
					<FriendsView bind:activeConversationId={activeDMId} bind:showGroupModal />
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
					{showChannelsSidebar}
					onToggleChannels={() => (showChannelsSidebar = !showChannelsSidebar)}
					{showMembersSidebar}
					onToggleMembers={() => (showMembersSidebar = !showMembersSidebar)}
					{focusedPaneId}
					onFocus={handleFocusChange}
					isActive={!showFriendsView}
				/>
			</div>
		</div>
		{#if !showFriendsView}
			<GuildMemberSidebar
				spaceId={memberSidebarSpaceId}
				space={memberSidebarSpace}
				channelId={sidebarActiveChannelId}
				collapsed={!showMembersSidebar}
			/>
		{/if}
	</div>
{/if}

<!-- Global VoiceChat: mounted outside all navigation so audio never cuts -->
{#if $activeVoiceRoomId && (globalVoiceRoom || isCallVoice)}
	{#key $activeVoiceRoomId}
		<div class="hidden" aria-hidden="true">
			<VoiceChat channelId={$activeVoiceRoomId} channelName={globalVoiceRoom?.name ?? "Call"} />
		</div>
	{/key}
{/if}

<!-- Global call UI: ringing/calling overlay -->
{#if $activeCall}
	<CallModal />
{/if}

<BotInviteModal bind:open={botInviteOpen} bind:botUserId={botInviteId} />
<SpaceInviteModal bind:open={spaceInviteOpen} bind:inviteCode={spaceInviteCode} />
