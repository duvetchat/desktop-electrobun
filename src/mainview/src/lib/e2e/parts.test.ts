import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { ATTACHMENT_PART, PART_TAG } from "./host";
import { BunCoreHost, coreLibrary } from "./testing/host-bun";

// A file through the core a part at a time (parts.ts), as every host's sealFile and openFile run it: here through the
// core's own library and the tests' host.

const user = "0193a4b2-0000-7000-8000-000000000001";
const attachment = "0193a4b2-0000-7000-8000-0000000000f1";
const host = new BunCoreHost();
afterAll(async () => {
	await host.close();
	rmSync(host.folder, { recursive: true, force: true });
});

/** `size` bytes that tell their places apart. */
const bytesOf = (size: number) => new Uint8Array(size).map((_, at) => (at * 7 + (at >> 8)) & 0xff);

describe.skipIf(!coreLibrary)("a file through the core", () => {
	test("goes in parts and comes back whole, whatever its size", async () => {
		expect((await host.open(user)).state).toBe("ready");
		const { key } = await host.handle<{ key: string }>({ cmd: "attachment_key" });
		for (const size of [0, 1, ATTACHMENT_PART, ATTACHMENT_PART + 1, 3 * ATTACHMENT_PART + 5]) {
			const plain = bytesOf(size);
			const told: number[] = [];
			const sealed = await host.sealFile(key, attachment, new Blob([plain]), (done) => told.push(done));
			const parts = Math.max(1, Math.ceil(size / ATTACHMENT_PART));
			expect(sealed.size).toBe(size + parts * PART_TAG);
			expect(told).toHaveLength(parts);
			expect(told.at(-1)).toBe(size);
			const opened = await host.openFile(key, attachment, sealed);
			expect(new Uint8Array(await opened.arrayBuffer())).toEqual(plain);
		}
	});

	test("a part changed, or one cut off, doesn't open", async () => {
		expect((await host.open(user)).state).toBe("ready");
		const { key } = await host.handle<{ key: string }>({ cmd: "attachment_key" });
		const sealed = new Uint8Array(
			await (await host.sealFile(key, attachment, new Blob([bytesOf(100_000)]))).arrayBuffer(),
		);
		const changed = sealed.slice();
		changed[70_000] = (changed[70_000] ?? 0) ^ 1;
		await expect(host.openFile(key, attachment, new Blob([changed]))).rejects.toMatchObject({ code: "decrypt_failed" });
		// Without its last part, the first is taken for the last, which it isn't.
		const cut = sealed.slice(0, ATTACHMENT_PART + PART_TAG);
		await expect(host.openFile(key, attachment, new Blob([cut]))).rejects.toMatchObject({ code: "decrypt_failed" });
	});
});
