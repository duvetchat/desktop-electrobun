<script lang="ts">
import {
	activeVoiceRoomId,
	channelMessages,
	gatewaySpaces,
} from "$lib/stores.svelte";
import { makeSplit, makeLeaf } from "$lib/pane";
import { getMessages } from "$lib/api/messages";
import { getContext, onMount, onDestroy } from "svelte";

import type {
	MemberOnSidebar,
	GatewaySpace,
	PaneNode,
	Guild,
	Tab,
} from "$lib/types";

import { gatewayMessageToMessage, gatewaySpaceToMembers } from "$lib/types";
import PaneView from "$lib/components/PaneView.svelte";
import TabBar from "$lib/components/TabBar.svelte";
import Chat from "$lib/components/Chat.svelte";
import {
	PanelRightClose,
	PanelRightOpen,
	PanelLeftClose,
	PanelLeftOpen,
} from "lucide-svelte";

// ── Voice portal: VoiceChat lives in +page.svelte; we teleport its
// DOM node here so it survives splits without ever unmounting. ──────────
const voicePortalCtx = getContext<
	| {
			getEl: () => HTMLElement | null;
			getHolder: () => HTMLElement;
	  }
	| undefined
>("voicePortal");

function voicePortalAction(node: HTMLElement) {
	const el = voicePortalCtx?.getEl();
	if (el) {
		node.appendChild(el);
	}
	return {
		destroy() {
			// Do NOT move el back to the holder here.
			// • If $activeVoiceRoomId became null, page.svelte's {#if} already
			//   unmounts voiceChatEl — moving it first would cause a visual flash.
			// • If the pane split, the new pane's voicePortalAction will
			//   appendChild(el) from wherever it currently is, moving it there.
		},
	};
}

// ── Props ──────────────────────────────────────────────────────────────────
let {
	node,
	onUpdate,
	onMoveTab = null,
	onClose = null,
	guild,
	spaceId,
	space,
	members,
	focusedPaneId,
	onFocus,
	showChannelsSidebar = true,
	onToggleChannels = null,
	showMembersSidebar = true,
	onToggleMembers = null,
}: {
	node: PaneNode;
	onUpdate: (n: PaneNode) => void;
	onMoveTab?: ((
		tab: Tab,
		sourceLeafId: string,
		targetLeafId: string,
		zone: "bottom" | "right" | "left" | "top" | null,
	) => void) | null;
	onClose?: (() => void) | null;
	guild: Guild | null;
	spaceId: string | null;
	space: GatewaySpace | null;
	members: MemberOnSidebar[];
	focusedPaneId: string | null;
	onFocus: (id: string) => void;
	showChannelsSidebar?: boolean;
	onToggleChannels?: (() => void) | null;
	showMembersSidebar?: boolean;
	onToggleMembers?: (() => void) | null;
} = $props();

// ── Leaf: message loading ─────────────────────────────────────────────────
const loadedChannels = new Set<string>();
let isLoadingMore = $state(false);
let channelHasMore = $state<Partial<Record<string, boolean>>>({});
let channelInitialLoading = $state<Partial<Record<string, boolean>>>({});
const isInitialLoading = $derived(!!(
	node.kind === "leaf" &&
	node.activeChannelId &&
	channelInitialLoading[node.activeChannelId]
));
// Returns true when the channel still has older messages to load.
// Must use !== false because undefined means "not yet determined" (has more).
function channelStillHasMore(channelId: string): boolean {
	return channelHasMore[channelId] !== false;
}

const activeMessages = $derived(
	node.kind === "leaf" && node.activeChannelId
		? ($channelMessages[node.activeChannelId] ?? [])
		: [],
);

// Derive channel/space/members from the active tab's own spaceId,
// so tabs from different servers always show the correct data.
const activeTab = $derived(
	node.kind === "leaf" && node.activeChannelId
		? (node.tabs.find((t) => t.channelId === node.activeChannelId) ?? null)
		: null,
);
const activeTabSpace = $derived(activeTab?.spaceId
	? ($gatewaySpaces.find((s) => s.id === activeTab.spaceId) ?? null)
	: null);
const activeTabMembers = $derived(activeTabSpace
	? gatewaySpaceToMembers(activeTabSpace)
	: members);
// Channel info comes directly from the tab — no cross-guild lookup needed.
const activeChannel = $derived(activeTab
	? {
			id: activeTab.channelId,
			name: activeTab.channelName,
			type: activeTab.channelType,
		}
	: null);

// Fetch initial messages only for text channels
$effect(() => {
	if (
		node.kind !== "leaf" ||
		!node.activeChannelId ||
		activeChannel?.type !== "text"
	) {
		return;
	}
	const channelId = node.activeChannelId;
	if (loadedChannels.has(channelId)) {
		return;
	}
	loadedChannels.add(channelId);
	channelInitialLoading = {
		...channelInitialLoading,
		[channelId]: true,
	};
	getMessages(channelId)
		.then((raw) => {
			const msgs = raw.map((m) => gatewayMessageToMessage(m, $gatewaySpaces));
			channelMessages.update((all) => {
				const existing = all[channelId] ?? [];
				if (existing.length > 0) {
					return all;
				}
				return { ...all, [channelId]: msgs };
			});
			channelInitialLoading = {
				...channelInitialLoading,
				[channelId]: false,
			};
			if (raw.length < 100) {
				console.log(
					"[loadmore] initial fetch: only",
					raw.length,
					"msgs → marking hasMore=false for",
					channelId,
				);
				channelHasMore = {
					...channelHasMore,
					[channelId]: false,
				};
			} else {
				console.log(
					"[loadmore] initial fetch: got",
					raw.length,
					"msgs → hasMore=true for",
					channelId,
				);
			}
		})
		.catch((err) => {
			console.error("Failed to fetch history:", err);
			channelHasMore = {
				...channelHasMore,
				[channelId]: false,
			};
			channelInitialLoading = {
				...channelInitialLoading,
				[channelId]: false,
			};
		});
});

async function loadMoreMessages() {
	console.log("[loadmore] loadMoreMessages called", {
		kind: node.kind,
		activeChannelId: node.kind === "leaf" ? node.activeChannelId : null,
		isLoadingMore,
		hasMore:
			node.kind === "leaf" && node.activeChannelId
				? channelHasMore[node.activeChannelId]
				: "?",
	});
	if (
		node.kind !== "leaf" ||
		!node.activeChannelId ||
		isLoadingMore ||
		activeChannel?.type !== "text"
	) {
		return;
	}
	const channelId = node.activeChannelId;
	if (channelHasMore[channelId] === false) {
		console.log("[loadmore] skipped — channelHasMore is false for", channelId);
		return;
	}

	const current = $channelMessages[channelId];
	// Still fetching initial messages — don't interfere
	if (current === undefined || current === null) {
		console.log("[loadmore] skipped — no messages in store yet for", channelId);
		return;
	}
	// Loaded but empty channel → no history to fetch
	if (current.length === 0) {
		console.log("[loadmore] skipped — empty channel", channelId);
		channelHasMore = { ...channelHasMore, [channelId]: false };
		return;
	}
	console.log(
		"[loadmore] fetching older messages before oldest in",
		current.length,
		"msgs",
	);

	let oldest = new Date(current.at(0)!.created_at);
	for (const m of current) {
		const d = new Date(m.created_at);
		if (d < oldest) {
			oldest = d;
		}
	}

	isLoadingMore = true;

	// Abort the fetch after 10 s to avoid a permanent spinner
	const controller = new AbortController();
	const timeoutId = setTimeout(() => {
		controller.abort();
	}, 10_000);

	try {
		const raw = await getMessages(channelId, oldest, controller.signal);
		clearTimeout(timeoutId);
		console.log(
			"[loadmore] loadMore fetch returned",
			raw.length,
			"msgs for",
			channelId,
		);
		if (raw.length === 0) {
			console.log("[loadmore] no older msgs → marking hasMore=false");
			channelHasMore = { ...channelHasMore, [channelId]: false };
		} else {
			const msgs = raw.map((m) => gatewayMessageToMessage(m, $gatewaySpaces));
			channelMessages.update((all) => {
				const existing = all[channelId] || [];
				const existingIds = new Set(existing.map((m) => m.id));
				return {
					...all,
					[channelId]: [
						...existing,
						...msgs.filter((m) => !existingIds.has(m.id)),
					],
				};
			});
			// Fewer than a full page means we've reached the beginning
			if (raw.length < 100) {
				channelHasMore = { ...channelHasMore, [channelId]: false };
			}
		}
	} catch (err) {
		clearTimeout(timeoutId);
		console.error("Failed to load more:", err);
		// On any error (including timeout), stop trying so the spinner clears
		channelHasMore = { ...channelHasMore, [channelId]: false };
	} finally {
		isLoadingMore = false;
	}
}

// ── Leaf: tab management ──────────────────────────────────────────────────
function openTab(tab: Tab) {
	if (node.kind !== "leaf") {
		return;
	}
	const tabs = node.tabs.some((t) => t.channelId === tab.channelId)
		? node.tabs
		: [...node.tabs, tab];
	onUpdate({ ...node, tabs, activeChannelId: tab.channelId });
}

function handleTabSelect(channelId: string) {
	if (node.kind !== "leaf") {
		return;
	}
	onUpdate({ ...node, activeChannelId: channelId });
}

function handleTabClose(channelId: string) {
	if (node.kind !== "leaf") {
		return;
	}
	const idx = node.tabs.findIndex((t) => t.channelId === channelId);
	const tabs = node.tabs.filter((t) => t.channelId !== channelId);
	if (tabs.length === 0 && onClose) {
		onClose();
		return;
	}
	let activeChannelId = node.activeChannelId;
	if (activeChannelId === channelId) {
		activeChannelId = (tabs[idx] ?? tabs[idx - 1])?.channelId ?? null;
	}
	// Focus this pane AFTER the update (onUpdate triggers syncSidebarToLeaf
	// with the already-updated tree, so sidebarSpaceId gets the right guild).
	const leafId = node.id;
	onUpdate({ ...node, tabs, activeChannelId });
	onFocus(leafId);
}

function handleTabReorder(newTabs: Tab[]) {
	if (node.kind !== "leaf") {
		return;
	}
	onUpdate({ ...node, tabs: newTabs });
}

function handleChannelDrop(tab: Tab) {
	openTab(tab);
}

// ── Leaf: split actions ───────────────────────────────────────────────────
function splitH() {
	if (node.kind !== "leaf") {
		return;
	}
	onUpdate(makeSplit(node, makeLeaf(), "h"));
}

function splitV() {
	if (node.kind !== "leaf") {
		return;
	}
	onUpdate(makeSplit(node, makeLeaf(), "v"));
}

// ── Split: resize handle ──────────────────────────────────────────────────
let containerEl = $state<HTMLElement | undefined>(undefined);
let localRatio = $state(0.5);
let isDragging = $state(false);

$effect(() => {
	if (node.kind === "split" && !isDragging) {
		localRatio = node.ratio;
	}
});

function startResize(e: MouseEvent) {
	e.preventDefault();
	isDragging = true;
	window.addEventListener("mousemove", onMouseMove);
	window.addEventListener("mouseup", onMouseUp);
}

function onMouseMove(e: MouseEvent) {
	if (!isDragging || !containerEl || node.kind !== "split") {
		return;
	}
	const rect = containerEl.getBoundingClientRect();
	const r =
		node.direction === "h"
			? (e.clientX - rect.left) / rect.width
			: (e.clientY - rect.top) / rect.height;
	localRatio = Math.max(0.1, Math.min(0.9, r));
}

function onMouseUp() {
	if (!isDragging) {
		return;
	}
	isDragging = false;
	window.removeEventListener("mousemove", onMouseMove);
	window.removeEventListener("mouseup", onMouseUp);
	if (node.kind === "split") {
		onUpdate({ ...node, ratio: localRatio });
	}
}

onDestroy(() => {
	if (typeof window === "undefined") return;
	window.removeEventListener("mousemove", onMouseMove);
	window.removeEventListener("mouseup", onMouseUp);
});

const isFocused = $derived(node.kind === "leaf" && focusedPaneId === node.id);

function handleCtrlW(e: KeyboardEvent) {
	if (!e.ctrlKey || e.key !== "w") return;
	if (node.kind !== "leaf" || focusedPaneId !== node.id) return;
	if (!node.activeChannelId) return;
	e.preventDefault();
	handleTabClose(node.activeChannelId);
}

onMount(() => window.addEventListener("keydown", handleCtrlW));
onDestroy(() => {
	if (typeof window === "undefined") return;
	window.removeEventListener("keydown", handleCtrlW);
});

// ── Leaf: drag-to-split ───────────────────────────────────────────────────
let contentDragOver = $state(false);
let splitZone = $state<"bottom" | "right" | "left" | "top" | null>(null);

function handleContentDragOver(e: DragEvent) {
	e.preventDefault();
	contentDragOver = true;
	if (e.dataTransfer) {
		e.dataTransfer.dropEffect = "copy";
	}
	const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
	const x = (e.clientX - rect.left) / rect.width;
	const y = (e.clientY - rect.top) / rect.height;
	const margin = 0.25;
	if (x < margin) {
		splitZone = "left";
	} else if (x > 1 - margin) {
		splitZone = "right";
	} else if (y < margin) {
		splitZone = "top";
	} else if (y > 1 - margin) {
		splitZone = "bottom";
	} else {
		splitZone = null;
	}
}

function handleContentDragLeave(e: DragEvent) {
	const el = e.currentTarget as HTMLElement;
	if (!el.contains(e.relatedTarget as Node)) {
		contentDragOver = false;
		splitZone = null;
	}
}

function handleContentDrop(e: DragEvent) {
	e.preventDefault();
	contentDragOver = false;
	// Recompute zone from drop coordinates — dragleave resets splitZone before drop fires
	const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
	const x = (e.clientX - rect.left) / rect.width;
	const y = (e.clientY - rect.top) / rect.height;
	const margin = 0.25;
	let zone: "bottom" | "right" | "left" | "top" | null = null;
	if (x < margin) {
		zone = "left";
	} else if (x > 1 - margin) {
		zone = "right";
	} else if (y < margin) {
		zone = "top";
	} else if (y > 1 - margin) {
		zone = "bottom";
	}
	splitZone = null;
	if (node.kind !== "leaf") {
		return;
	}
	const raw = e.dataTransfer?.getData("text/plain") ?? "";
	let tab: null | Tab = null;
	let dragType: "channel" | "tab" | null = null;
	let sourceLeafId: string | null = null;
	try {
		const data = JSON.parse(raw) as {
			type?: string;
			sourceLeafId?: string;
			channelId?: string;
			channelName?: string;
			channelType?: string;
			spaceId?: string;
		};
		dragType = data.type === "tab" ? "tab" : "channel";
		sourceLeafId = data.sourceLeafId ?? null;
		if (data.channelId) {
			tab = {
				channelId: data.channelId,
				channelName: data.channelName ?? data.channelId,
				channelType: data.channelType ?? "text",
				spaceId: data.spaceId ?? "",
			};
		}
	} catch {
		return;
	}
	if (!tab) {
		return;
	}

	if (dragType === "tab" && sourceLeafId === node.id) {
		const fromIndex = node.tabs.findIndex((t) => t.channelId === tab.channelId);
		if (fromIndex === -1) {
			return;
		}
		if (zone === null) {
			handleTabSelect(tab.channelId);
			return;
		}
		const remainingTabs = node.tabs.filter((t) => t.channelId !== tab.channelId);
		const remainingActive =
			node.activeChannelId === tab.channelId
				? (remainingTabs[fromIndex] ?? remainingTabs[fromIndex - 1])?.channelId ??
				null
				: node.activeChannelId;
		const currentLeaf = {
			...node,
			tabs: remainingTabs,
			activeChannelId: remainingActive,
		};
		const newLeaf = makeLeaf([tab], tab.channelId);
		if (zone === "left") {
			onUpdate(makeSplit(newLeaf, currentLeaf, "h"));
		} else if (zone === "right") {
			onUpdate(makeSplit(currentLeaf, newLeaf, "h"));
		} else if (zone === "top") {
			onUpdate(makeSplit(newLeaf, currentLeaf, "v"));
		} else {
			onUpdate(makeSplit(currentLeaf, newLeaf, "v"));
		}
		return;
	}

	if (dragType === "tab" && sourceLeafId && sourceLeafId !== node.id && onMoveTab) {
		onMoveTab(tab, sourceLeafId, node.id, zone);
		return;
	}

	const newLeaf = makeLeaf([tab], tab.channelId);
	if (zone === "left") {
		onUpdate(makeSplit(newLeaf, node, "h"));
	} else if (zone === "right") {
		onUpdate(makeSplit(node, newLeaf, "h"));
	} else if (zone === "top") {
		onUpdate(makeSplit(newLeaf, node, "v"));
	} else if (zone === "bottom") {
		onUpdate(makeSplit(node, newLeaf, "v"));
	} else {
		// Centro: abrir en este pane sin dividir
		openTab(tab);
	}
}

// shared props forwarded to children
const childProps = $derived({
	guild,
	spaceId,
	space,
	members,
	focusedPaneId,
	onFocus,
	onMoveTab,
	showChannelsSidebar,
	onToggleChannels,
	showMembersSidebar,
	onToggleMembers,
});
</script>

{#if node.kind === "split"}
    <!-- ── Split ─────────────────────────────────────────────────────────────── -->
    <div
        bind:this={containerEl}
        class="flex {node.direction === 'h'
            ? 'flex-row'
            : 'flex-col'} w-full h-full overflow-hidden"
    >
        <!-- Child A -->
        <div
            class="min-w-0 min-h-0 overflow-hidden flex flex-col"
            style="{node.direction === 'h' ? 'width' : 'height'}: {localRatio *
                100}%"
        >
            <PaneView
                node={node.a}
                onUpdate={(newA) => {
                    onUpdate({ ...node, a: newA });
                }}
                onClose={() => {
                    onUpdate(node.b);
                }}
                {...childProps}
            />
        </div>

		<!-- Resize handle -->
		<button
			type="button"
			class="shrink-0 {node.direction === 'h'
				? 'w-1 cursor-col-resize'
				: 'h-1 cursor-row-resize'} bg-zinc-800 hover:bg-blue-500 active:bg-blue-400 transition-colors {isDragging
				? 'bg-blue-500'
				: ''}"
			on:mousedown={startResize}
			aria-label="Resize split"
		></button>

        <!-- Child B -->
        <div class="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
            <PaneView
                node={node.b}
                onUpdate={(newB) => {
                    onUpdate({ ...node, b: newB });
                }}
                onClose={() => {
                    onUpdate(node.a);
                }}
                {...childProps}
            />
        </div>
    </div>
{:else}
	<!-- ── Leaf ───────────────────────────────────────────────────────────────── -->
	<div
		class="flex flex-col w-full h-full min-w-0 min-h-0 overflow-hidden relative {isFocused
			? 'ring-1 ring-inset ring-blue-500/40'
			: ''}"
		role="region"
		aria-label="Chat pane"
	>
        <!-- Tab bar + pane actions -->
		<div class="flex items-stretch shrink-0 border-b border-zinc-800 min-w-0">
            <div class="flex-1 min-w-0 overflow-hidden">
                <TabBar
                    tabs={node.tabs}
                    activeTabId={node.activeChannelId}
                    leafId={node.id}
                    onSelect={handleTabSelect}
                    onClose={handleTabClose}
                    onReorder={handleTabReorder}
                    onChannelDrop={handleChannelDrop}
                />
            </div>

            <!-- Pane action buttons -->
			<div class="flex items-center shrink-0 px-1 gap-0.5 bg-zinc-900">
				{#if onToggleChannels}
					<button
						type="button"
						class="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800"
						on:click={onToggleChannels}
						aria-label={showChannelsSidebar
							? "Collapse channels panel"
							: "Expand channels panel"}
						title={showChannelsSidebar ? "Hide channels" : "Show channels"}
					>
						{#if showChannelsSidebar}
							<PanelLeftClose class="size-4" />
						{:else}
							<PanelLeftOpen class="size-4" />
						{/if}
					</button>
				{/if}

				{#if onToggleMembers}
					<button
						type="button"
						class="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800"
						on:click={onToggleMembers}
						aria-label={showMembersSidebar
							? "Collapse members panel"
							: "Expand members panel"}
						title={showMembersSidebar ? "Hide members" : "Show members"}
					>
						{#if showMembersSidebar}
							<PanelRightClose class="size-4" />
						{:else}
							<PanelRightOpen class="size-4" />
						{/if}
					</button>
				{/if}

				{#if onToggleChannels || onToggleMembers}
					<div class="mx-1 h-4 w-px bg-zinc-700"></div>
				{/if}

                <!-- Split horizontal -->
                <button
                    type="button"
					class="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                    title="Dividir horizontalmente"
						on:click={splitH}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <rect x="3" y="3" width="18" height="18" rx="2" /><line
                            x1="12"
                            y1="3"
                            x2="12"
                            y2="21"
                        />
                    </svg>
                </button>
                <!-- Split vertical -->
                <button
                    type="button"
					class="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                    title="Dividir verticalmente"
						on:click={splitV}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <rect x="3" y="3" width="18" height="18" rx="2" /><line
                            x1="3"
                            y1="12"
                            x2="21"
                            y2="12"
                        />
                    </svg>
                </button>
                <!-- Close pane -->
                {#if onClose}
                    <button
                        type="button"
						class="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                        title="Cerrar panel"
							on:click={onClose}
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                        </svg>
                    </button>
                {/if}
            </div>
        </div>

		<!-- Content -->
		<div
			class="flex-1 flex relative min-h-0 min-w-0 overflow-hidden"
			on:dragover={handleContentDragOver}
			on:dragleave={handleContentDragLeave}
			on:drop={handleContentDrop}
			role="group"
			aria-label="Pane content area"
		>
            <!-- Drag-to-split overlay -->
            {#if contentDragOver}
                <div class="absolute inset-0 z-30 pointer-events-none">
                    <div
                        class="absolute top-0 left-0 w-1/4 h-full transition-colors {splitZone ===
                        'left'
                            ? 'bg-blue-500/30 border-2 border-blue-500'
                            : 'bg-blue-500/5 border-2 border-transparent'}"
                    ></div>
                    <div
                        class="absolute top-0 right-0 w-1/4 h-full transition-colors {splitZone ===
                        'right'
                            ? 'bg-blue-500/30 border-2 border-blue-500'
                            : 'bg-blue-500/5 border-2 border-transparent'}"
                    ></div>
                    <div
                        class="absolute top-0 left-0 right-0 h-1/4 transition-colors {splitZone ===
                        'top'
                            ? 'bg-blue-500/30 border-2 border-blue-500'
                            : 'bg-blue-500/5 border-2 border-transparent'}"
                    ></div>
                    <div
                        class="absolute bottom-0 left-0 right-0 h-1/4 transition-colors {splitZone ===
                        'bottom'
                            ? 'bg-blue-500/30 border-2 border-blue-500'
                            : 'bg-blue-500/5 border-2 border-transparent'}"
                    ></div>
                    {#if splitZone}
                        <div
                            class="absolute inset-0 flex items-center justify-center"
                        >
                            <span
							class="bg-zinc-900/90 text-blue-400 text-xs font-medium px-2 py-1 rounded border border-blue-500/50"
                            >
                                {splitZone === "left"
                                    ? "← Dividir izquierda"
                                    : splitZone === "right"
                                      ? "Dividir derecha →"
                                      : splitZone === "top"
                                        ? "↑ Dividir arriba"
                                        : "Dividir abajo ↓"}
                            </span>
                        </div>
                    {/if}
                </div>
            {/if}

            <!-- VoiceChat portal: shown when this pane's voice tab is active -->
            {#if $activeVoiceRoomId && node.kind === "leaf" && node.tabs.some((t) => t.channelId === $activeVoiceRoomId)}
                <div
                    class="flex-1 min-h-0 {activeChannel?.type === 'voice' &&
                    $activeVoiceRoomId === node.activeChannelId
                        ? 'flex flex-col'
                        : 'hidden'}"
                    use:voicePortalAction
                ></div>
            {/if}

            {#if activeChannel?.type === "text"}
                <Chat
                    messages={activeMessages}
                    channelId={node.activeChannelId ?? ""}
                    space={activeTabSpace}
                    channelName={activeChannel.name}
                    members={activeTabMembers}
                    {isInitialLoading}
                    {isLoadingMore}
                    hasMoreMessages={node.activeChannelId
                        ? channelStillHasMore(node.activeChannelId)
                        : true}
                    onLoadMore={loadMoreMessages}
                />
            {:else if activeChannel?.type === "voice"}
                {#if $activeVoiceRoomId !== node.activeChannelId}
					<div
						class="flex-1 flex flex-col items-center justify-center bg-zinc-900 text-zinc-400"
					>
                        <h2 class="text-xl font-semibold text-white mb-2">
                            Voice Channel
                        </h2>
                        <p>Únete desde el sidebar.</p>
                    </div>
                {/if}
            {:else}
                <div
				class="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-2"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="32"
                        height="32"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="opacity-40"
                    >
                        <path
                            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                        />
                    </svg>
                    <p class="text-sm opacity-50">Arrastra un canal aquí</p>
                </div>
            {/if}
        </div>
    </div>
{/if}
