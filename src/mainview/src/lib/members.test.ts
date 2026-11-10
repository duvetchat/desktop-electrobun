import { describe, expect, test } from "bun:test";
import {
	BUSY_ROOM_ONLINE,
	memberFaces,
	memberGroups,
	membersColumnOpen,
	membersLabel,
	onlineCount,
} from "$lib/members";
import type { MemberOnSidebar, Role } from "$lib/types";

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

describe("membersColumnOpen", () => {
	test("auto opens the column only once more than the busy room's count are online", () => {
		expect(membersColumnOpen("auto", 0)).toBe(false);
		expect(membersColumnOpen("auto", 1)).toBe(false);
		expect(membersColumnOpen("auto", BUSY_ROOM_ONLINE)).toBe(false);
		expect(membersColumnOpen("auto", BUSY_ROOM_ONLINE + 1)).toBe(true);
	});

	test("the user's choice wins over the room's size", () => {
		expect(membersColumnOpen("shown", 0)).toBe(true);
		expect(membersColumnOpen("hidden", BUSY_ROOM_ONLINE + 50)).toBe(false);
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
