import { describe, expect, test } from "bun:test";
import { displayOf, Maximizer, type DisplayArea } from "./window-frame";

// Two 1920×1080 monitors side by side, each with a 48 px taskbar: the layout #187 was reproduced on.
const left: DisplayArea = {
	bounds: { x: 0, y: 0, width: 1920, height: 1080 },
	workArea: { x: 0, y: 0, width: 1920, height: 1032 },
	isPrimary: true,
};
const right: DisplayArea = {
	bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
	workArea: { x: 1920, y: 0, width: 1920, height: 1032 },
	isPrimary: false,
};
const displays = [left, right];

describe("displayOf", () => {
	test("is the display the frame overlaps most", () => {
		expect(displayOf(displays, { x: 2100, y: 100, width: 1400, height: 900 })).toBe(right);
		// 920 px on the left one, 480 on the right one.
		expect(displayOf(displays, { x: 1000, y: 100, width: 1400, height: 900 })).toBe(left);
	});

	test("is the primary for a frame on no display, and none without displays", () => {
		expect(displayOf([right, left], { x: 9000, y: 9000, width: 100, height: 100 })).toBe(left);
		expect(displayOf([], { x: 0, y: 0, width: 100, height: 100 })).toBeUndefined();
	});
});

describe("Maximizer", () => {
	test("fills the display the window is on, and puts its frame back", () => {
		const maximizer = new Maximizer();
		const frame = { x: 2100, y: 100, width: 1400, height: 900 };
		expect(maximizer.press(frame, displays)).toEqual(right.workArea);
		expect(maximizer.press(right.workArea, displays)).toEqual(frame);
		// And again, from scratch: the second press was a restore.
		expect(maximizer.press(frame, displays)).toEqual(right.workArea);
	});

	test("fills the display a filled window was moved to, and puts its frame back there", () => {
		const maximizer = new Maximizer();
		expect(maximizer.press({ x: 100, y: 100, width: 1400, height: 900 }, displays)).toEqual(left.workArea);
		// Dragged to the right monitor as it was, filling: a press fills that one, not back to the left one.
		expect(maximizer.press({ x: 2000, y: 0, width: 1920, height: 1032 }, displays)).toEqual(right.workArea);
		expect(maximizer.press(right.workArea, displays)).toEqual({ x: 2020, y: 100, width: 1400, height: 900 });
	});

	test("takes a filled window's new size as its frame", () => {
		const maximizer = new Maximizer();
		maximizer.press({ x: 100, y: 100, width: 1400, height: 900 }, displays);
		const resized = { x: 300, y: 200, width: 800, height: 600 };
		expect(maximizer.press(resized, displays)).toEqual(left.workArea);
		expect(maximizer.press(left.workArea, displays)).toEqual(resized);
	});

	test("fits a frame put back on a smaller display", () => {
		const small: DisplayArea = {
			bounds: { x: 1920, y: 0, width: 1280, height: 720 },
			workArea: { x: 1920, y: 0, width: 1280, height: 680 },
			isPrimary: false,
		};
		const maximizer = new Maximizer();
		maximizer.press({ x: 100, y: 100, width: 1400, height: 900 }, [left, small]);
		expect(maximizer.press({ x: 2000, y: 0, width: 1920, height: 1032 }, [left, small])).toEqual(small.workArea);
		expect(maximizer.press(small.workArea, [left, small])).toEqual(small.workArea);
	});

	test("puts a frame whose display is gone back on the one there is", () => {
		const maximizer = new Maximizer();
		maximizer.press({ x: 2100, y: 100, width: 1400, height: 900 }, displays);
		// The right monitor unplugged: Windows moved the filled window onto the left one.
		expect(maximizer.press(left.workArea, [left])).toEqual({ x: 520, y: 100, width: 1400, height: 900 });
	});

	test("does nothing without displays", () => {
		expect(new Maximizer().press({ x: 0, y: 0, width: 800, height: 600 }, [])).toBeNull();
	});
});
