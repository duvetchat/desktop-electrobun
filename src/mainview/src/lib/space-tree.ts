import type { Channel } from "$lib/types";

/**
 * The Spaces tree's state, saved per user: the Spaces the user left open, the categories they folded, and whether the
 * quiet Spaces' row is open. Categories are listed folded rather than open, so a new category starts open, as it does
 * in the gateway's own client. Every list is explicit and serializable.
 */
export type SpaceTreeState = {
	openSpaces: string[];
	foldedCategories: string[];
	quietOpen: boolean;
};

/** Where a user's tree is saved on this device. The user's ID follows, so two accounts keep their own. */
export const SPACE_TREE_KEY = "duvet.nav.spaces.v1";

export function spaceTreeKey(userId: string): string {
	return `${SPACE_TREE_KEY}.${userId}`;
}

/** A tree with nothing open, used before the active Space is known. */
export function emptySpaceTree(): SpaceTreeState {
	return { openSpaces: [], foldedCategories: [], quietOpen: false };
}

/** The tree the first start shows: the active Space open, the others folded, and the quiet Spaces' row folded. */
export function defaultSpaceTree(activeSpaceId: string | null): SpaceTreeState {
	return {
		openSpaces: activeSpaceId ? [activeSpaceId] : [],
		foldedCategories: [],
		quietOpen: false,
	};
}

const strings = (value: unknown): string[] =>
	Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === "string"))] : [];

/**
 * A saved tree, with the IDs that no longer exist left out; anything malformed falls back to an empty tree. The known
 * sets are those the caller can see now: omitting one keeps its saved IDs, for a restore that runs before the gateway
 * has sent its Spaces.
 */
export function parseSpaceTree(
	raw: string | null,
	knownSpaces?: Iterable<string>,
	knownCategories?: Iterable<string>,
): SpaceTreeState {
	if (!raw) return emptySpaceTree();
	let saved: unknown;
	try {
		saved = JSON.parse(raw);
	} catch {
		return emptySpaceTree();
	}
	if (!saved || typeof saved !== "object" || Array.isArray(saved)) return emptySpaceTree();
	const state: SpaceTreeState = {
		openSpaces: strings("openSpaces" in saved ? saved.openSpaces : []),
		foldedCategories: strings("foldedCategories" in saved ? saved.foldedCategories : []),
		quietOpen: "quietOpen" in saved && saved.quietOpen === true,
	};
	return pruneSpaceTree(state, knownSpaces, knownCategories);
}

/** The tree without the Spaces and categories that are gone from the gateway. */
export function pruneSpaceTree(
	state: SpaceTreeState,
	knownSpaces?: Iterable<string>,
	knownCategories?: Iterable<string>,
): SpaceTreeState {
	const spaces = knownSpaces ? new Set(knownSpaces) : null;
	const categories = knownCategories ? new Set(knownCategories) : null;
	const openSpaces = spaces ? state.openSpaces.filter((id) => spaces.has(id)) : [...state.openSpaces];
	const foldedCategories = categories
		? state.foldedCategories.filter((id) => categories.has(id))
		: [...state.foldedCategories];
	return { openSpaces, foldedCategories, quietOpen: state.quietOpen };
}

export function isSpaceOpen(state: SpaceTreeState, spaceId: string): boolean {
	return state.openSpaces.includes(spaceId);
}

export function isCategoryOpen(state: SpaceTreeState, categoryId: string): boolean {
	return !state.foldedCategories.includes(categoryId);
}

export function setSpaceOpen(state: SpaceTreeState, spaceId: string, open: boolean): SpaceTreeState {
	const has = state.openSpaces.includes(spaceId);
	if (has === open) return state;
	return {
		...state,
		openSpaces: open ? [...state.openSpaces, spaceId] : state.openSpaces.filter((id) => id !== spaceId),
	};
}

export function setCategoryOpen(state: SpaceTreeState, categoryId: string, open: boolean): SpaceTreeState {
	const has = state.foldedCategories.includes(categoryId);
	if (has === !open) return state;
	return {
		...state,
		foldedCategories: open
			? state.foldedCategories.filter((id) => id !== categoryId)
			: [...state.foldedCategories, categoryId],
	};
}

export function setQuietOpen(state: SpaceTreeState, open: boolean): SpaceTreeState {
	return state.quietOpen === open ? state : { ...state, quietOpen: open };
}

/**
 * Reveals a channel: its Space and its category open, without folding anything else. A notification, a link or a
 * shortcut lands on the channel with its tree already showing it.
 */
export function revealChannel(state: SpaceTreeState, spaceId: string, categoryId: string | null): SpaceTreeState {
	const opened = setSpaceOpen(state, spaceId, true);
	return categoryId ? setCategoryOpen(opened, categoryId, true) : opened;
}

/**
 * "Collapse all": every Space folds but the one with the active channel, every category folds but that channel's, and
 * the quiet Spaces' row folds. The active channel stays visible; nothing else does.
 */
export function collapseAll(
	state: SpaceTreeState,
	activeSpaceId: string | null,
	activeCategoryId: string | null,
	categories: Iterable<string>,
): SpaceTreeState {
	return {
		openSpaces: activeSpaceId ? [activeSpaceId] : [],
		foldedCategories: [...new Set(categories)].filter((id) => id !== activeCategoryId),
		quietOpen: false,
	};
}

/** A folded row's look: the mentions waiting under it, or a mark that something there is unread. */
export type TreeNews = { mentions: number; unread: boolean };

export const noNews: TreeNews = { mentions: 0, unread: false };

/**
 * What a category's row shows about its rooms: their mentions added up (a mention also counts as unread), and whether
 * any text room is unread. The sets and counts are the shown ones, so a silenced place is already left out.
 */
export function categoryNews(
	rooms: readonly Channel[],
	unreadRooms: ReadonlySet<string>,
	mentionCounts: Readonly<Record<string, number>>,
): TreeNews {
	let mentions = 0;
	let unread = false;
	for (const room of rooms) {
		if (room.type !== "text") continue;
		const count = mentionCounts[room.id] ?? 0;
		mentions += count;
		if (count > 0 || unreadRooms.has(room.id)) unread = true;
	}
	return { mentions, unread };
}

/** The mentions and the unread mark of several rows together, for a parent that is folded. */
export function summariseNews(rows: Iterable<TreeNews>): TreeNews {
	let mentions = 0;
	let unread = false;
	for (const news of rows) {
		mentions += news.mentions;
		unread ||= news.unread || news.mentions > 0;
	}
	return { mentions, unread };
}

/**
 * The totals of the whole column, leaving out silenced Spaces: a Space whose level is "nothing" doesn't light the
 * sidebar's unread dot or add to any global mention count.
 */
export function sumSpaces(spaces: Iterable<{ news: TreeNews; silenced?: boolean }>): TreeNews {
	const shown: TreeNews[] = [];
	for (const space of spaces) if (!space.silenced) shown.push(space.news);
	return summariseNews(shown);
}
