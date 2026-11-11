import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { forgetStaleSignature } from "./sign-app";

const dir = mkdtempSync(join(tmpdir(), "sign-app-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Where a PE32+ header at 0x80 keeps its security directory: past "PE\0\0" and the COFF header (24 bytes), 144 bytes
// into the optional header.
const securityEntry = 0x80 + 24 + 144;

function executable(name: string, offset: number, size: number): string {
	const bytes = Buffer.alloc(8192);
	bytes.write("MZ", 0, "latin1");
	bytes.writeUInt32LE(0x80, 0x3c);
	bytes.write("PE\0\0", 0x80, "latin1");
	bytes.writeUInt16LE(0x20b, 0x80 + 24);
	bytes.writeUInt32LE(offset, securityEntry);
	bytes.writeUInt32LE(size, securityEntry + 4);
	const path = join(dir, name);
	writeFileSync(path, bytes);
	return path;
}

function entryOf(path: string): number[] {
	const bytes = readFileSync(path);
	return [bytes.readUInt32LE(securityEntry), bytes.readUInt32LE(securityEntry + 4)];
}

test("forgets a signature entry that points inside the file, as Hutch leaves bun.exe's", () => {
	const path = executable("stale.exe", 6000, 1000);
	forgetStaleSignature(path);
	expect(entryOf(path)).toEqual([0, 0]);
});

test("keeps a signature that ends the file, and a file without one", () => {
	const signed = executable("signed.exe", 8000, 192);
	forgetStaleSignature(signed);
	expect(entryOf(signed)).toEqual([8000, 192]);
	const unsigned = executable("unsigned.exe", 0, 0);
	forgetStaleSignature(unsigned);
	expect(entryOf(unsigned)).toEqual([0, 0]);
});
