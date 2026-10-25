import { describe, expect, test } from "bun:test";
import { sendAgain } from "$lib/resend";

describe("sendAgain", () => {
	test("a send still unanswered from an earlier connection goes again", () => {
		expect(sendAgain({ sentOn: 3, answered: false }, 4)).toBe(true);
	});

	test("so does one that found no socket open", () => {
		expect(sendAgain({ sentOn: null, answered: false }, 4)).toBe(true);
	});

	test("not one sent on this connection, after its identify, nor an answered one", () => {
		expect(sendAgain({ sentOn: 4, answered: false }, 4)).toBe(false);
		expect(sendAgain({ sentOn: 3, answered: true }, 4)).toBe(false);
		expect(sendAgain(null, 4)).toBe(false);
	});
});
