import { describe, expect, test } from "bun:test";
import { withoutRoom, type GatewayRoom, type RoomType } from "$lib/types";

const SPACE = "01920000-0000-7000-8000-0000000005a0";
const room = (id: string, type: RoomType, parent_id: string | null = null): GatewayRoom => ({
	id,
	space_id: SPACE,
	parent_id,
	type,
	name: id,
	description: null,
	position: 0,
	nsfw: false,
	created_at: "",
	updated_at: "",
});

describe("withoutRoom", () => {
	test("a deleted category's rooms move to the top level, as the API moves them", () => {
		const rooms = [room("cat", 3), room("general", 1, "cat"), room("voice", 2, "cat"), room("loose", 1)];
		expect(withoutRoom(rooms, "cat")).toEqual([room("general", 1), room("voice", 2), room("loose", 1)]);
	});

	test("other categories keep their rooms", () => {
		const rooms = [room("cat", 3), room("other", 3), room("inside", 1, "other")];
		expect(withoutRoom(rooms, "cat")).toEqual([room("other", 3), room("inside", 1, "other")]);
	});

	test("a deleted room leaves the rest as they were", () => {
		const rooms = [room("cat", 3), room("general", 1, "cat"), room("random", 1, "cat")];
		const left = withoutRoom(rooms, "random");
		expect(left).toEqual([room("cat", 3), room("general", 1, "cat")]);
		expect(left[1]).toBe(rooms[1]);
	});
});
