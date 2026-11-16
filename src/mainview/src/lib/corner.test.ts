import { describe, expect, test } from "bun:test";
import { callCardBottom, toastsBottom } from "$lib/corner";

// The stream window where it starts: 16 px from the app's bottom right corner (StreamWindow.svelte).
const STREAM_AT_CORNER = { right: 16, bottom: 16, width: 320, height: 180 };

describe("the call card's place in the corner", () => {
	test("in the corner when no stream window shows", () => expect(callCardBottom(null, 800)).toBe(16));

	test("right above the stream window in the corner", () => expect(callCardBottom(STREAM_AT_CORNER, 800)).toBe(204));

	test("in the corner when the stream window was dragged out of its place", () => {
		expect(callCardBottom({ ...STREAM_AT_CORNER, right: 400 }, 800)).toBe(16);
		expect(callCardBottom({ ...STREAM_AT_CORNER, bottom: 120 }, 800)).toBe(16);
		// Edge to edge with the card's place is not over it.
		expect(callCardBottom({ ...STREAM_AT_CORNER, right: 336 }, 800)).toBe(16);
	});

	test("above a stream window that covers part of its place", () =>
		expect(callCardBottom({ ...STREAM_AT_CORNER, right: 200, bottom: 40 }, 800)).toBe(228));

	test("in a window too short for both, inside the window", () =>
		expect(callCardBottom(STREAM_AT_CORNER, 260)).toBe(172));
});

test("toasts sit in the corner without a call card, and right above it with one", () => {
	expect(toastsBottom(null)).toBe(16);
	expect(toastsBottom({ right: 16, bottom: 16, width: 320, height: 72 })).toBe(96);
	expect(toastsBottom({ right: 16, bottom: 204, width: 320, height: 72 })).toBe(284);
});
