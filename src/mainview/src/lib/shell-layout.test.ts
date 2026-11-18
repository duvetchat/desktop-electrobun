import { describe, expect, test } from "bun:test";
import { makeLeaf, makeSplit } from "$lib/pane";
import {
	chatsUnderAll,
	chipCount,
	clampSidebarWidth,
	defaultSidebarPrefs,
	friendRequestsLabel,
	keysFor,
	leavesOf,
	mentionsLabel,
	mergedLeaf,
	moreChatsLabel,
	openBeside,
	openHow,
	openInLeaf,
	parseSidebarPrefs,
	quietSpacesLabel,
	shellShortcut,
	SHELL_KEYS,
	SIDEBAR_DEFAULT,
	SIDEBAR_MAX,
	SIDEBAR_MIN,
	spaceUnfolded,
	steppedTab,
	stripHalves,
	tabDropSide,
	tabKind,
} from "$lib/shell-layout";
import type { PaneLeaf, PaneNode, Tab } from "$lib/types";

const room = (id: string, spaceId = "s1"): Tab => ({ channelId: id, channelName: id, channelType: "text", spaceId });
const chat = (id: string): Tab => ({
	channelId: id,
	channelName: id,
	channelType: "conversation",
	spaceId: "",
	kind: "conversation",
});
const ids = (leaf: PaneLeaf) => leaf.tabs.map((t) => t.channelId);
const leaf = (node: PaneNode, id: string) => leavesOf(node).find((l) => l.id === id)!;

describe("the sidebar's width", () => {
	test("stays between 232 and 380, whole pixels", () => {
		expect(clampSidebarWidth(100)).toBe(SIDEBAR_MIN);
		expect(clampSidebarWidth(1000)).toBe(SIDEBAR_MAX);
		expect(clampSidebarWidth(300.4)).toBe(300);
		expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT);
	});

	test("and its filter come back from what was saved, each at its default when it's missing or wrong", () => {
		expect(parseSidebarPrefs(null)).toEqual(defaultSidebarPrefs);
		expect(parseSidebarPrefs("not json")).toEqual(defaultSidebarPrefs);
		expect(parseSidebarPrefs("[]")).toEqual(defaultSidebarPrefs);
		expect(parseSidebarPrefs('{"width":340,"filter":"spaces"}')).toEqual({ width: 340, filter: "spaces" });
		expect(parseSidebarPrefs('{"width":9000,"filter":"rooms"}')).toEqual({ width: SIDEBAR_MAX, filter: "all" });
		expect(parseSidebarPrefs('{"width":"wide"}')).toEqual(defaultSidebarPrefs);
	});
});

describe("the chats under All", () => {
	const chats = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` }));

	test("are the six latest, then a row for the rest", () => {
		const { shown, more } = chatsUnderAll(chats, () => false, false);
		expect(shown.map((c) => c.id)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
		expect(more).toBe(4);
	});

	test("keep an unread chat and the open one in sight, in the list's order", () => {
		const { shown, more } = chatsUnderAll(chats, (id) => id === "c8" || id === "c6", false);
		expect(shown.map((c) => c.id)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c8"]);
		expect(more).toBe(2);
	});

	test("all show once expanded, and the row still knows how many it would put away", () => {
		const { shown, more } = chatsUnderAll(chats, () => false, true);
		expect(shown).toHaveLength(10);
		expect(more).toBe(4);
	});

	test("have no row when six or fewer", () => {
		expect(chatsUnderAll(chats.slice(0, 6), () => false, false).more).toBe(0);
		expect(chatsUnderAll([], () => false, false)).toEqual({ shown: [], more: 0 });
	});
});

test("counts agree with their nouns, and chips stop at 99+", () => {
	expect(moreChatsLabel(1)).toBe("1 more chat");
	expect(moreChatsLabel(4)).toBe("4 more chats");
	expect(mentionsLabel(1)).toBe("1 mention");
	expect(mentionsLabel(3)).toBe("3 mentions");
	expect(friendRequestsLabel(1)).toBe("1 friend request");
	expect(friendRequestsLabel(2)).toBe("2 friend requests");
	expect(quietSpacesLabel(1)).toBe("1 quiet Space");
	expect(quietSpacesLabel(5)).toBe("5 quiet Spaces");
	expect(chipCount(99)).toBe("99");
	expect(chipCount(100)).toBe("99+");
});

describe("a Space's tree", () => {
	const quiet = { selected: false, unread: false, inVoice: 0 };

	test("is open for a busy Space and folded for a quiet one", () => {
		expect(spaceUnfolded(undefined, quiet)).toBe(false);
		expect(spaceUnfolded(undefined, { ...quiet, selected: true })).toBe(true);
		expect(spaceUnfolded(undefined, { ...quiet, unread: true })).toBe(true);
		expect(spaceUnfolded(undefined, { ...quiet, inVoice: 2 })).toBe(true);
	});

	test("stays as the user folded or unfolded it", () => {
		expect(spaceUnfolded(true, quiet)).toBe(true);
		expect(spaceUnfolded(false, { selected: true, unread: true, inVoice: 3 })).toBe(false);
	});
});

describe("how a press opens a chat", () => {
	const press = { metaKey: false, ctrlKey: false, altKey: false, button: 0 };

	test("a click opens it in the current tab", () => {
		expect(openHow(press, true)).toBe("here");
		expect(openHow(press, false)).toBe("here");
	});

	test("⌘-click on macOS, Ctrl-click elsewhere and a middle click open a new tab", () => {
		expect(openHow({ ...press, metaKey: true }, true)).toBe("tab");
		expect(openHow({ ...press, ctrlKey: true }, false)).toBe("tab");
		expect(openHow({ ...press, button: 1 }, true)).toBe("tab");
		// The other system's key isn't the shortcut: Ctrl-click on macOS is the secondary click.
		expect(openHow({ ...press, ctrlKey: true }, true)).toBe("here");
		expect(openHow({ ...press, metaKey: true }, false)).toBe("here");
	});

	test("⌥-click opens it beside", () => {
		expect(openHow({ ...press, altKey: true }, true)).toBe("beside");
		expect(openHow({ ...press, altKey: true }, false)).toBe("beside");
	});
});

describe("a chat opening in a pane", () => {
	const pane = makeLeaf([room("a"), room("b"), room("c")], "b");

	test("takes the current tab's place on a click", () => {
		const next = openInLeaf(pane, room("x"), "here");
		expect(ids(next)).toEqual(["a", "x", "c"]);
		expect(next.activeChannelId).toBe("x");
	});

	test("gets a new tab after the current one on a ⌘-click", () => {
		const next = openInLeaf(pane, room("x"), "tab");
		expect(ids(next)).toEqual(["a", "b", "x", "c"]);
		expect(next.activeChannelId).toBe("x");
	});

	test("only shows when the pane has it already: never a duplicate", () => {
		for (const how of ["here", "tab"] as const) {
			const next = openInLeaf(pane, room("c"), how);
			expect(ids(next)).toEqual(["a", "b", "c"]);
			expect(next.activeChannelId).toBe("c");
		}
	});

	test("goes at the end of a pane with no active tab", () => {
		expect(ids(openInLeaf(makeLeaf(), room("x"), "here"))).toEqual(["x"]);
		const idle = makeLeaf([room("a")], null);
		expect(ids(openInLeaf(idle, room("x"), "here"))).toEqual(["a", "x"]);
	});

	test("leaves the pane it was given as it was", () => {
		openInLeaf(pane, room("x"), "here");
		expect(ids(pane)).toEqual(["a", "b", "c"]);
	});
});

describe("a chat opening beside", () => {
	test("gives a lone pane a pane on its right, and focuses it", () => {
		const lone = makeLeaf([room("a")], "a");
		const { root, focusedId } = openBeside(lone, lone.id, chat("x"));
		expect(root.kind).toBe("split");
		if (root.kind !== "split") return;
		expect(root.direction).toBe("h");
		expect(root.a).toEqual(lone);
		expect(leaf(root, focusedId).activeChannelId).toBe("x");
		expect(leavesOf(root).map((l) => l.id)).toEqual([lone.id, focusedId]);
	});

	test("opens in an empty lone pane rather than beside nothing", () => {
		const empty = makeLeaf();
		const { root, focusedId } = openBeside(empty, empty.id, room("x"));
		expect(root.kind).toBe("leaf");
		expect(focusedId).toBe(empty.id);
		expect(leaf(root, empty.id).activeChannelId).toBe("x");
	});

	test("takes the other pane's current tab in a pair", () => {
		const left = makeLeaf([room("a")], "a");
		const right = makeLeaf([room("b"), room("c")], "b");
		const { root, focusedId } = openBeside(makeSplit(left, right, "h"), left.id, room("x"));
		expect(focusedId).toBe(right.id);
		expect(ids(leaf(root, right.id))).toEqual(["x", "c"]);
		// From the last pane, the one beside is the first.
		const back = openBeside(makeSplit(left, right, "h"), right.id, room("x"));
		expect(back.focusedId).toBe(left.id);
	});

	test("leaves the same chat in one pane, not twice side by side", () => {
		const lone = makeLeaf([room("a")], "a");
		expect(openBeside(lone, lone.id, room("a"))).toEqual({ root: lone, focusedId: lone.id });
	});
});

test("separating a split makes its panes' chats tabs of the focused pane, each once", () => {
	const left = makeLeaf([room("a"), room("b")], "a");
	const right = makeLeaf([room("b"), chat("x")], "x");
	const merged = mergedLeaf(makeSplit(left, right, "h"), right.id);
	expect(merged.id).toBe(right.id);
	expect(ids(merged)).toEqual(["b", "x", "a"]);
	expect(merged.activeChannelId).toBe("x");
});

describe("the strip's joined tab", () => {
	test("is nothing for a lone pane", () => {
		const lone = makeLeaf([room("a")], "a");
		expect(stripHalves(lone, lone.id)).toEqual([]);
	});

	test("has a half for each pane of a split, in order, the focused one marked", () => {
		const left = makeLeaf([room("a")], "a");
		const right = makeLeaf([chat("x"), room("b")], "x");
		const below = makeLeaf();
		const tree = makeSplit(makeSplit(left, right, "h"), below, "v");
		const halves = stripHalves(tree, right.id);
		expect(halves.map((h) => h.tab?.channelId ?? null)).toEqual(["a", "x", null]);
		expect(halves.map((h) => h.focused)).toEqual([false, true, false]);
		expect(halves.map((h) => h.leafId)).toEqual([left.id, right.id, below.id]);
	});
});

test("a drop on a tab lands before it, after it, or joins it, by quarters", () => {
	expect(tabDropSide(10, 200)).toBe("before");
	expect(tabDropSide(100, 200)).toBe("join");
	expect(tabDropSide(190, 200)).toBe("after");
	expect(tabDropSide(0, 0)).toBe("after");
});

test("a conversation's tab is a group's or a direct message's; a room's has no kind", () => {
	const groups = new Set(["g"]);
	expect(tabKind(chat("g"), groups)).toBe("Group");
	expect(tabKind(chat("d"), groups)).toBe("Direct message");
	expect(tabKind(room("r"), groups)).toBeNull();
});

describe("the shell's shortcuts", () => {
	const key = (k: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
		key: k,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		...mods,
	});
	const macApp = { mac: true, desktop: true };
	const winApp = { mac: false, desktop: true };
	const web = { mac: false, desktop: false };
	const macWeb = { mac: true, desktop: false };

	test("⌃⌘S on macOS and Ctrl Shift S elsewhere show or hide the sidebar, on the web too", () => {
		expect(shellShortcut(key("s", { metaKey: true, ctrlKey: true }), macApp)).toBe("toggle-sidebar");
		expect(shellShortcut(key("s", { metaKey: true, ctrlKey: true }), macWeb)).toBe("toggle-sidebar");
		expect(shellShortcut(key("S", { ctrlKey: true, shiftKey: true }), winApp)).toBe("toggle-sidebar");
		expect(shellShortcut(key("S", { ctrlKey: true, shiftKey: true }), web)).toBe("toggle-sidebar");
		expect(shellShortcut(key("s", { metaKey: true }), macApp)).toBeNull();
		expect(shellShortcut(key("s", { ctrlKey: true }), winApp)).toBeNull();
	});

	test("the tab shortcuts work in the desktop app only: a browser keeps them for its own tabs", () => {
		expect(shellShortcut(key("t", { metaKey: true }), macApp)).toBe("new-tab");
		expect(shellShortcut(key("t", { ctrlKey: true }), winApp)).toBe("new-tab");
		expect(shellShortcut(key("Tab", { ctrlKey: true }), macApp)).toBe("next-tab");
		expect(shellShortcut(key("Tab", { ctrlKey: true, shiftKey: true }), winApp)).toBe("previous-tab");
		for (const where of [web, macWeb]) {
			expect(shellShortcut(key("t", { metaKey: true }), where)).toBeNull();
			expect(shellShortcut(key("t", { ctrlKey: true }), where)).toBeNull();
			expect(shellShortcut(key("Tab", { ctrlKey: true }), where)).toBeNull();
			expect(shellShortcut(key("w", { metaKey: true }), where)).toBeNull();
		}
	});

	test("⌘W closes a tab on macOS; Ctrl W stays the pane's own, on every system", () => {
		expect(shellShortcut(key("w", { metaKey: true }), macApp)).toBe("close-tab");
		expect(shellShortcut(key("w", { ctrlKey: true }), macApp)).toBeNull();
		expect(shellShortcut(key("w", { ctrlKey: true }), winApp)).toBeNull();
	});

	test("a plain key, or one with another modifier, is nobody's", () => {
		expect(shellShortcut(key("t"), macApp)).toBeNull();
		expect(shellShortcut(key("t", { metaKey: true, shiftKey: true }), macApp)).toBeNull();
		expect(shellShortcut(key("t", { ctrlKey: true, altKey: true }), winApp)).toBeNull();
	});

	test("the next and the previous tab go round", () => {
		expect(steppedTab(["a", "b", "c"], "c", 1)).toBe("a");
		expect(steppedTab(["a", "b", "c"], "a", -1)).toBe("c");
		expect(steppedTab(["a", "b", "c"], "a", 1)).toBe("b");
		expect(steppedTab(["a", "b"], null, 1)).toBe("a");
		expect(steppedTab(["a", "b"], null, -1)).toBe("b");
		expect(steppedTab([], "a", 1)).toBeNull();
	});

	test("are written the app's way for each system", () => {
		expect(keysFor(true, SHELL_KEYS.sidebar)).toBe("⌃⌘S");
		expect(keysFor(false, SHELL_KEYS.sidebar)).toBe("Ctrl Shift S");
		expect(keysFor(false, SHELL_KEYS.switcher)).toBe("Ctrl K");
	});
});
