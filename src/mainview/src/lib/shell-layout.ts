import { isConversationTab, makeLeaf, makeSplit, updateLeaf } from "$lib/pane";
import type { PaneLeaf, PaneNode, Tab } from "$lib/types";

// The redesigned shell's own rules (#357, docs/redesign/DESIGN-MAP.md S-01 to S-12 and §8.5 to §8.7): the title line
// and the sidebar's measures, what the sidebar remembers, which chats show under All, how a click, a ⌘-click and an
// ⌥-click open a chat, what the tab strip shows of a split, and the shell's shortcuts. The pane tree itself stays
// lib/pane.ts's, untouched: everything here reads it or builds on its functions.

// ── Measures ────────────────────────────────────────────────────────────────

/** The room macOS's traffic lights need at the window's top left (PLATFORM.md §1 measured 75 px). */
export const TRAFFIC_LIGHTS_INSET = 76;

export const SIDEBAR_MIN = 232;
export const SIDEBAR_MAX = 380;
export const SIDEBAR_DEFAULT = 288;
/** The folded edge's width (SpaceEdge). */
export const SIDEBAR_EDGE = 60;

export function clampSidebarWidth(width: number): number {
	if (!Number.isFinite(width)) return SIDEBAR_DEFAULT;
	return Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, width)));
}

// ── What the sidebar remembers ──────────────────────────────────────────────

export const SIDEBAR_PREFS_KEY = "duvet.sidebar.v1";

/** All: Chats and Spaces as two sections. Chats and Spaces: one of them alone. */
export type SidebarFilter = "all" | "chats" | "spaces";

export type SidebarPrefs = { width: number; filter: SidebarFilter };

export const defaultSidebarPrefs: SidebarPrefs = { width: SIDEBAR_DEFAULT, filter: "all" };

/** The sidebar's prefs a saved value holds, each one it lacks (or holds something else in) at its default. */
export function parseSidebarPrefs(raw: string | null): SidebarPrefs {
	const prefs = { ...defaultSidebarPrefs };
	if (!raw) return prefs;
	let saved: unknown;
	try {
		saved = JSON.parse(raw);
	} catch {
		return prefs;
	}
	if (!saved || typeof saved !== "object" || Array.isArray(saved)) return prefs;
	if ("width" in saved && typeof saved.width === "number") prefs.width = clampSidebarWidth(saved.width);
	if ("filter" in saved && (saved.filter === "all" || saved.filter === "chats" || saved.filter === "spaces")) {
		prefs.filter = saved.filter;
	}
	return prefs;
}

// ── The Chats section under All ─────────────────────────────────────────────

/** How many chats show under All before the "N more chats" row. */
export const LATEST_CHATS = 6;

/**
 * The chats the sidebar lists under All (BRIEF, settled 2026-11-18): the six latest, plus any other that `keep` says
 * stays in sight (an unread one, the open one), in the list's own order, newest first; `more` is how many the row
 * after them stands for. Expanded, they all show, and `more` still says how many "Show fewer" would put away.
 */
export function chatsUnderAll<Chat extends { id: string }>(
	chats: readonly Chat[],
	keep: (id: string) => boolean,
	expanded: boolean,
): { shown: Chat[]; more: number } {
	const folded = chats.filter((chat, index) => index < LATEST_CHATS || keep(chat.id));
	const more = chats.length - folded.length;
	return { shown: expanded ? [...chats] : folded, more };
}

const counted = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);

export const moreChatsLabel = (count: number) => counted(count, "more chat", "more chats");
export const mentionsLabel = (count: number) => counted(count, "mention", "mentions");
export const friendRequestsLabel = (count: number) => counted(count, "friend request", "friend requests");
export const quietSpacesLabel = (count: number) => counted(count, "quiet Space", "quiet Spaces");

/** A count as a chip writes it: 99+ past 99. */
export const chipCount = (count: number) => (count > 99 ? "99+" : String(count));

// ── The Spaces tree ─────────────────────────────────────────────────────────

/**
 * Whether a Space's rooms show under its row. The user's own fold or unfold of it wins, until the app closes; else a
 * busy Space is open and a quiet one folded (BRIEF): busy is the Space the focused pane is in, one with an unread room
 * or a mention, or one with people in its voice rooms.
 */
export function spaceUnfolded(
	choice: boolean | undefined,
	space: { selected: boolean; unread: boolean; inVoice: number },
): boolean {
	return choice ?? (space.selected || space.unread || space.inVoice > 0);
}

// ── Opening a chat ──────────────────────────────────────────────────────────

/** Here: in the current tab. Tab: in a new tab. Beside: in the pane beside, splitting a lone pane. */
export type OpenHow = "here" | "tab" | "beside";

type Press = { metaKey: boolean; ctrlKey: boolean; altKey: boolean; button?: number };

/**
 * How a press on a chat's row opens it (BRIEF, "Tabs and panes"): a click in the current tab; ⌘-click (Ctrl-click off
 * the Mac) or a middle click in a new tab; ⌥-click (Alt-click) beside.
 */
export function openHow(press: Press, mac: boolean): OpenHow {
	if (press.button === 1 || (mac ? press.metaKey : press.ctrlKey)) return "tab";
	if (press.altKey) return "beside";
	return "here";
}

/**
 * A pane once a chat opens in it. A chat it has already only shows (never a duplicate). Otherwise `here` puts it in
 * the active tab's place, which it takes over, and `tab` in a new tab right after the active one; a pane with no
 * active tab gets it at the end either way.
 */
export function openInLeaf(leaf: PaneLeaf, tab: Tab, how: "here" | "tab"): PaneLeaf {
	if (leaf.tabs.some((t) => t.channelId === tab.channelId)) return { ...leaf, activeChannelId: tab.channelId };
	const at = leaf.tabs.findIndex((t) => t.channelId === leaf.activeChannelId);
	if (at === -1) return { ...leaf, tabs: [...leaf.tabs, tab], activeChannelId: tab.channelId };
	const tabs =
		how === "here"
			? leaf.tabs.map((t, index) => (index === at ? tab : t))
			: [...leaf.tabs.slice(0, at + 1), tab, ...leaf.tabs.slice(at + 1)];
	return { ...leaf, tabs, activeChannelId: tab.channelId };
}

/**
 * A pane that shows a voice room once the user leaves the room (#367): the first of `choices` it can go to (the chat
 * it showed before, then rooms of the voice room's Space), its tab shown, or opened after the voice room's, which stays
 * for joining again. Never the voice room itself. A pane that shows another chat, or has nowhere to go, stays as it is.
 */
export function afterLeavingVoice(
	leaf: PaneLeaf,
	roomId: string,
	choices: readonly (Tab | null | undefined)[],
): PaneLeaf {
	if (leaf.activeChannelId !== roomId) return leaf;
	const next = choices.find((tab): tab is Tab => !!tab && tab.channelId !== roomId);
	return next ? openInLeaf(leaf, next, "tab") : leaf;
}

/** The tree's panes, in its order: left to right, top to bottom. */
export function leavesOf(node: PaneNode): PaneLeaf[] {
	return node.kind === "leaf" ? [node] : [...leavesOf(node.a), ...leavesOf(node.b)];
}

/**
 * A chat opened beside (§8.5): a lone pane gets a pane on its right with it; in a split it opens in the pane after the
 * focused one (the other pane of a pair), in its current tab. A chat the focused pane already shows stays where it is:
 * the same chat twice side by side would be one pane. Returns the tree and the pane to focus.
 */
export function openBeside(root: PaneNode, focusedId: string, tab: Tab): { root: PaneNode; focusedId: string } {
	const leaves = leavesOf(root);
	const focused = leaves.find((leaf) => leaf.id === focusedId) ?? leaves[0]!;
	if (focused.activeChannelId === tab.channelId) return { root, focusedId: focused.id };
	if (leaves.length === 1) {
		// An empty pane has nothing to sit beside: the chat opens in it.
		if (focused.tabs.length === 0) {
			return { root: updateLeaf(root, focused.id, (leaf) => openInLeaf(leaf, tab, "here")), focusedId: focused.id };
		}
		const beside = makeLeaf([tab], tab.channelId);
		return { root: updateLeaf(root, focused.id, (leaf) => makeSplit(leaf, beside, "h")), focusedId: beside.id };
	}
	const other = leaves[(leaves.indexOf(focused) + 1) % leaves.length]!;
	return { root: updateLeaf(root, other.id, (leaf) => openInLeaf(leaf, tab, "here")), focusedId: other.id };
}

/** The pane that has a chat among its tabs, shown or not; null when none has. */
export function leafWithTab(node: PaneNode, channelId: string): PaneLeaf | null {
	if (node.kind === "leaf") return node.tabs.some((t) => t.channelId === channelId) ? node : null;
	return leafWithTab(node.a, channelId) ?? leafWithTab(node.b, channelId);
}

/**
 * A chat opened from the sidebar, the switcher or a notice: in the focused pane, or shown there when it's open in it
 * already (never a duplicate). A click puts it in the current tab, ⌘-click or a middle click in a new tab after it,
 * and ⌥-click in the pane beside, which a lone pane gets for it (BRIEF, "Tabs and panes"). From the Friends page,
 * which stands in the strip as a tab of its own, a click opens a tab rather than take over the one the page was
 * hiding. Returns the tree and the pane to focus.
 */
export function openTabIn(
	root: PaneNode,
	focusedId: string,
	tab: Tab,
	how: OpenHow = "here",
	fromFriends = false,
): { root: PaneNode; focusedId: string } {
	if (how === "beside") return openBeside(root, focusedId, tab);
	const into = fromFriends ? "tab" : how;
	return { root: updateLeaf(root, focusedId, (leaf) => openInLeaf(leaf, tab, into)), focusedId };
}

/**
 * Where a conversation (a DM or a group) opens: in the pane that has it open already, shown there whatever the press
 * was, or else in the focused pane as the press asks.
 */
export function conversationTarget(
	root: PaneNode,
	focusedId: string,
	conversationId: string,
	how: OpenHow = "here",
): { focusedId: string; how: OpenHow } {
	const holder = leafWithTab(root, conversationId);
	return holder ? { focusedId: holder.id, how: "here" } : { focusedId, how };
}

/**
 * A split put back into one pane ("Separate split view"): the focused pane keeps its tabs and its active one, and
 * takes the other panes' tabs after them, each once. Two chats side by side become two tabs.
 */
export function mergedLeaf(root: PaneNode, focusedId: string): PaneLeaf {
	const leaves = leavesOf(root);
	const focused = leaves.find((leaf) => leaf.id === focusedId) ?? leaves[0]!;
	const tabs = [...focused.tabs];
	for (const leaf of leaves) {
		for (const tab of leaf.tabs) if (!tabs.some((t) => t.channelId === tab.channelId)) tabs.push(tab);
	}
	return { ...focused, tabs };
}

// ── The tab strip ───────────────────────────────────────────────────────────

/** One side of the strip's joined tab: a pane of the split and the chat it shows. */
export type StripHalf = { leafId: string; tab: Tab | null; focused: boolean };

/**
 * What the strip's active tab shows of a split: each pane's chat, in the tree's order, the focused one marked. Two
 * panes side by side are the design's pair; a deeper or a vertical split (which the app keeps) lists each of its
 * panes the same way. Empty for a lone pane, whose active tab is a plain tab.
 */
export function stripHalves(root: PaneNode, focusedId: string): StripHalf[] {
	const leaves = leavesOf(root);
	if (leaves.length < 2) return [];
	return leaves.map((leaf) => ({
		leafId: leaf.id,
		tab: leaf.tabs.find((t) => t.channelId === leaf.activeChannelId) ?? null,
		focused: leaf.id === focusedId,
	}));
}

/** Where on a tab something dragged over it would land: its left or right quarter, or its middle (a join). */
export function tabDropSide(offsetX: number, width: number): "before" | "join" | "after" {
	if (width <= 0) return "after";
	const at = offsetX / width;
	return at < 0.25 ? "before" : at > 0.75 ? "after" : "join";
}

/** A tab's place in the strip, as the pointer sees it. */
export interface TabRect {
	id: string | null;
	left: number;
	right: number;
	width: number;
}

/**
 * Where something dragged over the strip would land: on a tab's middle it joins that tab (`joinId`), elsewhere it
 * goes between two tabs, at `index`: before the first tab the pointer hasn't passed, or after the last one.
 * A tab that isn't drawn (null) is passed over.
 */
export function tabDropTarget(
	rects: readonly (TabRect | null)[],
	clientX: number,
): { index: number; joinId: string | null } {
	for (let i = 0; i < rects.length; i++) {
		const rect = rects[i];
		if (!rect) continue;
		if (clientX > rect.right) continue;
		const side = clientX < rect.left ? "before" : tabDropSide(clientX - rect.left, rect.width);
		if (side === "join") return { index: i, joinId: rect.id };
		return { index: side === "before" ? i : i + 1, joinId: null };
	}
	return { index: rects.length, joinId: null };
}

/** The tabs after one of them is dragged to a gap (`at`, counted before it left): to the right of where it was, the
 * gap is one place nearer once it's out. Null when there is no such tab. */
export function movedTabs(tabs: readonly Tab[], from: number, at: number): Tab[] | null {
	const arr = [...tabs];
	const [moved] = arr.splice(from, 1);
	if (!moved) return null;
	const insertAt = Math.max(0, Math.min(at > from ? at - 1 : at, arr.length));
	arr.splice(insertAt, 0, moved);
	return arr;
}

/** What a drop on the strip does. */
export type StripDrop =
	/** A tab of the strip dropped on another's middle: the two side by side. */
	| { kind: "split"; keepId: string; moveId: string }
	/** A tab of the strip dropped between two: the strip's new order. */
	| { kind: "reorder"; tabs: Tab[] }
	/** A room or a conversation from the sidebar dropped on a tab's middle: it opens beside. */
	| { kind: "join"; tab: Tab }
	/** One dropped between two tabs: it opens as a tab there, or at the end (null). */
	| { kind: "open"; tab: Tab; at: number | null };

/**
 * What a drop on the strip does: `dropped` is what the drag carried, `from` the index of the strip's own tab being
 * dragged (null for something from the sidebar), `at` the gap and `joinId` the tab under the pointer as the drag last
 * showed them. Null when it does nothing: a tab of the strip dropped where no gap was shown.
 */
export function stripDrop(
	tabs: readonly Tab[],
	dropped: Tab,
	isTab: boolean,
	from: number | null,
	at: number | null,
	joinId: string | null,
): StripDrop | null {
	if (isTab && from !== null) {
		if (joinId) return { kind: "split", keepId: joinId, moveId: dropped.channelId };
		if (at === null) return null;
		const moved = movedTabs(tabs, from, at);
		return moved ? { kind: "reorder", tabs: moved } : null;
	}
	return joinId ? { kind: "join", tab: dropped } : { kind: "open", tab: dropped, at };
}

/** A chat's kind, for a line under its name: a conversation is a group or a direct message; a room has none. */
export function tabKind(tab: Tab, groupIds: ReadonlySet<string>): "Group" | "Direct message" | null {
	if (!isConversationTab(tab)) return null;
	return groupIds.has(tab.channelId) ? "Group" : "Direct message";
}

// ── Shortcuts ───────────────────────────────────────────────────────────────

export type ShellCommand = "toggle-sidebar" | "new-tab" | "close-tab" | "next-tab" | "previous-tab";

type Key = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };

/**
 * The shell's own shortcuts (§8.10, COPY.md §6), beside the ones the app already had (lib/keyboard.ts, and Ctrl+W in
 * PaneView, which stay):
 *   - show or hide the sidebar: ⌃⌘S on macOS, Ctrl Shift S elsewhere, in the app and on the web;
 *   - in the desktop app only, as a browser keeps them for its own tabs: new tab (⌘T / Ctrl T), close tab (⌘W; Ctrl W
 *     is PaneView's on every system), next and previous tab (⌃Tab / ⌃⇧Tab).
 */
export function shellShortcut(event: Key, { mac, desktop }: { mac: boolean; desktop: boolean }): ShellCommand | null {
	const key = event.key.toLowerCase();
	if (key === "s" && !event.altKey) {
		if (mac ? event.metaKey && event.ctrlKey && !event.shiftKey : event.ctrlKey && event.shiftKey && !event.metaKey) {
			return "toggle-sidebar";
		}
	}
	if (!desktop) return null;
	if (key === "tab" && event.ctrlKey && !event.metaKey && !event.altKey) {
		return event.shiftKey ? "previous-tab" : "next-tab";
	}
	const command = mac
		? event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
		: event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
	if (!command) return null;
	if (key === "t") return "new-tab";
	// Ctrl+W closes a tab on every system already (PaneView): only macOS's own ⌘W is new.
	if (key === "w" && mac) return "close-tab";
	return null;
}

/** Settings' shortcut (BRIEF, "Windows"): ⌘, on macOS, Ctrl , elsewhere. */
export function isSettingsShortcut(event: Key, mac: boolean): boolean {
	if (event.key !== "," || event.altKey || event.shiftKey) return false;
	return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** The tab a step from the active one lands on, going round; null with no tabs. */
export function steppedTab(tabIds: readonly string[], activeId: string | null, step: 1 | -1): string | null {
	if (tabIds.length === 0) return null;
	const at = activeId ? tabIds.indexOf(activeId) : -1;
	if (at === -1) return tabIds[step === 1 ? 0 : tabIds.length - 1]!;
	return tabIds[(at + step + tabIds.length) % tabIds.length]!;
}

/** A shortcut as the app writes it for this system: "⌃⌘S" on macOS, "Ctrl Shift S" elsewhere (DECISIONS.md). */
export function keysFor(mac: boolean, keys: { mac: string; other: string }): string {
	return mac ? keys.mac : keys.other;
}

export const SHELL_KEYS = {
	switcher: { mac: "⌘K", other: "Ctrl K" },
	sidebar: { mac: "⌃⌘S", other: "Ctrl Shift S" },
	newTab: { mac: "⌘T", other: "Ctrl T" },
	closeTab: { mac: "⌘W", other: "Ctrl W" },
	openInTab: { mac: "⌘-click", other: "Ctrl-click" },
	openBeside: { mac: "⌥-click", other: "Alt-click" },
} as const;
