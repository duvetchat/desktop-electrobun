import { describe, expect, test } from "bun:test";
import { uploadNote, uploadPercent } from "$lib/uploads";

// What an image's Save or Upload says while it goes up (#78), as the mobile app says it.
describe("an upload's percent", () => {
	test("is rounded down, so it says 100 only once every byte is up", () => {
		expect(uploadPercent(0, 1000)).toBe(0);
		expect(uploadPercent(420, 1000)).toBe(42);
		expect(uploadPercent(999, 1000)).toBe(99);
		expect(uploadPercent(99_999, 100_000)).toBe(99);
		expect(uploadPercent(1000, 1000)).toBe(100);
	});

	test("is 0 while the total isn't known, and never past 100", () => {
		expect(uploadPercent(10, 0)).toBe(0);
		expect(uploadPercent(1200, 1000)).toBe(100);
	});

	test("reads as the mobile app's: Uploading · 42%", () => {
		expect(uploadNote(42)).toBe("Uploading · 42%");
		expect(uploadNote(uploadPercent(1000, 1000))).toBe("Uploading · 100%");
	});
});
