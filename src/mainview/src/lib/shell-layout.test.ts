import { describe, expect, test } from "bun:test";
import { makeLeaf, makeSplit } from "$lib/pane";
import {
	afterLeavingVoice,
	chatsUnderAll,
	chipCount,
	clampSidebarWidth,
	conversationTarget,
	defaultSidebarPrefs,
	friendRequestsLabel,
	isSettingsShortcut,
	keysFor,
	leafWithTab,
	leavesOf,
	mentionsLabel,
	movedTabs,
	mergedLeaf,
	moreChatsLabel,
	openBeside,
	openHow,
	openInLeaf,
	openTabIn,
	parseSidebarPrefs,
	quietSpacesLabel,
	shellShortcut,
	SHELL_KEYS,
	SIDEBAR_DEFAULT,
	SIDEBAR_MAX,
	SIDEBAR_MIN,
	spaceUnfolded,
	steppedTab,
	stripDrop,
	stripHalves,
	tabDropSide,
	tabDropTarget,
	tabKind,
} from "$lib/shell-layout";
import type { PaneLeaf, PaneNode, Tab } from "$lib/types";
import { MEMBERS_COLUMN_MIN_PANE } from "$lib/members";
import { MIN_SIZE } from "../../../bun/main-window";

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

	// #419: the desktop app's window can't be made narrower than the layout needs (src/bun/main-window.ts).
	test("at its narrowest leaves the smallest window a pane wide enough for the members column", () => {
		expect(MIN_SIZE.width - SIDEBAR_MIN).toBeGreaterThanOrEqual(MEMBERS_COLUMN_MIN_PANE);
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
	// The quiet Spaces' row reads the same folded and unfolded (#382).
	expect(quietSpacesLabel(1)).toBe("Quiet · 1");
	expect(quietSpacesLabel(5)).toBe("Quiet · 5");
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

// #367: leaving a voice room took the pane that showed it to its last other tab by position, often another Space's
// room. A click on a voice room takes the current tab's place, so the room the user came from wasn't a tab any more.
describe("a pane that shows a voice room, once the user leaves the room", () => {
	const voice: Tab = { channelId: "v", channelName: "Lounge", channelType: "voice", spaceId: "s1" };

	test("goes back to the chat it showed before, which the voice room took the place of", () => {
		const pane = makeLeaf([room("elsewhere", "s2"), voice], "v");
		const next = afterLeavingVoice(pane, "v", [room("general"), room("first")]);
		// Not the other Space's room the old pick took, the last tab by position.
		expect(next.activeChannelId).toBe("general");
		// The voice room's tab stays, for joining again.
		expect(ids(next)).toEqual(["elsewhere", "v", "general"]);
	});

	test("shows that chat's tab when the pane still has it", () => {
		const pane = makeLeaf([room("general"), voice, room("elsewhere", "s2")], "v");
		const next = afterLeavingVoice(pane, "v", [room("general")]);
		expect(ids(next)).toEqual(["general", "v", "elsewhere"]);
		expect(next.activeChannelId).toBe("general");
	});

	test("goes back to a conversation as well", () => {
		const pane = makeLeaf([voice], "v");
		expect(afterLeavingVoice(pane, "v", [chat("dm"), room("first")]).activeChannelId).toBe("dm");
	});

	test("takes the next choice when there's no chat before it, and never the voice room itself", () => {
		const pane = makeLeaf([room("elsewhere", "s2"), voice], "v");
		expect(afterLeavingVoice(pane, "v", [null, voice, undefined, room("first")]).activeChannelId).toBe("first");
	});

	test("stays where it is with nowhere to go", () => {
		const pane = makeLeaf([room("elsewhere", "s2"), voice], "v");
		expect(afterLeavingVoice(pane, "v", [null, null])).toBe(pane);
	});

	test("is left alone when it shows another chat", () => {
		const pane = makeLeaf([room("general"), voice], "general");
		expect(afterLeavingVoice(pane, "v", [room("first")])).toBe(pane);
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

	test("⌘, on macOS and Ctrl , elsewhere open Settings", () => {
		expect(isSettingsShortcut(key(",", { metaKey: true }), true)).toBe(true);
		expect(isSettingsShortcut(key(",", { ctrlKey: true }), false)).toBe(true);
		expect(isSettingsShortcut(key(",", { ctrlKey: true }), true)).toBe(false);
		expect(isSettingsShortcut(key(",", { metaKey: true }), false)).toBe(false);
		expect(isSettingsShortcut(key(",", { metaKey: true, shiftKey: true }), true)).toBe(false);
		expect(isSettingsShortcut(key(","), true)).toBe(false);
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

// What the app page does with a press on a room or a chat (routes/app/+page.svelte: openTab, openConversationTab).
describe("a chat opened from the sidebar", () => {
	const lone = makeLeaf([room("a"), room("b")], "a");
	const left = makeLeaf([room("a"), room("b")], "a");
	const right = makeLeaf([room("c")], "c");
	const pair = makeSplit(left, right, "h");
	const shown = (root: PaneNode) => leavesOf(root).map((pane) => `${ids(pane).join(",")}@${pane.activeChannelId}`);

	test("a click puts it in the focused pane's current tab, and the focus stays", () => {
		const next = openTabIn(lone, lone.id, room("x"));
		expect(shown(next.root)).toEqual(["x,b@x"]);
		expect(next.focusedId).toBe(lone.id);
		const inPair = openTabIn(pair, right.id, room("x"), "here");
		expect(shown(inPair.root)).toEqual(["a,b@a", "x@x"]);
		expect(inPair.focusedId).toBe(right.id);
	});

	test("a ⌘-click opens a new tab after the current one", () => {
		const next = openTabIn(lone, lone.id, room("x"), "tab");
		expect(shown(next.root)).toEqual(["a,x,b@x"]);
		expect(next.focusedId).toBe(lone.id);
	});

	test("one that is open in the pane already is shown, never opened twice", () => {
		for (const how of ["here", "tab"] as const) {
			const next = openTabIn(lone, lone.id, room("b"), how);
			expect(shown(next.root)).toEqual(["a,b@b"]);
		}
	});

	test("an ⌥-click opens it beside: a lone pane gets a pane for it, a pair's other pane takes it", () => {
		const split = openTabIn(lone, lone.id, room("x"), "beside");
		expect(shown(split.root)).toEqual(["a,b@a", "x@x"]);
		expect(split.focusedId).not.toBe(lone.id);
		const other = openTabIn(pair, left.id, room("x"), "beside");
		expect(shown(other.root)).toEqual(["a,b@a", "x@x"]);
		expect(other.focusedId).toBe(right.id);
	});

	test("from the Friends page a click opens a tab, rather than take over the one the page was hiding", () => {
		const next = openTabIn(lone, lone.id, room("x"), "here", true);
		expect(shown(next.root)).toEqual(["a,x,b@x"]);
		// Beside is beside, from there too.
		const beside = openTabIn(lone, lone.id, room("x"), "beside", true);
		expect(shown(beside.root)).toEqual(["a,b@a", "x@x"]);
	});

	test("a pane is found by a tab it holds, shown or not", () => {
		expect(leafWithTab(pair, "b")?.id).toBe(left.id);
		expect(leafWithTab(pair, "c")?.id).toBe(right.id);
		expect(leafWithTab(pair, "nowhere")).toBeNull();
	});

	test("a conversation open in another pane is shown there, whatever the press was", () => {
		expect(conversationTarget(pair, left.id, "c", "tab")).toEqual({ focusedId: right.id, how: "here" });
		expect(conversationTarget(pair, left.id, "c", "beside")).toEqual({ focusedId: right.id, how: "here" });
		// Open in the focused pane behind another tab: shown there.
		expect(conversationTarget(pair, left.id, "b", "tab")).toEqual({ focusedId: left.id, how: "here" });
		const target = conversationTarget(pair, left.id, "c", "beside");
		expect(shown(openTabIn(pair, target.focusedId, room("c"), target.how).root)).toEqual(["a,b@a", "c@c"]);
	});

	test("one that is open nowhere opens in the focused pane, as the press asks", () => {
		expect(conversationTarget(pair, left.id, "dm", "tab")).toEqual({ focusedId: left.id, how: "tab" });
		expect(conversationTarget(lone, lone.id, "dm")).toEqual({ focusedId: lone.id, how: "here" });
	});
});

// What TabBar does with a drag over its strip and a drop on it.
describe("a drop on the tab strip", () => {
	// Three tabs, each 100 wide, with a gap of 4 between them: a at 0–100, b at 104–204, c at 208–308.
	const rects = ["a", "b", "c"].map((id, i) => ({ id, left: i * 104, right: i * 104 + 100, width: 100 }));
	const tabs = [room("a"), room("b"), room("c"), room("d")];
	const order = (drop: ReturnType<typeof stripDrop>) =>
		drop?.kind === "reorder" ? drop.tabs.map((t) => t.channelId).join("") : drop;

	test("lands before a tab on its left quarter, after it on its right quarter, and joins it on its middle", () => {
		expect(tabDropTarget(rects, 10)).toEqual({ index: 0, joinId: null });
		expect(tabDropTarget(rects, 50)).toEqual({ index: 0, joinId: "a" });
		expect(tabDropTarget(rects, 90)).toEqual({ index: 1, joinId: null });
		expect(tabDropTarget(rects, 104 + 50)).toEqual({ index: 1, joinId: "b" });
		expect(tabDropTarget(rects, 208 + 90)).toEqual({ index: 3, joinId: null });
	});

	test("lands before the next tab from the gap between two, and at the end past the last", () => {
		expect(tabDropTarget(rects, 102)).toEqual({ index: 1, joinId: null });
		expect(tabDropTarget(rects, -20)).toEqual({ index: 0, joinId: null });
		expect(tabDropTarget(rects, 900)).toEqual({ index: 3, joinId: null });
		expect(tabDropTarget([], 50)).toEqual({ index: 0, joinId: null });
	});

	test("passes over a tab that isn't drawn", () => {
		expect(tabDropTarget([null, rects[1]!, rects[2]!], 104 + 10)).toEqual({ index: 1, joinId: null });
		expect(tabDropTarget([rects[0]!, null], 900)).toEqual({ index: 2, joinId: null });
	});

	test("a tab moved to the right lands one place nearer: the gap was counted with it still there", () => {
		const moved = (from: number, at: number) =>
			movedTabs(tabs, from, at)
				?.map((t) => t.channelId)
				.join("");
		expect(moved(0, 2)).toBe("bacd");
		expect(moved(0, 4)).toBe("bcda");
		expect(moved(1, 3)).toBe("acbd");
		// To the left the gap is where it lands.
		expect(moved(3, 0)).toBe("dabc");
		expect(moved(2, 1)).toBe("acbd");
		// Onto either gap beside itself: where it was.
		expect(moved(1, 1)).toBe("abcd");
		expect(moved(1, 2)).toBe("abcd");
		expect(movedTabs(tabs, 9, 0)).toBeNull();
		expect(tabs.map((t) => t.channelId).join("")).toBe("abcd");
	});

	test("a tab of the strip moves between two tabs, or joins the tab it is dropped on the middle of", () => {
		expect(order(stripDrop(tabs, room("a"), true, 0, 3, null))).toBe("bcad");
		expect(stripDrop(tabs, room("a"), true, 0, null, "c")).toEqual({ kind: "split", keepId: "c", moveId: "a" });
		// No gap was shown (the drag left the strip): nothing.
		expect(stripDrop(tabs, room("a"), true, 0, null, null)).toBeNull();
	});

	test("a room or a chat from the sidebar opens as a tab in the gap, or beside the tab it is dropped on", () => {
		const x = room("x");
		expect(stripDrop(tabs, x, false, null, 2, null)).toEqual({ kind: "open", tab: x, at: 2 });
		expect(stripDrop(tabs, x, false, null, null, null)).toEqual({ kind: "open", tab: x, at: null });
		expect(stripDrop(tabs, x, false, null, null, "b")).toEqual({ kind: "join", tab: x });
		// A tab dragged in from another pane's strip is no tab of this one: it opens here.
		expect(stripDrop(tabs, x, true, null, 1, null)).toEqual({ kind: "open", tab: x, at: 1 });
	});
});
