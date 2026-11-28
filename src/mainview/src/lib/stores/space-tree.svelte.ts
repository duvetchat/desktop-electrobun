import {
	collapseAll as collapseTree,
	defaultSpaceTree,
	emptySpaceTree,
	parseSpaceTree,
	pruneSpaceTree as pruneTree,
	revealChannel,
	setCategoryOpen,
	setQuietOpen,
	setSpaceOpen,
	spaceTreeKey,
	type SpaceTreeState,
} from "$lib/space-tree";

/**
 * The Spaces tree as the user left it, saved on this device for the account in use. The component loads it when the
 * signed-in user is known and writes every explicit change; a start with nothing saved shows the active Space open.
 */
type SpaceTreeStore = SpaceTreeState & { loaded: boolean };

export const spaceTree = $state<SpaceTreeStore>({ ...emptySpaceTree(), loaded: false });

/** The tree's one tab stop: the row the keys last reached. Every other row is out of the tab order. */
export const treeFocus = $state<{ id: string | null }>({ id: null });

let storageUser: string | null = null;
let hasSaved = false;
let awaitingActiveSpace = true;

function storage(): Storage | null {
	if (typeof localStorage === "undefined") return null;
	try {
		return localStorage;
	} catch {
		return null;
	}
}

function persist() {
	const store = storage();
	if (!store || !storageUser) return;
	try {
		store.setItem(
			spaceTreeKey(storageUser),
			JSON.stringify({
				openSpaces: spaceTree.openSpaces,
				foldedCategories: spaceTree.foldedCategories,
				quietOpen: spaceTree.quietOpen,
			} satisfies SpaceTreeState),
		);
	} catch {
		// No storage (private mode, or a full quota): the tree lasts until the app closes.
	}
}

/** Loads the tree saved for a user, once per user. With nothing saved (or no user yet), it waits for the active Space
 * before opening one, so the first paint follows the gateway's answer rather than the last account's. */
export function loadSpaceTree(userId: string | null, activeSpaceId: string | null) {
	if (spaceTree.loaded && storageUser === userId) return;
	storageUser = userId;
	const store = storage();
	const raw = userId && store ? store.getItem(spaceTreeKey(userId)) : null;
	if (raw) {
		Object.assign(spaceTree, pruneTree(parseSpaceTree(raw)), { loaded: true });
		hasSaved = true;
		awaitingActiveSpace = false;
		return;
	}
	Object.assign(spaceTree, defaultSpaceTree(activeSpaceId), { loaded: true });
	hasSaved = false;
	awaitingActiveSpace = !activeSpaceId;
}

/** Before the first explicit change, follows the active Space once the gateway names it. */
export function ensureDefaultSpace(activeSpaceId: string | null) {
	if (!activeSpaceId || !spaceTree.loaded || hasSaved || !awaitingActiveSpace) return;
	Object.assign(spaceTree, setSpaceOpen(spaceTree, activeSpaceId, true));
	awaitingActiveSpace = false;
}

/** Drops saved Spaces and categories that the gateway no longer has. */
export function pruneSpaceTree(knownSpaces: Iterable<string>, knownCategories: Iterable<string>) {
	if (!spaceTree.loaded) return;
	const next = pruneTree(spaceTree, knownSpaces, knownCategories);
	const same =
		next.openSpaces.length === spaceTree.openSpaces.length &&
		next.foldedCategories.length === spaceTree.foldedCategories.length &&
		next.openSpaces.every((id) => spaceTree.openSpaces.includes(id)) &&
		next.foldedCategories.every((id) => spaceTree.foldedCategories.includes(id));
	if (same) return;
	Object.assign(spaceTree, next);
	if (hasSaved) persist();
}

function commit(next: SpaceTreeState) {
	Object.assign(spaceTree, next);
	hasSaved = true;
	awaitingActiveSpace = false;
	persist();
}

export function expandSpace(spaceId: string, open: boolean) {
	commit(setSpaceOpen(spaceTree, spaceId, open));
}

export function expandCategory(categoryId: string, open: boolean) {
	commit(setCategoryOpen(spaceTree, categoryId, open));
}

export function expandQuiet(open: boolean) {
	commit(setQuietOpen(spaceTree, open));
}

/** Opens the active channel's Space and category without touching the user's other choices. */
export function revealActiveChannel(spaceId: string, categoryId: string | null) {
	commit(revealChannel(spaceTree, spaceId, categoryId));
}

export function collapseAllSpaces(
	activeSpaceId: string | null,
	activeCategoryId: string | null,
	categories: Iterable<string>,
) {
	commit(collapseTree(spaceTree, activeSpaceId, activeCategoryId, categories));
	awaitingActiveSpace = false;
}
