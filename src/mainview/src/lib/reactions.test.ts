import { describe, expect, test } from "bun:test";
import { countRoll } from "$lib/reactions";

describe("countRoll", () => {
	test("a count going up rolls up: the new number enters from below while the old one leaves upward", () => {
		expect(countRoll(1, 2)).toEqual({ enter: 100, leave: -100 });
		expect(countRoll(9, 10)).toEqual({ enter: 100, leave: -100 });
	});

	test("a count going down rolls down: the new number enters from above while the old one leaves downward", () => {
		expect(countRoll(2, 1)).toEqual({ enter: -100, leave: 100 });
		expect(countRoll(10, 9)).toEqual({ enter: -100, leave: 100 });
	});

	test("a count that didn't change doesn't roll", () => {
		expect(countRoll(3, 3)).toEqual({ enter: 0, leave: 0 });
	});
});
