<script lang="ts">
import { onMount, onDestroy, setContext } from "svelte";
import GuildSideBar from "$lib/components/GuildSidebar.svelte";
import ChannelsSidebar from "$lib/components/ChannelsSidebar.svelte";
import VoiceChat from "$lib/components/VoiceChat.svelte";
import PaneView from "$lib/components/PaneView.svelte";
import GuildMemberSidebar from "$lib/components/GuildMemberSidebar.svelte";
import { createWebSocketConnection } from "$lib/api/ws/connection";
import { makeLeaf, makeSplit, removeLeaf, updateLeaf } from "$lib/pane";
import { gatewaySpaceToGuild, gatewaySpaceToMembers } from "$lib/types";
import type { PaneNode, Tab } from "$lib/types";
import { gatewaySpaces, activeVoiceRoomId } from "$lib/stores.svelte";
import { canViewRoom } from "$lib/permissions";

const layoutPrefsKey = "duvet.layout.panels.v1";

onMount(() => {
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

	const conn = createWebSocketConnection();
	onDestroy(() => conn.destroy());
});

const guilds = $derived($gatewaySpaces.map((space) => {
	const visibleRooms = space.rooms.filter((room) => canViewRoom(space, room));
	const visibleIds = new Set(visibleRooms.map((r) => r.id));
	const filteredRooms = visibleRooms.filter(
		(r) =>
			r.type !== 3 ||
			space.rooms.some((c) => c.parent_id === r.id && visibleIds.has(c.id)),
	);
	return gatewaySpaceToGuild({ ...space, rooms: filteredRooms });
}));

let activeSpaceId = $state<string | null>(null);
let showMembersSidebar = $state(true);
let showChannelsSidebar = $state(true);
let layoutPrefsHydrated = $state(false);
$effect(() => {
	if (typeof window !== "undefined" && layoutPrefsHydrated) {
		localStorage.setItem(
			layoutPrefsKey,
			JSON.stringify({ showMembersSidebar, showChannelsSidebar }),
		);
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
const activeGuild = $derived(
	guilds.find((g) => g.id === activeSpaceId) ?? guilds.at(0) ?? null,
);
const activeSpace = $derived(
	$gatewaySpaces.find((s) => s.id === activeSpaceId) ?? null,
);
const activeMembers = $derived(
	activeSpace ? gatewaySpaceToMembers(activeSpace) : [],
);

// ── Pane tree ─────────────────────────────────────────────────────────────
const initialRootPane = makeLeaf();
let rootPane = $state<PaneNode>(initialRootPane);
let focusedPaneId = $state<string>(initialRootPane.id);

// Auto-open first channel on initial load (when there are no tabs yet)
$effect(() => {
	if (activeGuild && rootPane.kind === "leaf" && rootPane.tabs.length === 0) {
		const first = activeGuild.channels.find((c) => c.type !== "category");
		if (first && activeSpaceId) {
			rootPane = {
				...rootPane,
				tabs: [
					{
						channelId: first.id,
						channelName: first.name,
						channelType: first.type,
						spaceId: activeSpaceId,
					},
				],
				activeChannelId: first.id,
			};
			focusedPaneId = rootPane.id;
		}
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
		const tabs = leaf.tabs.some((t) => t.channelId === ch.id)
			? leaf.tabs
			: [...leaf.tabs, tab];
		return { ...leaf, tabs, activeChannelId: ch.id };
	});
	syncSidebarToLeaf(rootPane, focusedPaneId);
}

// Derive the active channel of the focused pane for sidebar highlight
function findLeaf(
	node: PaneNode,
	id: string,
): import("$lib/types").PaneLeaf | null {
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

const sidebarGuild = $derived(
	guilds.find((g) => g.id === sidebarSpaceId) ?? activeGuild,
);
const memberSidebarSpaceId = $derived(sidebarSpaceId);
const memberSidebarSpace = $derived(
	$gatewaySpaces.find((s) => s.id === memberSidebarSpaceId) ?? null,
);
const memberSidebarMembers = $derived(
	memberSidebarSpace ? gatewaySpaceToMembers(memberSidebarSpace) : [],
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
}

// When leaving voice, switch active tab away from the voice channel
// (keep the tab so the user can rejoin; just navigate to the last text tab)
function mapAllLeaves(
	node: PaneNode,
	fn: (l: import("$lib/types").PaneLeaf) => PaneNode,
): PaneNode {
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
				? (tabs[idx] ?? tabs[idx - 1])?.channelId ?? null
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
			return { ...leaf, tabs: [...leaf.tabs, tab], activeChannelId: tab.channelId };
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

let prevVoiceRoomId: string | null = null;

$effect(() => {
	const cur = $activeVoiceRoomId;
	if (prevVoiceRoomId && !cur) {
		const leftRoom = prevVoiceRoomId;
		rootPane = mapAllLeaves(rootPane, (leaf) => {
			if (leaf.activeChannelId !== leftRoom) return leaf;
			// Switch to the last non-voice tab; keep the voice tab in the list
			const prev = [...leaf.tabs]
				.reverse()
				.find((t) => t.channelId !== leftRoom);
			return prev ? { ...leaf, activeChannelId: prev.channelId } : leaf;
		});
	}
	prevVoiceRoomId = cur;
});

// ── VoiceChat portal ──────────────────────────────────────────────────────
// VoiceChat is mounted once here (stable location) so splits/tabs never
// cause it to unmount. PaneView moves its DOM node via the portal action.
let voiceHolder: HTMLElement;
let voiceChatEl = $state<HTMLElement | null>(null);

const voiceChannelName = $derived((() => {
	if (!$activeVoiceRoomId) return "";
	for (const s of $gatewaySpaces) {
		const r = s.rooms.find((r) => r.id === $activeVoiceRoomId);
		if (r) return r.name;
	}
	return "Voice Channel";
})());

setContext("voicePortal", {
	getEl: () => voiceChatEl,
	getHolder: () => voiceHolder,
});
</script>

<div class="flex h-full overflow-hidden bg-[radial-gradient(120%_70%_at_85%_0%,oklch(0.28_0.012_80/.3),transparent_60%),linear-gradient(180deg,oklch(0.18_0.008_80),oklch(0.15_0.006_80))]">
  <!-- Stable VoiceChat holder — keeps WebRTC alive across pane splits -->
  <div bind:this={voiceHolder} class="contents">
    {#if $activeVoiceRoomId}
      <div
        bind:this={voiceChatEl}
        class="flex flex-col"
        style="width:100%;height:100%"
      >
        <VoiceChat
          channelId={$activeVoiceRoomId}
          channelName={voiceChannelName}
        />
      </div>
    {/if}
  </div>
  <GuildSideBar
    {guilds}
    activeGuildId={sidebarSpaceId}
    onSelect={handleGuildSelect}
  />
  {#if sidebarGuild && showChannelsSidebar}
    <ChannelsSidebar
      guild={sidebarGuild}
      channels={sidebarGuild.channels}
      activeChannelId={sidebarActiveChannelId}
      onSelect={onSidebarSelect}
    />
  {/if}

  <div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,oklch(0.205_0.01_80),oklch(0.18_0.008_80))]">
    <PaneView
      node={rootPane}
      onUpdate={handlePaneUpdate}
      onMoveTab={moveTabBetweenLeaves}
      onClose={null}
      guild={activeGuild}
      spaceId={activeSpaceId}
      space={activeSpace}
      members={activeMembers}
      showChannelsSidebar={showChannelsSidebar}
      onToggleChannels={() => (showChannelsSidebar = !showChannelsSidebar)}
      showMembersSidebar={showMembersSidebar}
      onToggleMembers={() => (showMembersSidebar = !showMembersSidebar)}
      {focusedPaneId}
      onFocus={handleFocusChange}
    />
  </div>
  <div class="contents" style={showMembersSidebar ? '' : 'display: none'}>
    <GuildMemberSidebar
      spaceId={memberSidebarSpaceId}
      space={memberSidebarSpace}
    />
  </div>
</div>
