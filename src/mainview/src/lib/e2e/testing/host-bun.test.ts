import { afterAll, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { BunCoreHost, nativeCoreLibrary } from "./host-bun";

const host = new BunCoreHost();
afterAll(() => rmSync(host.folder, { recursive: true, force: true }));

// The plan's five commands with ways of their own (PLAN-E2E-CLIENTES.md, its section on the core's host): their bytes
// go in parts, never in one JSON.
test.each(["attachment_encrypt", "attachment_decrypt", "history_share", "catch_up", "history_import"])(
	"handle refuses %s, which has a way of its own",
	async (cmd) => {
		await expect(host.handle({ cmd })).rejects.toMatchObject({ code: "bad_command", field: "cmd" });
	},
);

// What a test loads without DUVET_E2E_FFI (PLAN-E2E-PLATAFORMAS.md, Task 8): the library a build of that system carries,
// as its release has it, so the engine's tests run on macOS too.
test("a test loads native/core's library: Windows' and Linux's on x64, macOS's on arm64", () => {
	const root = join(import.meta.dir, "../../../../../..");
	const pinned = Object.keys(JSON.parse(readFileSync(join(root, "native/core/SOURCE.json"), "utf8")).files);
	for (const [platform, arch, file] of [
		["win32", "x64", "native/core/win-x64/duvet_e2e_ffi.dll"],
		["linux", "x64", "native/core/linux-x64/libduvet_e2e_ffi.so"],
		["darwin", "arm64", "native/core/macos-arm64/libduvet_e2e_ffi.dylib"],
	] as const) {
		const library = nativeCoreLibrary(platform, arch);
		expect(library === null ? null : relative(root, library)).toBe(file);
		expect(existsSync(library!)).toBe(true);
		expect(pinned).toContain(file);
	}
	// No release of the core builds for these: their engine's tests don't run.
	expect(nativeCoreLibrary("darwin", "x64")).toBeNull();
	expect(nativeCoreLibrary("linux", "arm64")).toBeNull();
});
