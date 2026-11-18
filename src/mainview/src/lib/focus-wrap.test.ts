import { describe, expect, test } from "bun:test";
import { listStep, wrapTab } from "./focus-wrap";

describe("Tab in an overlay that keeps the keyboard", () => {
	test("goes on to the next control by itself", () => {
		expect(wrapTab(5, 0, false)).toBeNull();
		expect(wrapTab(5, 3, false)).toBeNull();
		expect(wrapTab(5, 3, true)).toBeNull();
	});

	test("from the last control goes to the first, and back from the first to the last", () => {
		expect(wrapTab(5, 4, false)).toBe(0);
		expect(wrapTab(5, 0, true)).toBe(4);
	});

	test("from the overlay itself enters at the first control, or backwards at the last", () => {
		expect(wrapTab(5, -1, false)).toBe(0);
		expect(wrapTab(5, -1, true)).toBe(4);
	});

	test("with nothing to reach, stays on the overlay", () => {
		expect(wrapTab(0, -1, false)).toBe(-1);
		expect(wrapTab(0, -1, true)).toBe(-1);
	});
});

describe("the arrows in a list of options", () => {
	test("move by one, and stop at both ends", () => {
		expect(listStep(3, 0, "ArrowDown")).toBe(1);
		expect(listStep(3, 2, "ArrowDown")).toBe(2);
		expect(listStep(3, 1, "ArrowUp")).toBe(0);
		expect(listStep(3, 0, "ArrowUp")).toBe(0);
	});

	test("enter at the first option when none has the focus", () => {
		expect(listStep(3, -1, "ArrowDown")).toBe(0);
	});

	test("Home and End go to the ends", () => {
		expect(listStep(3, 1, "Home")).toBe(0);
		expect(listStep(3, 1, "End")).toBe(2);
	});

	test("other keys, and an empty list, are left alone", () => {
		expect(listStep(3, 1, "Enter")).toBeNull();
		expect(listStep(3, 1, "a")).toBeNull();
		expect(listStep(0, -1, "ArrowDown")).toBeNull();
	});
});
