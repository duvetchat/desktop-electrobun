import { describe, expect, test } from "bun:test";
import { BUSY_ROOM_ONLINE, memberFaces, membersColumnOpen, membersLabel, onlineCount } from "$lib/members";
import type { MemberOnSidebar } from "$lib/types";

const member = (id: string, status: MemberOnSidebar["status"]) => ({ id, status });

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
