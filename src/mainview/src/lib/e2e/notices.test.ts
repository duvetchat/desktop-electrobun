import { describe, expect, test } from "bun:test";
import { notice, NOTICES, type NoticeKey } from "./notices";
import conventions from "./testing/e2e-conventions.json";

// The notices are the same in both apps: the table of PLAN-E2E-CLIENTES.md's notices, as the conventions' file has it
// for the mobile app's test too.
const isNotice = (key: string): key is NoticeKey => Object.hasOwn(NOTICES, key);

describe("the notices", () => {
	test("are the table's, every one and nothing else", () => {
		expect(conventions.notices).toEqual(NOTICES);
	});

	test("fill their names, and leave a value's own braces alone", () => {
		for (const { key, values, text } of conventions.filled_notices) {
			expect(isNotice(key) && notice(key, values)).toBe(text);
		}
	});
});
