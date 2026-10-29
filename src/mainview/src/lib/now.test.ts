import { describe, expect, test } from "bun:test";
import type { ConversationMember } from "$lib/api/conversations";
import {
	busiestRooms,
	callName,
	capFaces,
	connectionNote,
	fitFaces,
	NOW_ROOMS,
	nowKind,
	peopleCount,
	voiceRoomLabel,
	withSelf,
} from "$lib/now";

describe("nowKind", () => {
	test("the user's own voice comes first, then the rooms with people, then the online friends", () => {
		expect(nowKind(true, 2, 5)).toBe("voice");
		expect(nowKind(true, 0, 0)).toBe("voice");
		expect(nowKind(false, 2, 5)).toBe("rooms");
		expect(nowKind(false, 0, 5)).toBe("friends");
	});

	test("nothing shows when nobody is in voice and no friend is online", () => {
		expect(nowKind(false, 0, 0)).toBeNull();
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

describe("connectionNote", () => {
	test("says nothing once the voice is up", () => {
		expect(connectionNote("connected")).toBeNull();
	});

	test("says how the connection is while it isn't", () => {
		expect(connectionNote("new")).toBe("Connecting…");
		expect(connectionNote("connecting")).toBe("Connecting…");
		expect(connectionNote("disconnected")).toBe("Reconnecting…");
		expect(connectionNote("failed")).toBe("Connection failed");
		expect(connectionNote("closed")).toBe("Disconnected");
	});
});

describe("withSelf", () => {
	const me = { id: "me" };

	test("adds the user when the gateway doesn't list them yet", () => {
		expect(withSelf([{ id: "a" }], me).map((p) => p.id)).toEqual(["a", "me"]);
	});

	test("keeps the list as it is when the user is in it, or unknown", () => {
		expect(withSelf([me, { id: "a" }], me).map((p) => p.id)).toEqual(["me", "a"]);
		expect(withSelf([{ id: "a" }], null).map((p) => p.id)).toEqual(["a"]);
	});
});

describe("labels", () => {
	test("count people in the singular and the plural", () => {
		expect(peopleCount(1)).toBe("1 person");
		expect(peopleCount(3)).toBe("3 people");
	});

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
