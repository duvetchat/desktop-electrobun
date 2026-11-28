import { describe, expect, test } from "bun:test";
import type { ConversationMember } from "$lib/api/conversations";
import { busiestRooms, callName, capFaces, fitFaces, NOW_ROOMS, joinableCalls, liveIn, voiceRoomLabel } from "$lib/now";

describe("joinableCalls", () => {
	const calls = new Set(["a", "b", "c"]);

	test("every call going on is offered while this client shows none and no pane shows its conversation", () => {
		expect(joinableCalls(calls, null, null)).toEqual(["a", "b", "c"]);
	});

	test("the call this client shows, and the one whose conversation the pane shows, are left out", () => {
		expect(joinableCalls(calls, { conversationId: "a" }, "c")).toEqual(["b"]);
		expect(joinableCalls(new Set(), null, "a")).toEqual([]);
	});
});

describe("liveIn", () => {
	test("a shared screen wins over a camera", () => {
		expect(liveIn([{ camera: true }, { screen_sharing: true }])).toBe("screen");
		expect(liveIn([{ camera: true }, {}])).toBe("camera");
	});

	test("a room with neither shows nothing live", () => {
		expect(liveIn([{ screen_sharing: false, camera: false }])).toBeNull();
		expect(liveIn([])).toBeNull();
	});
});

describe("busiestRooms", () => {
	const room = (id: string, people: number) => ({ id, people });
	const people = (r: { people: number }) => r.people;

	test("the busiest rooms come first, and rooms as busy keep their order", () => {
		const rooms = [room("a", 1), room("b", 4), room("c", 2), room("d", 4)];
		expect(busiestRooms(rooms, people, 10).map((r) => r.id)).toEqual(["b", "d", "c", "a"]);
	});

	test("empty rooms are left out, and only the first few show", () => {
		const rooms = [room("a", 0), room("b", 1), room("c", 3), room("d", 2), room("e", 5)];
		expect(busiestRooms(rooms, people).map((r) => r.id)).toEqual(["e", "c", "d"]);
		expect(busiestRooms(rooms, people)).toHaveLength(NOW_ROOMS);
		expect(busiestRooms([room("a", 0)], people)).toEqual([]);
	});
});

describe("capFaces", () => {
	test("shows the first faces and counts the rest", () => {
		expect(capFaces(["a", "b", "c", "d", "e", "f"], 4)).toEqual({ faces: ["a", "b", "c", "d"], more: 2 });
	});

	test("a short list has no more, and an empty one no faces", () => {
		expect(capFaces(["a", "b"], 4)).toEqual({ faces: ["a", "b"], more: 0 });
		expect(capFaces([], 4)).toEqual({ faces: [], more: 0 });
	});
});

describe("fitFaces", () => {
	test("every face shows when they fit, without a +N", () => {
		expect(fitFaces(["a", "b", "c"], 3)).toEqual({ faces: ["a", "b", "c"], more: 0 });
	});

	test("one place fewer shows faces when they don't fit, and the last place counts the rest", () => {
		expect(fitFaces(["a", "b", "c", "d", "e"], 3)).toEqual({ faces: ["a", "b"], more: 3 });
	});
});

describe("labels", () => {
	test("a voice room's row says where it is and how many are in it", () => {
		expect(voiceRoomLabel("lounge", "Si", 3)).toBe("Open lounge in Si, 3 people");
	});
});

describe("callName", () => {
	const member = (user_id: string, username: string, alias: string | null = null): ConversationMember => ({
		id: `m-${user_id}`,
		conversation_id: "c",
		user_id,
		created_at: "",
		updated_at: "",
		user: { id: user_id, username, alias, avatar: null, banner: null },
	});

	test("a direct message's call goes by the other person's name", () => {
		const conv = { type: 1 as const, name: null, members: [member("me", "socram"), member("ana", "ana", "Ana")] };
		expect(callName(conv, "me")).toBe("Ana");
		expect(callName({ ...conv, members: [member("me", "socram"), member("bo", "bo")] }, "me")).toBe("bo");
	});

	test("a group's call goes by the group's name", () => {
		expect(callName({ type: 2, name: "Friday", members: [] }, "me")).toBe("Friday");
		expect(callName({ type: 2, name: null, members: [] }, "me")).toBe("Group call");
	});

	test("an unknown conversation's call is just a call", () => {
		expect(callName(undefined, "me")).toBe("Call");
	});
});
