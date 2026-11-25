import { describe, expect, test } from "bun:test";
import { uuidv7 } from "./uuid";

describe("uuidv7", () => {
	test("is a version 7 UUID whose first 48 bits are the time it was made", () => {
		const at = Date.UTC(2026, 10, 24, 21, 30, 5, 123);
		const id = uuidv7(at);
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16)).toBe(at);
	});

	test("sorts by the time it was made, and two are never the same", () => {
		const ids = [uuidv7(1), uuidv7(2), uuidv7(256), uuidv7(2 ** 40), uuidv7(Date.now())];
		expect([...ids].sort()).toEqual(ids);
		expect(new Set(Array.from({ length: 1000 }, () => uuidv7(5))).size).toBe(1000);
	});
});
