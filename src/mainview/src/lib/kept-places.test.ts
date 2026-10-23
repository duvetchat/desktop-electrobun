import { describe, expect, test } from "bun:test";
import { KEEP_PLACE_MS, keepPlace, takePlace } from "$lib/kept-places";

describe("kept places", () => {
	const place = { messageId: "01a15f8c-0042-7000-8000-000000000000", offset: 236 };

	test("the list that shows a room next gets the place kept for it", () => {
		keepPlace("room-a", place, 1_000);
		expect(takePlace("room-a", 2_000)).toEqual(place);
	});

	test("only once: the list after it opens as any other", () => {
		keepPlace("room-b", place, 1_000);
		takePlace("room-b", 2_000);
		expect(takePlace("room-b", 3_000)).toBeNull();
	});

	test("not another room's", () => {
		keepPlace("room-c", place, 1_000);
		expect(takePlace("room-d", 2_000)).toBeNull();
		expect(takePlace("room-c", 2_000)).toEqual(place);
	});

	test("not once it's old", () => {
		keepPlace("room-e", place, 1_000);
		expect(takePlace("room-e", 1_000 + KEEP_PLACE_MS + 1)).toBeNull();
	});

	test("the latest place kept for a room", () => {
		keepPlace("room-f", place, 1_000);
		keepPlace("room-f", { ...place, offset: 12 }, 1_500);
		expect(takePlace("room-f", 2_000)).toEqual({ ...place, offset: 12 });
	});
});
