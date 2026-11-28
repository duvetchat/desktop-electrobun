import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CARRIED, checkSums } from "../../scripts/core-artifacts";

// The core's artifacts the desktop carries (PLAN-E2E-CLIENTES.md, its section on the core's artifacts): what its
// release had, byte for byte, as native/core/SOURCE.json records them. scripts/core-artifacts.ts writes both.
const root = join(import.meta.dir, "..", "..");
const sha256 = async (path: string) =>
	new Bun.CryptoHasher("sha256").update(await Bun.file(join(root, path)).bytes()).digest("hex");

describe("the core's artifacts", () => {
	test("each file's SHA-256 is the one SOURCE.json records", async () => {
		const source = await Bun.file(join(root, "native/core/SOURCE.json")).json();
		expect(source.repository).toBe("duvetchat/e2e");
		expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
		const files: Record<string, string> = source.files;
		expect(Object.keys(files).sort()).toEqual(Object.values(CARRIED).sort());
		for (const [path, hash] of Object.entries(files)) expect(await sha256(path)).toBe(hash);
	});

	// PLAN-E2E-PLATAFORMAS.md, Task 8 and Review Focus 11: the release names it by its system, the app by its own name.
	test("macOS's library is its release's macos-arm64 file, byte for byte", async () => {
		const path = "native/core/macos-arm64/libduvet_e2e_ffi.dylib";
		expect(CARRIED["macos-arm64-libduvet_e2e_ffi.dylib"]).toBe(path);
		const source = await Bun.file(join(root, "native/core/SOURCE.json")).json();
		expect(source.files[path]).toBe(await sha256(path));
	});

	test("a downloaded file is taken only with the hash SHA256SUMS gives it", () => {
		const bytes = new TextEncoder().encode("the core");
		const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
		const sums = `${hash}  duvet_e2e_ffi.dll\n${"0".repeat(64)}  libduvet_e2e_ffi.so\n`;
		expect(checkSums(sums, "duvet_e2e_ffi.dll", bytes)).toBe(hash);
		expect(() => checkSums(sums, "libduvet_e2e_ffi.so", bytes)).toThrow("libduvet_e2e_ffi.so");
		expect(() => checkSums(sums, "duvet_e2e_wasm.js", bytes)).toThrow("duvet_e2e_wasm.js");
	});
});
