import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	conversationTab,
	conversationTitle,
	filterPaneTree,
	isConversationTab,
	makeLeaf,
	makeSplit,
	spacesAndRooms,
	tabDescription,
	tabDragData,
	tabFromDragData,
	tabNews,
	tabStaysOpen,
	tabTitle,
	tabTooltip,
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
		const renamed = {
			...dm,
			members: [dm.members[0]!, { user_id: "u2", user: { username: "maya", alias: "Maya R" } }],
		};
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

describe("tabDescription", () => {
	const described = (description: string | null): GatewaySpace[] => [
		{
			id: "s1",
			name: "Design Guild",
			description: null,
			banner: null,
			owner_id: ME,
			locale: null,
			member_roles: {},
			room_overwrites: [],
			rooms: [
				{
					id: "r1",
					space_id: "s1",
					parent_id: null,
					type: 1,
					name: "r1",
					description,
					position: 0,
					nsfw: false,
					created_at: "",
					updated_at: "",
				},
			],
			members: [],
			roles: [],
			users: [],
			created_at: "",
			updated_at: "",
		},
	];

	test("is what the tab's room is for, as its space has it now, trimmed", () => {
		expect(tabDescription(room("r1"), described("  What it's for "))).toBe("What it's for");
		expect(tabDescription(room("r1"), described("Changed since"))).toBe("Changed since");
	});

	test("none when blank, as the mobile app has it", () => {
		expect(tabDescription(room("r1"), described(null))).toBeNull();
		expect(tabDescription(room("r1"), described(""))).toBeNull();
		expect(tabDescription(room("r1"), described("   "))).toBeNull();
	});

	test("none for a conversation, no tab, or a room its space no longer has", () => {
		expect(tabDescription(conversationTab(dm, ME), described("Not this"))).toBeNull();
		expect(tabDescription(null, described("Not this"))).toBeNull();
		expect(tabDescription(room("gone"), described("Not this"))).toBeNull();
		expect(tabDescription(room("r1", "another-space"), described("Not this"))).toBeNull();
	});
});

// #214: the bar shows the active room's description only in what the tabs leave of it, nothing once they fill it, and
// no tooltip had it.
describe("tabTooltip", () => {
	const spaces = (description: string | null): GatewaySpace[] => [
		{
			id: "s1",
			name: "Design Guild",
			description: null,
			banner: null,
			owner_id: ME,
			locale: null,
			member_roles: {},
			room_overwrites: [],
			rooms: [
				{
					id: "r1",
					space_id: "s1",
					parent_id: null,
					type: 1,
					name: "r1",
					description,
					position: 0,
					nsfw: false,
					created_at: "",
					updated_at: "",
				},
			],
			members: [],
			roles: [],
			users: [],
			created_at: "",
			updated_at: "",
		},
	];

	test("a room's has its name, its space and what it's for, as its space has it now, then who's typing", () => {
		expect(tabTooltip(room("r1"), "general", spaces("  What it's for "), null)).toBe(
			"general · Design Guild · What it's for",
		);
		expect(tabTooltip(room("r1"), "general", spaces("Changed since"), "ana is typing…")).toBe(
			"general · Design Guild · Changed since · ana is typing…",
		);
	});

	test("a room without a description has its name and its space", () => {
		expect(tabTooltip(room("r1"), "general", spaces(null), null)).toBe("general · Design Guild");
		expect(tabTooltip(room("r1"), "general", spaces("   "), null)).toBe("general · Design Guild");
	});

	test("a conversation's has its name and who's typing", () => {
		const tab = conversationTab(dm, ME);
		expect(tabTooltip(tab, "Maya", spaces("Not this"), null)).toBe("Maya");
		expect(tabTooltip(tab, "Maya", spaces("Not this"), "Maya is typing…")).toBe("Maya · Maya is typing…");
	});

	test("the pane's tabs take it", () => {
		const bar = readFileSync(join(import.meta.dir, "components", "TabBar.svelte"), "utf8");
		expect(bar).toContain("title={tabTooltip(tab, title, $gatewaySpaces, typing)}");
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

	test("a room that goes (deleted, or taken from the user) closes its tabs in every pane, as a space that goes does", () => {
		const before = [{ ...space, rooms: [gatewayRoom("r1"), gatewayRoom("r2")] }];
		const after = [{ ...space, rooms: [gatewayRoom("r1")] }];
		const known = spacesAndRooms(new Set(), before).ids;
		expect(spacesAndRooms(known, before).gone).toBe(false);
		expect(spacesAndRooms(known, after).gone).toBe(true);
		const open = makeSplit(makeLeaf([room("r1"), room("r2")], "r2"), makeLeaf([room("r2")], "r2"), "h");
		expect(filterPaneTree(open, tabStaysOpen(after, new Set()))).toMatchObject({
			kind: "leaf",
			tabs: [room("r1")],
			activeChannelId: "r1",
		});
	});
});
