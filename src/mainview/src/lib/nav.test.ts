import { describe, expect, test } from "bun:test";
import { fuzzyScore, groupSpaces, parseFolders, parsePinned, rankByQuery, spaceNews, type SpaceFolder } from "$lib/nav";
import { parseLayoutPrefs } from "$lib/layout-prefs";
import { closeTabsIn, makeLeaf } from "$lib/pane";
import type { Tab } from "$lib/types";

describe("groupSpaces", () => {
	const folder = (id: string, guildIds: string[]): SpaceFolder => ({ id, name: id, guildIds, collapsed: false });

	test("pinned first, in pin order, then folders, then news and quiet", () => {
		const news = new Set(["b", "d"]);
		const groups = groupSpaces(["a", "b", "c", "d", "e"], ["e", "a"], [folder("f", ["c"])], (id) => news.has(id));
		expect(groups.pinned).toEqual(["e", "a"]);
		expect(groups.folders.map((g) => g.spaceIds)).toEqual([["c"]]);
		expect(groups.news).toEqual(["b", "d"]);
		expect(groups.quiet).toEqual([]);
	});

	test("a pinned space in a folder shows once, under Pinned", () => {
		const groups = groupSpaces(["a", "b"], ["a"], [folder("f", ["a", "b"])], () => false);
		expect(groups.pinned).toEqual(["a"]);
		expect(groups.folders.map((g) => g.spaceIds)).toEqual([["b"]]);
		expect(groups.quiet).toEqual([]);
	});

	test("spaces the user left are left out, and an empty folder doesn't show", () => {
		const groups = groupSpaces(["a"], ["gone"], [folder("f", ["gone"])], () => false);
		expect(groups.pinned).toEqual([]);
		expect(groups.folders).toEqual([]);
		expect(groups.quiet).toEqual(["a"]);
	});
});

describe("saved values", () => {
	test("pinned IDs drop duplicates and anything that isn't one", () => {
		expect(parsePinned('["a", 1, "b", "a"]')).toEqual(["a", "b"]);
		expect(parsePinned("{")).toEqual([]);
		expect(parsePinned(null)).toEqual([]);
	});

	test("folders keep what the server rail saved", () => {
		expect(parseFolders('[{"id":"f","name":"Work","guildIds":["a",2],"collapsed":true},{"name":"no id"}]')).toEqual([
			{ id: "f", name: "Work", guildIds: ["a"], collapsed: true },
		]);
		expect(parseFolders('"nope"')).toEqual([]);
	});

	test("layout prefs from before the modes keep their panels and get the default modes", () => {
		expect(parseLayoutPrefs('{"showMembersSidebar":false,"showChannelsSidebar":true}')).toEqual({
			membersColumn: "hidden",
			showChannelsSidebar: true,
			spacesColumn: "fixed",
			openChats: "tabs",
		});
		expect(parseLayoutPrefs('{"spacesColumn":"auto-hide","openChats":"vertical"}')).toMatchObject({
			spacesColumn: "auto-hide",
			openChats: "vertical",
		});
		expect(parseLayoutPrefs('{"spacesColumn":"sideways","openChats":3}')).toMatchObject({
			spacesColumn: "fixed",
			openChats: "tabs",
		});
		expect(parseLayoutPrefs("[]").membersColumn).toBe("auto");
	});

	test("the members column's old switch becomes its mode: shown, the old default, is auto", () => {
		expect(parseLayoutPrefs('{"showMembersSidebar":true}').membersColumn).toBe("auto");
		expect(parseLayoutPrefs('{"showMembersSidebar":false}').membersColumn).toBe("hidden");
		expect(parseLayoutPrefs("{}").membersColumn).toBe("auto");
		expect(parseLayoutPrefs(null).membersColumn).toBe("auto");
	});

	test("a saved members mode wins over the switch older builds read, and an unknown one is ignored", () => {
		expect(parseLayoutPrefs('{"membersColumn":"shown","showMembersSidebar":true}').membersColumn).toBe("shown");
		expect(parseLayoutPrefs('{"membersColumn":"hidden","showMembersSidebar":false}').membersColumn).toBe("hidden");
		expect(parseLayoutPrefs('{"membersColumn":"auto","showMembersSidebar":true}').membersColumn).toBe("auto");
		expect(parseLayoutPrefs('{"membersColumn":"sometimes","showMembersSidebar":false}').membersColumn).toBe("hidden");
		expect(parseLayoutPrefs('{"membersColumn":true}').membersColumn).toBe("auto");
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
