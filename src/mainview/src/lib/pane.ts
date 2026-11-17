import { canViewRoom } from "$lib/permissions";
import type { GatewaySpace, PaneLeaf, PaneNode, Tab } from "$lib/types";

function uid(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function makeLeaf(tabs: Tab[] = [], activeChannelId: string | null = null): PaneLeaf {
	return {
		kind: "leaf",
		id: uid(),
		tabs,
		activeChannelId,
	};
}

export function makeSplit(a: PaneNode, b: PaneNode, direction: "h" | "v", ratio = 0.5): PaneNode {
	return {
		kind: "split",
		id: uid(),
		direction,
		ratio,
		a,
		b,
	};
}

export function updateLeaf(root: PaneNode, id: string, updater: (leaf: PaneLeaf) => PaneNode): PaneNode {
	if (root.kind === "leaf") {
		return root.id === id ? updater(root) : root;
	}
	return {
		...root,
		a: updateLeaf(root.a, id, updater),
		b: updateLeaf(root.b, id, updater),
	};
}

export function removeLeaf(root: PaneNode, id: string): PaneNode | null {
	if (root.kind === "leaf") {
		return root.id === id ? null : root;
	}
	const a = removeLeaf(root.a, id);
	const b = removeLeaf(root.b, id);
	if (a === null) {
		return b;
	}
	if (b === null) {
		return a;
	}
	return {
		...root,
		a,
		b,
	};
}

/**
 * A leaf's tabs once these close, and its active one: when the active tab goes, the first tab left after it takes its
 * place, or else the last one before it.
 */
export function closeTabsIn(leaf: PaneLeaf, channelIds: string[]): Pick<PaneLeaf, "tabs" | "activeChannelId"> {
	const closing = new Set(channelIds);
	const open = (t: Tab) => !closing.has(t.channelId);
	const tabs = leaf.tabs.filter(open);
	let activeChannelId = leaf.activeChannelId;
	if (activeChannelId && closing.has(activeChannelId)) {
		const idx = leaf.tabs.findIndex((t) => t.channelId === activeChannelId);
		activeChannelId =
			(leaf.tabs.slice(idx + 1).find(open) ?? leaf.tabs.slice(0, idx).findLast(open))?.channelId ?? null;
	}
	return { tabs, activeChannelId };
}

/** Whether a tab shows a conversation (a DM or a group) rather than a room. */
export function isConversationTab(tab: Pick<Tab, "kind">): boolean {
	return tab.kind === "conversation";
}

type ConversationLike = {
	id: string;
	type: number;
	name: string | null;
	members: { user_id: string; user?: { username?: string; alias?: string | null; avatar?: string | null } | null }[];
};

/** A DM's other member; a group has none. */
export function otherMember<C extends ConversationLike>(
	conv: C,
	meId: string | undefined,
): C["members"][number] | null {
	if (conv.type === 2) return null;
	return conv.members.find((m) => m.user_id !== meId) ?? null;
}

/** A conversation's name, as the DM list shows it: a group's own, or the other member's. */
export function conversationTitle(conv: ConversationLike, meId: string | undefined): string {
	if (conv.type === 2) return conv.name ?? "Group";
	const other = otherMember(conv, meId);
	return other?.user?.alias ?? other?.user?.username ?? "DM";
}

/** The tab a conversation opens in. */
export function conversationTab(conv: ConversationLike, meId: string | undefined): Tab {
	return {
		channelId: conv.id,
		channelName: conversationTitle(conv, meId),
		channelType: "conversation",
		spaceId: "",
		kind: "conversation",
	};
}

/**
 * The tree without the tabs keep turns down: a leaf left with none goes, and a split left with one side becomes that
 * side. A leaf whose active tab went shows its first one. Null when no tab is left.
 */
export function filterPaneTree(node: PaneNode, keep: (tab: Tab) => boolean): PaneNode | null {
	if (node.kind === "leaf") {
		const tabs = node.tabs.filter(keep);
		if (tabs.length === 0) return null;
		return {
			...node,
			tabs,
			activeChannelId: tabs.some((t) => t.channelId === node.activeChannelId)
				? node.activeChannelId
				: tabs[0]!.channelId,
		};
	}
	const a = filterPaneTree(node.a, keep);
	const b = filterPaneTree(node.b, keep);
	if (!a && !b) return null;
	if (!a) return b;
	if (!b) return a;
	return { ...node, a, b };
}

/** What a dragged room, conversation or tab carries (text/plain), so a pane or tab bar it's dropped on opens it. */
export function tabDragData(tab: Tab, extra: Record<string, unknown> = { type: "channel" }): string {
	return JSON.stringify({
		...extra,
		channelId: tab.channelId,
		channelName: tab.channelName,
		channelType: tab.channelType,
		spaceId: tab.spaceId,
		kind: tab.kind,
	});
}

/** The tab a drop's parsed data stands for, or null without one. */
export function tabFromDragData(data: {
	channelId?: string;
	channelName?: string;
	channelType?: string;
	spaceId?: string;
	kind?: unknown;
}): Tab | null {
	if (!data.channelId) return null;
	const tab: Tab = {
		channelId: data.channelId,
		channelName: data.channelName ?? data.channelId,
		channelType: data.channelType ?? "text",
		spaceId: data.spaceId ?? "",
	};
	if (data.kind === "conversation") tab.kind = "conversation";
	return tab;
}

/** A tab's name: a conversation's as it is now (a group renamed since, a member's new alias), a room's as opened. */
export function tabTitle(tab: Tab, conversations: ConversationLike[], meId: string | undefined): string {
	if (!isConversationTab(tab)) return tab.channelName;
	const conv = conversations.find((c) => c.id === tab.channelId);
	return conv ? conversationTitle(conv, meId) : tab.channelName;
}

/**
 * What a tab's room is for, as its space has it now (a ROOM_UPDATE changes it), none when blank. A conversation has
 * none.
 */
export function tabDescription(tab: Tab | null, spaces: GatewaySpace[]): string | null {
	if (!tab || isConversationTab(tab)) return null;
	const space = spaces.find((s) => s.id === tab.spaceId);
	return space?.rooms.find((r) => r.id === tab.channelId)?.description?.trim() || null;
}

/**
 * A tab's tooltip: its name (title), its room's space and what the room is for (tabDescription), which can always be
 * read there, as the bar shows the active room's only in what the tabs leave of it; then who's typing there (typing,
 * typingSentence's). A conversation's has its name and who's typing.
 */
export function tabTooltip(tab: Tab, title: string, spaces: GatewaySpace[], typing: string | null): string {
	const spaceName = isConversationTab(tab) ? null : spaces.find((s) => s.id === tab.spaceId)?.name;
	return [title, spaceName, tabDescription(tab, spaces), typing].filter(Boolean).join(" · ");
}

/** Whether a tab has messages the user hasn't read, and the mentions of them waiting in it (a room's or a DM's). */
export function tabNews(
	tab: Tab,
	unreadRooms: Set<string>,
	unreadConversations: Set<string>,
	mentionCounts: Record<string, number>,
): { unread: boolean; mentions: number } {
	const mentions = mentionCounts[tab.channelId] ?? 0;
	const unread = isConversationTab(tab) ? unreadConversations.has(tab.channelId) : unreadRooms.has(tab.channelId);
	return { unread: unread || mentions > 0, mentions };
}

/**
 * The IDs of the spaces and of their rooms, and whether one of those known before went: a space deleted or left, or a
 * room deleted or taken from the user (its ROOM_DELETE). Its tabs then close, as tabStaysOpen no longer keeps them.
 */
export function spacesAndRooms(
	known: ReadonlySet<string>,
	spaces: GatewaySpace[],
): { ids: Set<string>; gone: boolean } {
	const ids = new Set(spaces.flatMap((s) => [s.id, ...s.rooms.map((r) => r.id)]));
	return { ids, gone: [...known].some((id) => !ids.has(id)) };
}

/** The tabs that can stay open (filterPaneTree's keep): a room the user can still view, and a conversation still in
 * their list. */
export function tabStaysOpen(spaces: GatewaySpace[], conversationIds: Set<string>): (tab: Tab) => boolean {
	return (tab) => {
		if (isConversationTab(tab)) return conversationIds.has(tab.channelId);
		const space = spaces.find((s) => s.id === tab.spaceId);
		const room = space?.rooms.find((r) => r.id === tab.channelId);
		return !!space && !!room && canViewRoom(space, room);
	};
}
