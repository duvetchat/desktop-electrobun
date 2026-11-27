import { describe, expect, spyOn, test } from "bun:test";
import {
	findMembers,
	GROUP_HEADING,
	joinedOn,
	managedMembers,
	MEMBER_ROW,
	MEMBERS_COLUMN_MIN_PANE,
	memberFaces,
	memberGroups,
	membersColumnOf,
	membersLabel,
	NO_ROLE,
	onlineCount,
	shownRows,
	type ManagedMember,
} from "$lib/members";
import type { GatewayMember, GatewayRole, GatewaySpace, GatewayUser, MemberOnSidebar, Role } from "$lib/types";

const member = (id: string, status: MemberOnSidebar["status"]) => ({ id, status });

// #57: the members list groups as the mobile app's members sheet does.
describe("memberGroups", () => {
	const role = (id: string, position: number, hoisted = true): Role => ({
		id,
		name: id,
		position,
		hoisted,
		color_from: null,
		color_via: null,
		color_to: null,
		permissions: 0,
	});
	const someone = (username: string, status: MemberOnSidebar["status"], roles: Role[] = []) => ({
		username,
		status,
		roles,
	});
	const shape = (groups: ReturnType<typeof memberGroups<ReturnType<typeof someone>>>) =>
		groups.map((g) => `${g.title}: ${g.members.map((m) => m.username).join(", ")}`);
	const admins = role("Admins", 3);
	const mods = role("Mods", 2);
	const helpers = role("Helpers", 1);
	const painters = role("Painters", 5, false);

	test("in a space: those online under their highest hoisted role by rank, the rest online, then offline", () => {
		const groups = memberGroups(
			[
				someone("zoe", "online"),
				someone("bob", "offline", [helpers]),
				someone("ana", "online", [mods, helpers]),
				someone("Carl", "dnd"),
				someone("eve", "dnd", [admins]),
				someone("dan", "online", [admins]),
				someone("Olivia", "offline"),
				someone("pat", "online", [painters]),
				someone("al", "online", [mods]),
			],
			true,
		);
		expect(shape(groups)).toEqual([
			"Admins: dan, eve",
			"Mods: al, ana",
			"Online: Carl, pat, zoe",
			"Offline: bob, Olivia",
		]);
	});

	test("in a conversation, with no roles: online, do not disturb, then offline", () => {
		const groups = memberGroups(
			[someone("ana", "online"), someone("bob", "offline"), someone("Carol", "dnd"), someone("tester", "online")],
			false,
		);
		expect(shape(groups)).toEqual(["Online: ana, tester", "Do not disturb: Carol", "Offline: bob"]);
	});

	test("a group nobody is in isn't there", () => {
		expect(shape(memberGroups([someone("bob", "offline", [helpers])], true))).toEqual(["Offline: bob"]);
		expect(shape(memberGroups([someone("ana", "online")], false))).toEqual(["Online: ana"]);
		expect(memberGroups([], true)).toEqual([]);
	});
});

describe("memberFaces", () => {
	test("online members come first, in the list's order, and the rest are counted", () => {
		const members = [
			member("a", "offline"),
			member("b", "online"),
			member("c", "offline"),
			member("d", "dnd"),
			member("e", "idle"),
			member("f", "online"),
		];
		const { faces, more } = memberFaces(members);
		expect(faces.map((m) => m.id)).toEqual(["b", "d", "e", "f"]);
		expect(more).toBe(2);
	});

	test("offline members fill the faces when few are online, and a short list has no more", () => {
		const { faces, more } = memberFaces([member("a", "offline"), member("b", "online")]);
		expect(faces.map((m) => m.id)).toEqual(["b", "a"]);
		expect(more).toBe(0);
		expect(memberFaces([])).toEqual({ faces: [], more: 0 });
	});
});

test("idle and do not disturb count as online, and the label says how many", () => {
	const online = onlineCount([member("a", "online"), member("b", "idle"), member("c", "dnd"), member("d", "offline")]);
	expect(online).toBe(3);
	expect(membersLabel(online)).toBe("Members, 3 online");
});

// #327: the members list mounted every row it had loaded, a whole Space's once scrolled through. It mounts the rows in
// view now, with some more on each side: rows are MEMBER_ROW px, each group under a GROUP_HEADING px heading.
describe("shownRows", () => {
	test("the rows in view and the overscan on each side, for one group", () => {
		expect(shownRows([1000], 0, 600, 10)).toEqual([[0, Math.ceil((600 - GROUP_HEADING) / MEMBER_ROW) + 10]]);
		const top = GROUP_HEADING + 500 * MEMBER_ROW;
		expect(shownRows([1000], top, top + 400, 10)).toEqual([[490, 500 + Math.ceil(400 / MEMBER_ROW) + 10]]);
		// The end of the list.
		expect(shownRows([1000], GROUP_HEADING + 995 * MEMBER_ROW, GROUP_HEADING + 1000 * MEMBER_ROW, 10)).toEqual([
			[985, 1000],
		]);
	});

	test("each group by its own place, a group out of view showing none", () => {
		const second = GROUP_HEADING + 100 * MEMBER_ROW;
		const [first, rest] = shownRows(
			[100, 100],
			second + GROUP_HEADING + 50 * MEMBER_ROW,
			second + GROUP_HEADING + 60 * MEMBER_ROW,
			5,
		);
		expect(first).toEqual([100, 100]);
		expect(rest).toEqual([45, 65]);
		// A view above the second group shows none of it.
		expect(shownRows([100, 100], 0, 400, 5)[1]).toEqual([0, 0]);
	});

	test("rows of another height, as the Members section of a Space's settings has", () => {
		expect(shownRows([1000], 0, 600, 10, 40)).toEqual([[0, Math.ceil((600 - GROUP_HEADING) / 40) + 10]]);
		const top = GROUP_HEADING + 500 * 40;
		expect(shownRows([1000], top, top + 400, 10, 40)).toEqual([[490, 500 + 400 / 40 + 10]]);
	});

	test("an empty group, and a view of nothing", () => {
		expect(shownRows([0, 3], 0, 1000)).toEqual([
			[0, 0],
			[0, 3],
		]);
		expect(shownRows([], 0, 1000)).toEqual([]);
	});
});

// #380: the Members section of a Space's settings was a plain list of the members loaded, with their roles. It lists
// them all now, found by name, by role, sorted, with the date each joined.
describe("the Members section's members", () => {
	const SPACE = "harbour";
	const role = (id: string, position: number): GatewayRole => ({
		id,
		space_id: SPACE,
		name: id === SPACE ? "@everyone" : id,
		color_from: null,
		color_via: null,
		color_to: null,
		flags: 0,
		permissions: 0,
		created_at: "",
		updated_at: "",
		hoisted: false,
		position,
	});
	const user = (n: number, username: string, alias: string | null = null, is_bot = false): GatewayUser => ({
		id: `user-${n}`,
		username,
		email_verified: true,
		alias,
		avatar: null,
		banner: null,
		custom: "",
		flags: 0,
		badges: 0,
		is_bot,
		created_at: "",
		updated_at: "",
	});
	const membership = (n: number, joined: string): GatewayMember => ({
		id: `member-${n}`,
		space_id: SPACE,
		user_id: `user-${n}`,
		alias: null,
		created_at: joined,
		updated_at: joined,
	});
	const space: GatewaySpace = {
		id: SPACE,
		name: "Harbour",
		description: null,
		banner: null,
		owner_id: "user-1",
		locale: null,
		member_roles: {
			"user-1": [SPACE],
			"user-2": [SPACE, "Mods", "Admins"],
			"user-3": [SPACE, "Mods"],
			"user-4": [SPACE],
		},
		room_overwrites: [],
		rooms: [],
		roles: [role(SPACE, 0), role("Mods", 1), role("Admins", 2)],
		users: [user(1, "rowan"), user(2, "tamsin", "Tam"), user(3, "otterbot", null, true), user(4, "Bea")],
		members: [
			// The gateway's own row for the user, which their page of members replaces: its ID is the user's, its date the
			// Space's.
			{ ...membership(1, "2026-01-01T00:00:00Z"), id: "user-1" },
			membership(2, "2026-03-05T10:00:00Z"),
			membership(3, "2026-07-20T08:30:00Z"),
			membership(4, "2026-05-11T16:45:00Z"),
			// A member whose user isn't loaded.
			membership(5, "2026-09-01T00:00:00Z"),
		],
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "",
	};
	const members = managedMembers(space);
	const names = (list: ManagedMember[]) => list.map((m) => m.name);

	test("each with their user, their roles but @everyone, highest first, and when they joined", () => {
		expect(members.map((m) => [m.id, m.memberId, m.name, m.username, m.isOwner, m.isBot])).toEqual([
			["user-1", null, "rowan", "rowan", true, false],
			["user-2", "member-2", "Tam", "tamsin", false, false],
			["user-3", "member-3", "otterbot", "otterbot", false, true],
			["user-4", "member-4", "Bea", "Bea", false, false],
		]);
		expect(members.map((m) => m.roles.map((r) => r.id))).toEqual([[], ["Admins", "Mods"], ["Mods"], []]);
		// The gateway's own row says nothing of when the user joined, nor which member they are, until their page comes.
		expect(members.map((m) => m.joinedAt)).toEqual([
			null,
			"2026-03-05T10:00:00Z",
			"2026-07-20T08:30:00Z",
			"2026-05-11T16:45:00Z",
		]);
	});

	test("found by name, alias, username or ID, whatever the case, with or without the @", () => {
		expect(names(findMembers(members, { query: "tam" }))).toEqual(["Tam"]);
		expect(names(findMembers(members, { query: "TAMSIN" }))).toEqual(["Tam"]);
		expect(names(findMembers(members, { query: " @bea " }))).toEqual(["Bea"]);
		expect(names(findMembers(members, { query: "user-3" }))).toEqual(["otterbot"]);
		expect(names(findMembers(members, { query: "nobody" }))).toEqual([]);
		expect(findMembers(members, { query: "  " })).toHaveLength(4);
	});

	// A short word of hex letters ("bea", "de") is in a good share of any Space's UUIDs.
	test("by part of their ID only from 8 characters on, and by all of it", () => {
		const longIds = members.map((m, i) => ({ ...m, id: `0192${i}a3b-de00-7000-8000-00000000000${i}` }));
		expect(findMembers(longIds, { query: "de" }).map((m) => m.name)).toEqual([]);
		expect(names(findMembers(longIds, { query: "01921a3b-de" }))).toEqual(["Tam"]);
		expect(names(findMembers(longIds, { query: "0192" }))).toEqual([]);
		expect(names(findMembers(longIds, { query: longIds[3]!.id.toUpperCase() }))).toEqual(["Bea"]);
	});

	test("filtered by a role they hold, or by holding none", () => {
		expect(names(findMembers(members, { role: "Mods" }))).toEqual(["otterbot", "Tam"]);
		expect(names(findMembers(members, { role: "Admins" }))).toEqual(["Tam"]);
		expect(names(findMembers(members, { role: NO_ROLE }))).toEqual(["Bea", "rowan"]);
		expect(names(findMembers(members, { role: NO_ROLE, query: "row" }))).toEqual(["rowan"]);
	});

	test("by name, or by when they joined, newest or oldest first, those not known yet last", () => {
		expect(names(findMembers(members, {}))).toEqual(["Bea", "otterbot", "rowan", "Tam"]);
		expect(names(findMembers(members, { sort: "newest" }))).toEqual(["otterbot", "Bea", "Tam", "rowan"]);
		expect(names(findMembers(members, { sort: "oldest" }))).toEqual(["Tam", "Bea", "otterbot", "rowan"]);
	});

	// The section sorts again on every page that comes, every presence, role event and key. A localeCompare with options
	// makes a collator of its own each time: 5,000 members took 300 to 400 ms in Chromium (V8) for each sort. One
	// collator does it in about 5.
	test("compares names with one collator, not a localeCompare for each pair", () => {
		const compared = spyOn(String.prototype, "localeCompare");
		try {
			for (const sort of ["name", "newest", "oldest"] as const) findMembers(members, { sort });
			expect(compared).not.toHaveBeenCalled();
		} finally {
			compared.mockRestore();
		}
	});

	test("the date they joined, as the app's language writes it", () => {
		const at = "2026-03-05T10:00:00Z";
		expect(joinedOn(at)).toBe("Mar 5, 2026");
		expect(joinedOn(null)).toBeNull();
		expect(joinedOn("not a date")).toBeNull();
		// On a system in another language, in the app's too (#464's dates), not the system's 05.03.2026.
		Object.defineProperty(navigator, "languages", { value: ["de-DE"], configurable: true });
		try {
			expect(joinedOn(at)).toBe("Mar 5, 2026");
		} finally {
			Reflect.deleteProperty(navigator, "languages");
		}
	});
});

// #409: a Space's text room and a group have their members in a column beside the chat, in a pane with room for it.
describe("the members column", () => {
	test("a text room's and a group's, in a pane of 700 px or more", () => {
		expect(MEMBERS_COLUMN_MIN_PANE).toBe(700);
		for (const width of [700, 701, 976, 2560]) {
			expect(membersColumnOf("rooms", width), String(width)).toBe("rooms");
			expect(membersColumnOf("groups", width), String(width)).toBe("groups");
		}
	});

	test("a narrower pane has none: its chat's members open in the bar's popover", () => {
		for (const width of [699.5, 699, 488, 320]) {
			expect(membersColumnOf("rooms", width), String(width)).toBeUndefined();
			expect(membersColumnOf("groups", width), String(width)).toBeUndefined();
		}
		// A pane that isn't shown (the Friends view hides the panes) measures 0, as one not measured yet.
		expect(membersColumnOf("rooms", 0)).toBeUndefined();
	});

	test("any other chat has none, however wide its pane: a voice room, a DM", () => {
		for (const width of [0, 699, 700, 2560]) expect(membersColumnOf(undefined, width)).toBeUndefined();
	});
});
