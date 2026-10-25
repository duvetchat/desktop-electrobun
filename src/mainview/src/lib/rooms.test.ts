import { describe, expect, test } from "bun:test";
import { topLevelEnd, withoutRoom, type Channel, type GatewayRoom, type RoomType } from "$lib/types";

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

describe("topLevelEnd", () => {
	const channel = (id: string, position: number, type: Channel["type"] = "text", categoryId?: string): Channel => ({
		id,
		name: id,
		type,
		position,
		categoryId,
	});

	test("after the highest place at the top level, whose categories share the numbering with its rooms", () => {
		// A category between the loose rooms: their count (3) would land text above "later".
		const channels = [
			channel("text", 0),
			channel("voice", 1, "voice"),
			channel("cat", 2, "category"),
			channel("later", 3),
		];
		expect(topLevelEnd(channels, "text")).toBe(4);
	});

	test("after the gaps deleted rooms leave, not at the count of what's left", () => {
		// The top level after a category's deletion moved z, x and y after everything (api#60).
		const channels = [
			channel("general", 0),
			channel("voice", 1, "voice"),
			channel("kept", 3, "category"),
			channel("z", 5),
			channel("x", 6),
			channel("y", 7),
		];
		expect(topLevelEnd(channels, "general")).toBe(8);
		expect(topLevelEnd(channels, "kept")).toBe(8);
	});

	test("rooms inside categories don't count", () => {
		const channels = [channel("loose", 0), channel("cat", 1, "category"), channel("inside", 9, "text", "cat")];
		expect(topLevelEnd(channels, "inside")).toBe(2);
	});

	test("the moving room doesn't count, so the last one keeps its place and the sidebar sends nothing", () => {
		const channels = [channel("a", 0), channel("b", 1)];
		expect(topLevelEnd(channels, "b")).toBe(1);
	});

	test("an empty top level starts at 0", () => {
		expect(topLevelEnd([], "a")).toBe(0);
		expect(topLevelEnd([channel("a", 4)], "a")).toBe(0);
	});
});
