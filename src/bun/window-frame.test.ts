import { describe, expect, test } from "bun:test";
import {
	displayAt,
	displayOf,
	fitted,
	Maximizer,
	nearestDisplay,
	rectOf,
	wholeOn,
	type DisplayArea,
} from "./window-frame";

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

describe("nearestDisplay", () => {
	test("is the display the frame overlaps most, as displayOf", () => {
		expect(nearestDisplay(displays, { x: 1000, y: 100, width: 1400, height: 900 })).toBe(left);
		expect(nearestDisplay(displays, { x: 2100, y: 100, width: 1400, height: 900 })).toBe(right);
	});

	test("is the display nearest to a frame on none of them, primary or not", () => {
		// Where a third monitor was, right of the right one.
		expect(nearestDisplay(displays, { x: 4000, y: 100, width: 1400, height: 900 })).toBe(right);
		expect(nearestDisplay(displays, { x: -3000, y: 100, width: 1400, height: 900 })).toBe(left);
		// Above the right one.
		expect(nearestDisplay(displays, { x: 2500, y: -2000, width: 800, height: 600 })).toBe(right);
		expect(nearestDisplay([], { x: 0, y: 0, width: 100, height: 100 })).toBeUndefined();
	});
});

describe("displayAt", () => {
	test("is the display a point is on", () => {
		expect(displayAt(displays, { x: 10, y: 10 })).toBe(left);
		expect(displayAt(displays, { x: 1920, y: 1079 })).toBe(right);
	});

	test("is the primary for a point on no display, and none without displays", () => {
		expect(displayAt([right, left], { x: -50, y: 4000 })).toBe(left);
		expect(displayAt([], { x: 0, y: 0 })).toBeUndefined();
	});
});

describe("wholeOn", () => {
	test("a frame inside a work area, or across two, is whole on the displays", () => {
		expect(wholeOn(displays, { x: 100, y: 100, width: 1400, height: 900 })).toBe(true);
		expect(wholeOn(displays, { x: 1500, y: 100, width: 1400, height: 900 })).toBe(true);
		expect(wholeOn(displays, left.workArea)).toBe(true);
	});

	test("one past a display's edge, under its taskbar or on no display isn't", () => {
		expect(wholeOn(displays, { x: 3000, y: 100, width: 1400, height: 900 })).toBe(false);
		expect(wholeOn(displays, { x: 100, y: 200, width: 1400, height: 900 })).toBe(false);
		expect(wholeOn(displays, { x: 9000, y: 9000, width: 100, height: 100 })).toBe(false);
		expect(wholeOn([], { x: 0, y: 0, width: 100, height: 100 })).toBe(false);
	});

	test("mirrored displays are one: half a frame on each isn't a whole one", () => {
		const mirrored = [left, { ...left, isPrimary: false }];
		expect(wholeOn(mirrored, { x: 1220, y: 100, width: 1400, height: 900 })).toBe(false);
	});
});

describe("fitted", () => {
	test("moves a frame into an area, and makes one too large fit it", () => {
		expect(fitted({ x: 1500, y: -40, width: 1400, height: 900 }, left.workArea)).toEqual({
			x: 520,
			y: 0,
			width: 1400,
			height: 900,
		});
		expect(fitted({ x: 300, y: 300, width: 4000, height: 3000 }, right.workArea)).toEqual(right.workArea);
		const inside = { x: 2000, y: 50, width: 800, height: 600 };
		expect(fitted(inside, right.workArea)).toEqual(inside);
	});
});

describe("rectOf", () => {
	test("is a frame with a size, out of anything", () => {
		expect(rectOf({ x: 1, y: 2, width: 3, height: 4, more: true })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
		// A closed window's frame, as Electrobun gives it on Windows.
		expect(rectOf({ x: 0, y: 0, width: 0, height: 0 })).toBeNull();
		expect(rectOf({ x: 1, y: 2, width: Infinity, height: 4 })).toBeNull();
		expect(rectOf({ x: 1, y: 2, width: 3 })).toBeNull();
		expect(rectOf(null)).toBeNull();
		expect(rectOf("1,2,3,4")).toBeNull();
	});
});

describe("Maximizer", () => {
	test("for a window opened filling a display, puts back the frame it is told it had", () => {
		const maximizer = new Maximizer();
		const frame = { x: 2100, y: 100, width: 1400, height: 900 };
		maximizer.resume(frame, right.workArea);
		expect(maximizer.press(right.workArea, displays)).toEqual(frame);
		// And from there a press fills again.
		expect(maximizer.press(frame, displays)).toEqual(right.workArea);
	});

	// On a Mac with a full Dock, the Dock is a pixel taller or shorter once an app's icon joins or leaves it.
	test("puts back the frame of a window that still fills what it was given, though the work area changed", () => {
		const maximizer = new Maximizer();
		const frame = { x: 100, y: 100, width: 1400, height: 900 };
		expect(maximizer.press(frame, displays)).toEqual(left.workArea);
		const grown = { ...left, workArea: { ...left.workArea, height: 1031 } };
		expect(maximizer.fills(left.workArea)).toBe(true);
		expect(maximizer.press(left.workArea, [grown, right])).toEqual(frame);
		// Restored, it fills nothing.
		expect(maximizer.fills(left.workArea)).toBe(false);
		expect(maximizer.fills(frame)).toBe(false);
	});

	test("a window opened filling a work area that has changed since is still put back at the first press", () => {
		const maximizer = new Maximizer();
		const frame = { x: 2100, y: 100, width: 1400, height: 900 };
		const opened = { ...right.workArea, height: 1030 };
		maximizer.resume(frame, opened);
		expect(maximizer.press(opened, displays)).toEqual(frame);
	});

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
