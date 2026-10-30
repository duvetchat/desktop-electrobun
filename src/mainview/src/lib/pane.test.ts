import { describe, expect, test } from "bun:test";
import {
	conversationTab,
	conversationTitle,
	filterPaneTree,
	isConversationTab,
	makeLeaf,
	makeSplit,
	tabDragData,
	tabFromDragData,
	tabNews,
	tabStaysOpen,
	tabTitle,
} from "$lib/pane";
import type { GatewayRoom, GatewaySpace, PaneNode, Tab } from "$lib/types";

const ME = "me";
const room = (id: string, spaceId = "s1"): Tab => ({ channelId: id, channelName: id, channelType: "text", spaceId });
const dm = {
	id: "c1",
	type: 1,
	name: null,
	members: [
		{ user_id: ME, user: { username: "me" } },
		{ user_id: "u2", user: { username: "maya", alias: "Maya" } },
	],
};
const group = { id: "g1", type: 2, name: "Night runners", members: [{ user_id: ME, user: { username: "me" } }] };

describe("conversation tabs", () => {
	test("a conversation's tab carries its ID, its name and its kind", () => {
		expect(conversationTab(dm, ME)).toEqual({
			channelId: "c1",
			channelName: "Maya",
			channelType: "conversation",
			spaceId: "",
			kind: "conversation",
		});
		expect(conversationTitle(group, ME)).toBe("Night runners");
		expect(isConversationTab(conversationTab(group, ME))).toBe(true);
	});

	test("a tab saved before conversations had tabs, without a kind, is a room's", () => {
		const saved: Tab = JSON.parse('{"channelId":"r1","channelName":"general","channelType":"text","spaceId":"s1"}');
		expect(isConversationTab(saved)).toBe(false);
	});

	test("a conversation's tab takes its name as it is now; a room's keeps the one it opened with", () => {
		const tab = conversationTab(dm, ME);
		const renamed = { ...dm, members: [dm.members[0], { user_id: "u2", user: { username: "maya", alias: "Maya R" } }] };
		expect(tabTitle(tab, [renamed], ME)).toBe("Maya R");
		expect(tabTitle(tab, [], ME)).toBe("Maya");
		expect(tabTitle(room("r1"), [renamed], ME)).toBe("r1");
	});

	test("a conversation's news is its unread state and its DM mentions; a room's, the room's", () => {
		const tab = conversationTab(dm, ME);
		expect(tabNews(tab, new Set(["c1"]), new Set(), {})).toEqual({ unread: false, mentions: 0 });
		expect(tabNews(tab, new Set(), new Set(["c1"]), {})).toEqual({ unread: true, mentions: 0 });
		expect(tabNews(tab, new Set(), new Set(), { c1: 2 })).toEqual({ unread: true, mentions: 2 });
		expect(tabNews(room("r1"), new Set(["r1"]), new Set(), {}).unread).toBe(true);
	});

	test("a dragged tab comes back as the same tab, conversation or room", () => {
		const conv = conversationTab(dm, ME);
		expect(tabFromDragData(JSON.parse(tabDragData(conv)))).toEqual(conv);
		expect(tabFromDragData(JSON.parse(tabDragData(room("r1"))))).toEqual(room("r1"));
		expect(JSON.parse(tabDragData(room("r1"), { type: "tab", sourceLeafId: "L" }))).toMatchObject({
			type: "tab",
			sourceLeafId: "L",
		});
		expect(tabFromDragData({})).toBeNull();
	});
});

describe("filterPaneTree", () => {
	const open = new Set(["r1", "c1"]);
	const keep = (tab: Tab) => open.has(tab.channelId);

	test("drops the tabs keep turns down, and a leaf's active tab falls to its first one", () => {
		const leaf = makeLeaf([room("r1"), room("gone"), conversationTab(dm, ME)], "gone");
		const filtered = filterPaneTree(leaf, keep);
		expect(filtered).toMatchObject({ kind: "leaf", activeChannelId: "r1" });
		expect(filtered?.kind === "leaf" && filtered.tabs.map((t) => t.channelId)).toEqual(["r1", "c1"]);
	});

	test("a split that loses one side becomes the other; with no tab left, nothing is", () => {
		const kept = makeLeaf([conversationTab(dm, ME)], "c1");
		const emptied = makeLeaf([room("gone")], "gone");
		const split: PaneNode = makeSplit(emptied, kept, "h");
		expect(filterPaneTree(split, keep)).toEqual(kept);
		expect(filterPaneTree(makeLeaf([room("gone")]), keep)).toBeNull();
	});

	test("a split that keeps both sides stays a split", () => {
		const split = makeSplit(makeLeaf([room("r1")], "r1"), makeLeaf([conversationTab(dm, ME)], "c1"), "v", 0.3);
		expect(filterPaneTree(split, keep)).toMatchObject({ kind: "split", direction: "v", ratio: 0.3 });
	});
});

describe("restoring saved panes", () => {
	const gatewayRoom = (id: string): GatewayRoom => ({
		id,
		space_id: "s1",
		parent_id: null,
		type: 1,
		name: id,
		description: null,
		position: 0,
		nsfw: false,
		created_at: "",
		updated_at: "",
	});
	// The user owns the space, so they view every room in it.
	const space: GatewaySpace = {
		id: "s1",
		name: "Design Guild",
		description: null,
		banner: null,
		owner_id: ME,
		locale: null,
		member: { id: "member", space_id: "s1", user_id: ME, alias: null, created_at: "", updated_at: "" },
		member_roles: {},
		room_overwrites: [],
		rooms: [gatewayRoom("r1")],
		members: [],
		roles: [],
		users: [],
		created_at: "",
		updated_at: "",
	};

	test("keeps the rooms still there and the conversations still in the list, from before kinds and after", () => {
		const saved: PaneNode = JSON.parse(
			JSON.stringify(
				makeSplit(
					makeLeaf([room("r1"), room("deleted"), room("r1", "left-space")], "deleted"),
					makeLeaf([conversationTab(dm, ME), conversationTab(group, ME)], "g1"),
					"h",
				),
			),
		);
		const restored = filterPaneTree(saved, tabStaysOpen([space], new Set(["c1"])));
		expect(restored).toMatchObject({
			kind: "split",
			a: { tabs: [room("r1")], activeChannelId: "r1" },
			b: { tabs: [conversationTab(dm, ME)], activeChannelId: "c1" },
		});
	});

	test("without the conversations loaded, conversation tabs go and rooms stay", () => {
		const saved = makeLeaf([conversationTab(dm, ME), room("r1")], "c1");
		expect(filterPaneTree(saved, tabStaysOpen([space], new Set()))).toMatchObject({
			tabs: [room("r1")],
			activeChannelId: "r1",
		});
	});
});
