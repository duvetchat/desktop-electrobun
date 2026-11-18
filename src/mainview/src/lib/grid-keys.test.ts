import { describe, expect, test } from "bun:test";
import { gridStep } from "./grid-keys";

// 11 cells, 4 to a row:  0 1 2 3 / 4 5 6 7 / 8 9 10
describe("the arrows in a grid", () => {
	test("left and right move by one, across rows", () => {
		expect(gridStep(11, 1, 4, "ArrowRight")).toBe(2);
		expect(gridStep(11, 3, 4, "ArrowRight")).toBe(4);
		expect(gridStep(11, 4, 4, "ArrowLeft")).toBe(3);
	});

	test("up and down move by a row", () => {
		expect(gridStep(11, 1, 4, "ArrowDown")).toBe(5);
		expect(gridStep(11, 5, 4, "ArrowUp")).toBe(1);
	});

	test("down onto a short last row goes to its last cell", () => {
		expect(gridStep(11, 7, 4, "ArrowDown")).toBe(10);
	});

	test("an arrow that would leave the grid is left alone", () => {
		expect(gridStep(11, 0, 4, "ArrowLeft")).toBeNull();
		expect(gridStep(11, 10, 4, "ArrowRight")).toBeNull();
		expect(gridStep(11, 2, 4, "ArrowUp")).toBeNull();
		expect(gridStep(11, 9, 4, "ArrowDown")).toBeNull();
	});

	test("Home and End go to the first and the last cell", () => {
		expect(gridStep(11, 5, 4, "Home")).toBe(0);
		expect(gridStep(11, 5, 4, "End")).toBe(10);
		expect(gridStep(11, 0, 4, "Home")).toBeNull();
	});

	test("other keys, and a focus that isn't on a cell, are left alone", () => {
		expect(gridStep(11, 5, 4, "Enter")).toBeNull();
		expect(gridStep(11, -1, 4, "ArrowRight")).toBeNull();
		expect(gridStep(0, -1, 4, "ArrowRight")).toBeNull();
	});
});
