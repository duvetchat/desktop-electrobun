import { afterAll, describe, expect, test } from "bun:test";
import { setLocalePref } from "$lib/i18n";
import { formatDate, formatFileSize, formatList, formatNumber, formatRelativeTime } from "./format";

// The app's dates, numbers, lists and sizes (#464), in English as before and in the language picked.
const NOV_24 = Date.UTC(2026, 10, 24, 14, 5);

afterAll(() => setLocalePref("system"));

describe("in English", () => {
	test("a size is written as it always was", () => {
		expect(formatFileSize(512)).toBe("512 B");
		expect(formatFileSize(1536)).toBe("1.5 KB");
		expect(formatFileSize(1024 * 1024 - 1)).toBe("1024.0 KB");
		expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.50 MB");
		expect(formatFileSize(12_345 * 1024 * 1024)).toBe("12345.00 MB");
	});

	test("dates, numbers, lists and relative times are English", () => {
		expect(formatDate(NOV_24, { dateStyle: "medium", timeZone: "UTC" })).toBe("Nov 24, 2026");
		expect(formatNumber(1234.5)).toBe("1,234.5");
		expect(formatList(["Ana", "Ben", "Cy"])).toBe("Ana, Ben, and Cy");
		expect(formatRelativeTime(-5, "minute")).toBe("5 minutes ago");
	});
});

describe("in the language picked", () => {
	test("a size takes the language's digits and unit", async () => {
		await setLocalePref("fr");
		expect(formatFileSize(1536)).toBe("1,5 Ko");
		expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2,50 Mo");
	});

	test("dates, numbers, lists and relative times follow it", async () => {
		await setLocalePref("es");
		expect(formatDate(NOV_24, { dateStyle: "medium", timeZone: "UTC" })).toBe("24 nov 2026");
		expect(formatList(["Ana", "Ben", "Cy"])).toBe("Ana, Ben y Cy");
		expect(formatRelativeTime(-5, "minute")).toBe("hace 5 minutos");
		await setLocalePref("de");
		expect(formatNumber(1234.5)).toBe("1.234,5");
	});
});
