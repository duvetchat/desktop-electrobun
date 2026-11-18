import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	clickFoldsSpace,
	defaultNowPrefs,
	firstTextRoom,
	fuzzyScore,
	groupSpaces,
	parseNowPrefs,
	parsePinned,
	rankByQuery,
	roomColumn,
	spaceNews,
	spaceReadAll,
} from "$lib/nav";
import { defaultLayoutPrefs, parseLayoutPrefs } from "$lib/layout-prefs";
import { closeTabsIn, makeLeaf } from "$lib/pane";
import type { Channel, Tab } from "$lib/types";

describe("groupSpaces", () => {
	test("pinned first, in pin order, then news and quiet", () => {
		const news = new Set(["b", "d"]);
		const groups = groupSpaces(["a", "b", "c", "d", "e"], ["e", "a"], (id) => news.has(id));
		expect(groups.pinned).toEqual(["e", "a"]);
		expect(groups.news).toEqual(["b", "d"]);
		expect(groups.quiet).toEqual(["c"]);
	});

	// #57: the column has no folders of its own; a space that isn't pinned shows where the gateway's order puts it.
	test("the spaces that aren't pinned keep the gateway's order", () => {
		const news = new Set(["z", "a"]);
		const groups = groupSpaces(["z", "m", "a", "q", "b"], ["q"], (id) => news.has(id));
		expect(groups.news).toEqual(["z", "a"]);
		expect(groups.quiet).toEqual(["m", "b"]);
		expect(Object.keys(groups).sort()).toEqual(["news", "pinned", "quiet"]);
	});

	test("spaces the user left are left out", () => {
		const groups = groupSpaces(["a"], ["gone"], () => false);
		expect(groups.pinned).toEqual([]);
		expect(groups.quiet).toEqual(["a"]);
	});

	// The folders the old server rail saved, under duvet.guildFolders.v1, are no longer read by the column.
	test("the saved folders aren't read", () => {
		const read = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");
		for (const file of ["nav.ts", "nav-prefs.svelte.ts", "components/SpaceNav.svelte", "components/SpaceEdge.svelte"]) {
			expect(read(file)).not.toContain("guildFolders");
			expect(read(file)).not.toMatch(/folders/i);
		}
	});
});

describe("saved values", () => {
	test("pinned IDs drop duplicates and anything that isn't one", () => {
		expect(parsePinned('["a", 1, "b", "a"]')).toEqual(["a", "b"]);
		expect(parsePinned("{")).toEqual([]);
		expect(parsePinned(null)).toEqual([]);
	});

	test("the Now section's prefs keep their booleans, and anything else is at its default", () => {
		expect(parseNowPrefs('{"roomsFolded":true,"allRooms":true}')).toEqual({
			roomsFolded: true,
			friendsFolded: false,
			allRooms: true,
		});
		expect(parseNowPrefs('{"friendsFolded":"yes","roomsFolded":1}')).toEqual(defaultNowPrefs);
		expect(parseNowPrefs("[true]")).toEqual(defaultNowPrefs);
		expect(parseNowPrefs("{")).toEqual(defaultNowPrefs);
		expect(parseNowPrefs(null)).toEqual(defaultNowPrefs);
	});

	test("layout prefs from before the modes keep their panels and get the default modes", () => {
		expect(parseLayoutPrefs('{"showMembersSidebar":false,"showChannelsSidebar":true}')).toEqual({
			showChannelsSidebar: true,
			spacesColumn: "fixed",
			openChats: "tabs",
			keyboardNavigation: false,
		});
		expect(parseLayoutPrefs('{"keyboardNavigation":true}').keyboardNavigation).toBe(true);
		expect(parseLayoutPrefs('{"keyboardNavigation":"yes"}').keyboardNavigation).toBe(false);
		expect(parseLayoutPrefs('{"spacesColumn":"auto-hide","openChats":"vertical"}')).toMatchObject({
			spacesColumn: "auto-hide",
			openChats: "vertical",
		});
		expect(parseLayoutPrefs('{"spacesColumn":"sideways","openChats":3}')).toMatchObject({
			spacesColumn: "fixed",
			openChats: "tabs",
		});
		expect(parseLayoutPrefs("[]")).toEqual(defaultLayoutPrefs);
	});

	// Nothing is docked beside a chat since the redesign (#357, DECISIONS.md): the members column's mode, and the
	// switch before it, are in values saved by earlier builds, and are read past.
	test("a saved members column, as a mode or as the old switch, is read without error and left out", () => {
		for (const saved of [
			'{"membersColumn":"shown","showMembersSidebar":true}',
			'{"membersColumn":"hidden","showMembersSidebar":false}',
			'{"membersColumn":"auto","showMembersSidebar":true}',
			'{"membersColumn":"sometimes"}',
			'{"membersColumn":true}',
			'{"showMembersSidebar":false}',
		]) {
			const prefs = parseLayoutPrefs(saved);
			expect(prefs, saved).toEqual(defaultLayoutPrefs);
			expect(Object.keys(prefs), saved).not.toContain("membersColumn");
		}
		// What was saved beside it keeps its value.
		expect(
			parseLayoutPrefs(
				'{"membersColumn":"shown","showMembersSidebar":true,"spacesColumn":"auto-hide","openChats":"vertical"}',
			),
		).toEqual({ ...defaultLayoutPrefs, spacesColumn: "auto-hide", openChats: "vertical" });
	});
});

describe("fuzzyScore", () => {
	test("a prefix beats a word start, which beats a substring, which beats scattered letters", () => {
		const prefix = fuzzyScore("gen", "general")!;
		const word = fuzzyScore("gen", "design-general")!;
		const inside = fuzzyScore("gen", "regency")!;
		const scattered = fuzzyScore("gnl", "general")!;
		expect(prefix).toBeGreaterThan(word);
		expect(word).toBeGreaterThan(inside);
		expect(inside).toBeGreaterThan(scattered);
	});

	test("case and accents don't count; letters out of order don't match", () => {
		expect(fuzzyScore("BOGOTA", "Bogotá Night Runners")).not.toBeNull();
		expect(fuzzyScore("lareneg", "general")).toBeNull();
	});

	test("ranking keeps the order of equal matches", () => {
		expect(rankByQuery(["b-general", "general", "a-general"], "general", (s) => s)).toEqual([
			"general",
			"b-general",
			"a-general",
		]);
	});
});

describe("spaceNews", () => {
	test("sums mentions, marks unread text rooms and counts people in voice", () => {
		const rooms = [
			{ id: "t1", type: "text" },
			{ id: "t2", type: "text" },
			{ id: "v1", type: "voice", voiceUsers: [{}, {}] },
			{ id: "c1", type: "category" },
		];
		expect(spaceNews(rooms, new Set(["t2"]), { t1: 2, c1: 9 })).toEqual({ mentions: 2, unread: true, inVoice: 2 });
		expect(spaceNews(rooms, new Set(), {})).toEqual({ mentions: 0, unread: false, inVoice: 2 });
	});
});

describe("spaceReadAll", () => {
	const rooms = [
		{ id: "t1", type: "text" },
		{ id: "t2", type: "text" },
		{ id: "t3", type: "text" },
		{ id: "v1", type: "voice", voiceUsers: [] },
		{ id: "c1", type: "category" },
	];
	const newest: Record<string, string> = { t1: "m19", t2: "m29", t3: "m39", v1: "m49" };

	test("each room the space's row counts as news is acked at its newest message, which becomes its read position", () => {
		const read = spaceReadAll(
			rooms,
			{ unread: new Set(["t1", "v1", "elsewhere"]), mentions: { t2: 3, dm: 1 }, lastRead: { t1: "m10", t3: "m30" } },
			(id) => newest[id] ?? "",
		);
		expect(read.acks).toEqual([
			{ roomId: "t1", messageId: "m19" },
			{ roomId: "t2", messageId: "m29" },
		]);
		// The space has no news left; another space's rooms and the conversations keep theirs, and a voice room is no news.
		expect(spaceNews(rooms, read.unread, read.mentions)).toEqual({ mentions: 0, unread: false, inVoice: 0 });
		expect(read.unread).toEqual(new Set(["v1", "elsewhere"]));
		expect(read.mentions).toEqual({ dm: 1 });
		// A room read already (t3) keeps its read position.
		expect(read.lastRead).toEqual({ t1: "m19", t2: "m29", t3: "m30" });
	});

	test("a room whose newest message isn't known only loses its marks, and what was there isn't changed in place", () => {
		const unread = new Set(["t1"]);
		const mentions = { t1: 2 };
		const lastRead = { t1: "m10" };
		const read = spaceReadAll(rooms, { unread, mentions, lastRead }, () => "");
		expect(read).toEqual({ acks: [], unread: new Set(), mentions: {}, lastRead: { t1: "m10" } });
		expect(unread).toEqual(new Set(["t1"]));
		expect(mentions).toEqual({ t1: 2 });
	});

	test("a space with no news is left as it is", () => {
		const read = spaceReadAll(
			rooms,
			{ unread: new Set(["elsewhere"]), mentions: {}, lastRead: {} },
			(id) => newest[id] ?? "",
		);
		expect(read.acks).toEqual([]);
		expect(read.unread).toEqual(new Set(["elsewhere"]));
	});
});

describe("closeTabsIn", () => {
	const tab = (id: string): Tab => ({ channelId: id, channelName: id, channelType: "text", spaceId: "s" });

	test("the tab after the closed active one takes its place, or else the one before", () => {
		const leaf = makeLeaf([tab("a"), tab("b"), tab("c")], "b");
		expect(closeTabsIn(leaf, ["b"]).activeChannelId).toBe("c");
		expect(closeTabsIn({ ...leaf, activeChannelId: "c" }, ["c"]).activeChannelId).toBe("b");
		expect(closeTabsIn(leaf, ["a"])).toEqual({ tabs: [tab("b"), tab("c")], activeChannelId: "b" });
		expect(closeTabsIn(leaf, ["a", "b", "c"])).toEqual({ tabs: [], activeChannelId: null });
	});
});

// A click on a Space opens its first text room in the column's order (DISENO-CLIC-EN-SPACE.md), which the column
// itself shows its rooms in.
const channel = (id: string, type: Channel["type"], position: number, categoryId?: string): Channel => ({
	id,
	name: id,
	type,
	position,
	categoryId,
});

describe("the rooms' column order", () => {
	test("rooms without a category first, then each category, each by position", () => {
		const column = roomColumn([
			channel("c2", "category", 1),
			channel("b", "text", 1, "c1"),
			channel("t2", "text", 2),
			channel("c1", "category", 0),
			channel("a", "voice", 0, "c1"),
			channel("t1", "text", 0),
			channel("d", "text", 0, "c2"),
		]);
		expect(column.topLevel.map((r) => r.id)).toEqual(["t1", "t2"]);
		expect(column.categories.map((c) => [c.category.id, c.rooms.map((r) => r.id)])).toEqual([
			["c1", ["a", "b"]],
			["c2", ["d"]],
		]);
	});

	test("a room whose category isn't listed is left out, as the column leaves it out", () => {
		const column = roomColumn([channel("x", "text", 0, "gone"), channel("t", "text", 1)]);
		expect(column.topLevel.map((r) => r.id)).toEqual(["t"]);
		expect(column.categories).toEqual([]);
	});
});

describe("firstTextRoom", () => {
	test("the first text room in the column's order, past voice rooms and categories", () => {
		const rooms = [
			channel("v", "voice", 0),
			channel("c1", "category", 0),
			channel("b", "text", 1, "c1"),
			channel("a", "voice", 0, "c1"),
		];
		expect(firstTextRoom(rooms)?.id).toBe("b");
	});

	test("a room without a category comes before a category's, whatever their positions", () => {
		const rooms = [channel("c1", "category", 0), channel("in", "text", 0, "c1"), channel("top", "text", 5)];
		expect(firstTextRoom(rooms)?.id).toBe("top");
	});

	test("none in a Space without text rooms, nor a room whose category isn't listed", () => {
		expect(firstTextRoom([channel("v", "voice", 0), channel("c1", "category", 0)])).toBeNull();
		expect(firstTextRoom([channel("x", "text", 0, "gone")])).toBeNull();
	});
});

describe("clickFoldsSpace", () => {
	const rooms = [channel("r1", "text", 0), channel("r2", "voice", 1)];

	test("a click on the open Space folds it while the focused pane shows one of its rooms", () => {
		expect(clickFoldsSpace(rooms, "r1")).toBe(true);
		expect(clickFoldsSpace(rooms, "r2")).toBe(true);
	});

	test("with a conversation, another Space's room or nothing there, it takes the user to the Space instead", () => {
		expect(clickFoldsSpace(rooms, "conversation-1")).toBe(false);
		expect(clickFoldsSpace(rooms, "other-space-room")).toBe(false);
		expect(clickFoldsSpace(rooms, null)).toBe(false);
	});
});
