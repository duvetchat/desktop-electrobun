import { describe, expect, test } from "bun:test";
import {
	categoryDropPosition,
	spaceWithoutRoom,
	withRoomReadState,
	withRoomReadStates,
	topLevelEnd,
	withoutRoom,
	withoutRoomMessages,
	type Channel,
	type GatewayRoom,
	type GatewayRoomOverwrite,
	type GatewayVoiceState,
	type RoomType,
} from "$lib/types";

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

const channel = (id: string, position: number, type: Channel["type"] = "text", categoryId?: string): Channel => ({
	id,
	name: id,
	type,
	position,
	categoryId,
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

describe("spaceWithoutRoom", () => {
	const overwrite = (room_id: string, target_id: string): GatewayRoomOverwrite => ({
		id: `${room_id}:${target_id}`,
		room_id,
		target_id,
		target_type: 0,
		deny_flags: 0,
		allow_flags: 2,
		created_at: "",
		updated_at: "",
	});
	const voice = (room_id: string, user_id: string): GatewayVoiceState => ({
		room_id,
		user_id,
		muted: false,
		deafened: false,
		screen_sharing: false,
		camera: false,
		version: 1,
	});

	test("the room's overwrites and the voice states in it go with it, the rest of the space stays", () => {
		const space = {
			name: "space",
			rooms: [room("lounge", 2), room("general", 1)],
			room_overwrites: [overwrite("lounge", "everyone"), overwrite("general", "everyone")],
			voice_states: [voice("lounge", "ana"), voice("lounge", "bo"), voice("stage", "cy")],
		};
		expect(spaceWithoutRoom(space, "lounge")).toEqual({
			name: "space",
			rooms: [room("general", 1)],
			room_overwrites: [overwrite("general", "everyone")],
			voice_states: [voice("stage", "cy")],
		});
	});
});

describe("withRoomReadState", () => {
	const ready = () => ({
		unread: new Set(["general"]),
		lastRead: { general: "m1", secret: "m0" },
		lastMsg: { general: "m2", secret: "m0" },
	});

	test("a room viewable since READY with messages its user hasn't read is unread, at their read position", () => {
		const read = ready();
		expect(withRoomReadState(read, "secret", { unread: true, last_read: "m3", last_msg: "m5" })).toEqual({
			unread: new Set(["general", "secret"]),
			lastRead: { general: "m1", secret: "m3" },
			lastMsg: { general: "m2", secret: "m5" },
		});
		expect(read).toEqual(ready());
	});

	test("one read up to its newest message, never read, or without messages takes the room's place as it is", () => {
		expect(withRoomReadState(ready(), "general", { unread: false, last_read: "m2", last_msg: "m2" })).toEqual({
			unread: new Set(),
			lastRead: { general: "m2", secret: "m0" },
			lastMsg: { general: "m2", secret: "m0" },
		});
		expect(withRoomReadState(ready(), "secret", { unread: true, last_read: null, last_msg: "m5" })).toEqual({
			unread: new Set(["general", "secret"]),
			lastRead: { general: "m1" },
			lastMsg: { general: "m2", secret: "m5" },
		});
		expect(withRoomReadState(ready(), "secret", { unread: false, last_read: null, last_msg: null })).toEqual({
			unread: new Set(["general"]),
			lastRead: { general: "m1" },
			lastMsg: { general: "m2" },
		});
	});

	test("a message the client has that's newer than the read state keeps the room unread, as its newest", () => {
		// Its MESSAGE_CREATE came before the ROOM_CREATE, whose read state was read before the message.
		const read = { unread: false, last_read: "m3", last_msg: "m3" };
		expect(withRoomReadState(ready(), "secret", read, "m4")).toEqual({
			unread: new Set(["general", "secret"]),
			lastRead: { general: "m1", secret: "m3" },
			lastMsg: { general: "m2", secret: "m4" },
		});
		// One the read state already counts changes nothing.
		expect(withRoomReadState(ready(), "secret", read, "m3")).toEqual({
			unread: new Set(["general"]),
			lastRead: { general: "m1", secret: "m3" },
			lastMsg: { general: "m2", secret: "m3" },
		});
	});
});

// A SPACE_CREATE sent after READY (a space the user joined or made) has their read state in each of its rooms they can
// view (read_states), as a ROOM_CREATE has its room's: the joined space shows its unread marks (#126).
describe("withRoomReadStates", () => {
	const ready = () => ({
		unread: new Set(["general"]),
		lastRead: { general: "m1" },
		lastMsg: { general: "m2" },
	});

	test("a joined space's rooms take their read states, each as a ROOM_CREATE's", () => {
		const read = ready();
		const joined = {
			news: { unread: true, last_read: null, last_msg: "m7" },
			quiet: { unread: false, last_read: "m6", last_msg: "m6" },
			empty: { unread: false, last_read: null, last_msg: null },
		};
		expect(withRoomReadStates(read, joined, () => undefined)).toEqual({
			unread: new Set(["general", "news"]),
			lastRead: { general: "m1", quiet: "m6" },
			lastMsg: { general: "m2", news: "m7", quiet: "m6" },
		});
		expect(read).toEqual(ready());
	});

	test("a newer message the client already has of a room keeps it unread", () => {
		// Its MESSAGE_CREATE came before the SPACE_CREATE, whose read states were read before the message.
		const newest: Record<string, string> = { quiet: "m8" };
		const joined = { quiet: { unread: false, last_read: "m6", last_msg: "m6" } };
		expect(withRoomReadStates(ready(), joined, (roomId) => newest[roomId])).toEqual({
			unread: new Set(["general", "quiet"]),
			lastRead: { general: "m1", quiet: "m6" },
			lastMsg: { general: "m2", quiet: "m8" },
		});
	});

	test("none to take leaves the rooms as they are", () => {
		expect(withRoomReadStates(ready(), {}, () => undefined)).toEqual(ready());
	});
});

describe("topLevelEnd", () => {
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

describe("categoryDropPosition", () => {
	const get = (channels: Channel[], id: string): Channel => {
		const found = channels.find((c) => c.id === id);
		if (!found) throw new Error(`no channel ${id}`);
		return found;
	};

	/** The top level's ids in order once the API moves one of them to `position` (UpdateRoom in the API's
	 * services/rooms.go). The place is counted with the room still where it is: the gap it leaves closes, a move down
	 * counts one less, a gap opens at the place and the room takes it. (The API then numbers the level 0, 1, 2… again,
	 * which keeps that order.) */
	function topLevelAfterMove(channels: Channel[], movingId: string, position: number): string[] {
		const level = channels.filter((c) => !c.categoryId).map((c) => ({ id: c.id, position: c.position }));
		const moving = level.find((c) => c.id === movingId);
		if (!moving) throw new Error(`${movingId} isn't at the top level`);
		const from = moving.position;
		for (const c of level) if (c.position > from) c.position--;
		const place = position > from ? position - 1 : position;
		for (const c of level) if (c.position >= place) c.position++;
		moving.position = place;
		return level.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map((c) => c.id);
	}

	// The top level's rooms and categories share one numbering; a category's rooms are numbered within it.
	const channels = [
		channel("a", 0),
		channel("B", 1, "category"),
		channel("C", 2, "category"),
		channel("D", 3, "category"),
		channel("e", 4),
		channel("F", 5, "category"),
		channel("p", 0, "text", "B"),
		channel("x", 0, "text", "C"),
		channel("y", 1, "voice", "C"),
	];

	test("the case reported: D dropped below y, a room of C, stays after C instead of landing before it", () => {
		// a:0 b:1 C:2 D:3 e:4, with x:0 and y:1 in C.
		const reported = [
			channel("a", 0),
			channel("b", 1),
			channel("C", 2, "category"),
			channel("D", 3, "category"),
			channel("e", 4),
			channel("x", 0, "text", "C"),
			channel("y", 1, "text", "C"),
		];
		const y = get(reported, "y");
		// y's place in C plus one (2) is what the sidebar sent as D's place at the top level: D went before C.
		expect(topLevelAfterMove(reported, "D", y.position + 1)).toEqual(["a", "b", "D", "C", "e"]);
		expect(categoryDropPosition(reported, y, "below")).toBe(3);
		expect(topLevelAfterMove(reported, "D", 3)).toEqual(["a", "b", "C", "D", "e"]);
	});

	const starts: [string, string, string[]][] = [
		["B", "before C", ["a", "C", "B", "D", "e", "F"]],
		["D", "right after C", ["a", "B", "C", "D", "e", "F"]],
		["F", "after C, with D and e between", ["a", "B", "C", "F", "D", "e"]],
	];
	for (const [category, start, order] of starts) {
		for (const roomId of ["x", "y"]) {
			for (const side of ["above", "below"] as const) {
				test(`${category}, from ${start}, dropped ${side} ${roomId}, a room of C, goes right after C`, () => {
					const position = categoryDropPosition(channels, get(channels, roomId), side);
					expect(position).toBe(3);
					expect(topLevelAfterMove(channels, category, position)).toEqual(order);
				});
			}
		}
	}

	test("it goes after the room's own category", () => {
		const position = categoryDropPosition(channels, get(channels, "p"), "above");
		expect(position).toBe(2);
		expect(topLevelAfterMove(channels, "F", position)).toEqual(["a", "B", "F", "C", "D", "e"]);
	});

	test("it counts from the category's own place, so the gaps deleted rooms leave don't matter", () => {
		const gaps = [
			channel("B", 1, "category"),
			channel("C", 4, "category"),
			channel("D", 6, "category"),
			channel("F", 7, "category"),
			channel("x", 0, "text", "C"),
		];
		const position = categoryDropPosition(gaps, get(gaps, "x"), "above");
		expect(position).toBe(5);
		expect(topLevelAfterMove(gaps, "B", position)).toEqual(["C", "B", "D", "F"]);
		expect(topLevelAfterMove(gaps, "F", position)).toEqual(["B", "C", "F", "D"]);
	});

	test("a loose room is a place of the top level itself: the category goes above it or below it", () => {
		const e = get(channels, "e");
		expect(categoryDropPosition(channels, e, "above")).toBe(4);
		expect(topLevelAfterMove(channels, "B", 4)).toEqual(["a", "C", "D", "B", "e", "F"]);
		expect(categoryDropPosition(channels, e, "below")).toBe(5);
		expect(topLevelAfterMove(channels, "B", 5)).toEqual(["a", "C", "D", "e", "B", "F"]);
	});
});

describe("withoutRoomMessages", () => {
	test("a room taken away loses its loaded messages, so that given back it loads what it missed; the others keep theirs", () => {
		const all = { a: [{ id: "1" }, { id: "2" }], b: [{ id: "3" }] };
		expect(withoutRoomMessages(all, "a")).toEqual({ b: [{ id: "3" }] });
		expect(all.a).toHaveLength(2);
	});

	test("a room with nothing loaded leaves the messages as they are", () => {
		const all = { b: [{ id: "3" }] };
		expect(withoutRoomMessages(all, "a")).toBe(all);
	});
});
