import { beforeEach, describe, expect, test } from "bun:test";
import {
	categoryNews,
	collapseAll,
	defaultSpaceTree,
	emptySpaceTree,
	isCategoryOpen,
	isSpaceOpen,
	parseSpaceTree,
	pruneSpaceTree,
	revealChannel,
	setCategoryOpen,
	setQuietOpen,
	setSpaceOpen,
	spaceTreeKey,
	sumSpaces,
	summariseNews,
	type SpaceTreeState,
} from "$lib/space-tree";
import type { Channel } from "$lib/types";

// The store modules use runes, which only Svelte's compiler knows: here they are the values themselves.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const store = await import("$lib/stores/space-tree.svelte");

const room = (id: string, type: Channel["type"] = "text"): Channel => ({ id, name: id, type, position: 0 });

describe("the Spaces tree's state", () => {
	test("starts with the active Space open, the rest folded, and Quiet folded", () => {
		expect(defaultSpaceTree("a")).toEqual({ openSpaces: ["a"], foldedCategories: [], quietOpen: false });
		expect(defaultSpaceTree(null)).toEqual(emptySpaceTree());
	});

	test("toggles Spaces and categories without duplicating an ID", () => {
		let tree = emptySpaceTree();
		tree = setSpaceOpen(tree, "a", true);
		tree = setSpaceOpen(tree, "a", true);
		tree = setSpaceOpen(tree, "b", true);
		expect(tree.openSpaces).toEqual(["a", "b"]);
		expect(isSpaceOpen(tree, "a")).toBe(true);
		tree = setSpaceOpen(tree, "a", false);
		expect(tree.openSpaces).toEqual(["b"]);

		// A category is open until it is folded, so folding lists it and unfolding drops it.
		tree = setCategoryOpen(tree, "c1", false);
		expect(tree.foldedCategories).toEqual(["c1"]);
		expect(isCategoryOpen(tree, "c1")).toBe(false);
		expect(isCategoryOpen(tree, "c2")).toBe(true);
		tree = setCategoryOpen(tree, "c1", true);
		expect(tree.foldedCategories).toEqual([]);
		tree = setQuietOpen(tree, true);
		expect(tree.quietOpen).toBe(true);
	});

	test("restores a saved tree and ignores IDs that no longer exist", () => {
		const saved = JSON.stringify({
			openSpaces: ["a", "gone", "a", 2],
			foldedCategories: ["c1", "gone"],
			quietOpen: "yes",
		});
		expect(parseSpaceTree(saved, ["a", "b"], ["c1", "c2"])).toEqual({
			openSpaces: ["a"],
			foldedCategories: ["c1"],
			quietOpen: false,
		});
		// A value that isn't a tree is nothing, and a known set left out keeps every ID.
		expect(parseSpaceTree("not json")).toEqual(emptySpaceTree());
		expect(parseSpaceTree(saved)).toEqual({
			openSpaces: ["a", "gone"],
			foldedCategories: ["c1", "gone"],
			quietOpen: false,
		});
		expect(pruneSpaceTree(defaultSpaceTree("gone"), ["a"], [])).toEqual(defaultSpaceTree(null));
	});

	test("a user's tree has its own saved key", () => {
		expect(spaceTreeKey("u1")).not.toBe(spaceTreeKey("u2"));
		expect(spaceTreeKey("u1")).toContain("u1");
	});
});

describe("revealing and collapsing", () => {
	test("revealing a channel opens its Space and category without folding anything else", () => {
		const tree: SpaceTreeState = {
			openSpaces: ["other"],
			foldedCategories: ["c1", "c2"],
			quietOpen: false,
		};
		const revealed = revealChannel(tree, "a", "c1");
		expect(revealed.openSpaces).toEqual(["other", "a"]);
		expect(revealed.foldedCategories).toEqual(["c2"]);
		expect(revealed.quietOpen).toBe(false);
	});

	test("collapse all leaves only the active channel's Space and category visible", () => {
		const tree: SpaceTreeState = {
			openSpaces: ["a", "b", "c"],
			foldedCategories: [],
			quietOpen: true,
		};
		const collapsed = collapseAll(tree, "b", "c2", ["c1", "c2", "c3"]);
		expect(collapsed).toEqual({
			openSpaces: ["b"],
			foldedCategories: ["c1", "c3"],
			quietOpen: false,
		});
		// With no active channel there is nothing to keep open.
		expect(collapseAll(tree, null, null, ["c1"]).openSpaces).toEqual([]);
	});
});

describe("the folded rows' indicators", () => {
	test("a category adds up its text rooms' mentions, and a mention also means unread", () => {
		const rooms = [room("a"), room("b"), room("voice", "voice")];
		expect(categoryNews(rooms, new Set(["a"]), { b: 2 })).toEqual({ mentions: 2, unread: true });
		expect(categoryNews(rooms, new Set(["a"]), {})).toEqual({ mentions: 0, unread: true });
		expect(categoryNews(rooms, new Set(), { voice: 9 })).toEqual({ mentions: 0, unread: false });
	});

	test("parents combine their children, mentions first", () => {
		expect(
			summariseNews([
				{ mentions: 0, unread: true },
				{ mentions: 2, unread: true },
			]),
		).toEqual({
			mentions: 2,
			unread: true,
		});
		expect(summariseNews([])).toEqual({ mentions: 0, unread: false });
	});

	test("silenced Spaces stay out of the column's totals", () => {
		const spaces = [
			{ news: { mentions: 2, unread: true } },
			{ news: { mentions: 5, unread: true }, silenced: true },
			{ news: { mentions: 0, unread: true } },
		];
		expect(sumSpaces(spaces)).toEqual({ mentions: 2, unread: true });
		expect(sumSpaces([{ news: { mentions: 1, unread: true }, silenced: true }])).toEqual({
			mentions: 0,
			unread: false,
		});
	});
});

describe("the saved tree", () => {
	beforeEach(() => localStorage.clear());

	test("is written per user, and restored for that user alone", () => {
		localStorage.setItem(
			spaceTreeKey("u1"),
			JSON.stringify({ openSpaces: ["a"], foldedCategories: ["c1"], quietOpen: true }),
		);
		store.loadSpaceTree("u1", null);
		expect(store.spaceTree.openSpaces).toEqual(["a"]);
		expect(store.spaceTree.foldedCategories).toEqual(["c1"]);
		expect(store.spaceTree.quietOpen).toBe(true);

		store.expandSpace("b", true);
		expect(JSON.parse(localStorage.getItem(spaceTreeKey("u1"))!).openSpaces).toEqual(["a", "b"]);

		store.loadSpaceTree("u2", null);
		expect(store.spaceTree.openSpaces).toEqual([]);
		expect(localStorage.getItem(spaceTreeKey("u2"))).toBeNull();
	});

	test("starts from the active Space, and prunes what the gateway no longer sends", () => {
		store.loadSpaceTree("u3", "a");
		expect(store.spaceTree.openSpaces).toEqual(["a"]);
		expect(store.spaceTree.loaded).toBe(true);

		store.expandCategory("c2", false);
		store.pruneSpaceTree(["b"], ["c1"]);
		expect(store.spaceTree.openSpaces).toEqual([]);
		expect(store.spaceTree.foldedCategories).toEqual([]);
	});
});
