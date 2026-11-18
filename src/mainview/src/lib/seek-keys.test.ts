import { describe, expect, test } from "bun:test";
import { seekTo } from "./seek-keys";

describe("a seek bar's keys", () => {
	test("the arrows move five seconds", () => {
		expect(seekTo("ArrowRight", 10, 60)).toBe(15);
		expect(seekTo("ArrowLeft", 10, 60)).toBe(5);
		expect(seekTo("ArrowUp", 10, 60)).toBe(15);
		expect(seekTo("ArrowDown", 10, 60)).toBe(5);
	});

	test("never past either end", () => {
		expect(seekTo("ArrowRight", 58, 60)).toBe(60);
		expect(seekTo("ArrowLeft", 2, 60)).toBe(0);
	});

	test("Home and End go to the ends", () => {
		expect(seekTo("Home", 30, 60)).toBe(0);
		expect(seekTo("End", 30, 60)).toBe(60);
	});

	test("other keys are left alone, and a recording of unknown length isn't sought", () => {
		expect(seekTo("Enter", 30, 60)).toBeNull();
		expect(seekTo(" ", 30, 60)).toBeNull();
		expect(seekTo("ArrowRight", 0, 0)).toBeNull();
		expect(seekTo("ArrowRight", 0, Number.NaN)).toBeNull();
	});
});
