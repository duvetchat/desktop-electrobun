import { describe, expect, test } from "bun:test";
import { NAME_BYTES, slotName } from "./pool";

// A slot of the core's OPFS pool says what it holds in its header's first NAME_BYTES: the name SQLite gave the file,
// NUL-padded UTF-8. destroy frees the slots whose names are the user's database's, so it reads them as SQLite wrote them.

/** A slot's header holding `name`, as the pool writes one: the name, then NULs. */
function header(name: Uint8Array | string) {
	const bytes = new Uint8Array(NAME_BYTES);
	bytes.set(typeof name === "string" ? new TextEncoder().encode(name) : name);
	return bytes;
}

describe("a slot's name", () => {
	test("is what its header holds before the first NUL", () => {
		const user = "0193a4b2-0000-7000-8000-000000000001";
		expect(slotName(header(`${user}.db`))).toBe(`${user}.db`);
		expect(slotName(header(`${user}.db-journal`))).toBe(`${user}.db-journal`);
	});

	test("is none for a free slot, one cut to nothing, or a name that isn't UTF-8 or never ends", () => {
		expect(slotName(new Uint8Array(NAME_BYTES))).toBeNull();
		expect(slotName(new Uint8Array(0))).toBeNull();
		expect(slotName(header(new Uint8Array([0x61, 0xff, 0x62])))).toBeNull();
		expect(slotName(new Uint8Array(NAME_BYTES).fill(0x61))).toBeNull();
	});
});
