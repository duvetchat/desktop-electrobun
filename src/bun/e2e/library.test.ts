import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config from "../../../electrobun.config";
import { coreLibraryCopy, coreLibraryFile, coreLibraryPath } from "./library";

// The library each build carries and where the app finds it (PLAN-E2E-CLIENTES.md, Task 7; PLAN-E2E-PLATAFORMAS.md,
// Tasks 4 and 8): Windows x64's DLL, Linux x64's shared object and macOS arm64's dylib, each copied to
// Resources/app/native/.

const ROOT = join(import.meta.dir, "../../..");

const folders: string[] = [];
afterAll(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));

describe("the core's library in the app", () => {
	test("a Windows build carries the DLL, where the app loads it; a Windows arm64 one none", () => {
		expect(coreLibraryCopy("win32", "x64")).toEqual({
			"native/core/win-x64/duvet_e2e_ffi.dll": "native/duvet_e2e_ffi.dll",
		});
		expect(existsSync(join(ROOT, "native/core/win-x64/duvet_e2e_ffi.dll"))).toBe(true);
		expect(coreLibraryCopy("win32", "arm64")).toEqual({});
		// The build's own rule, on the system it runs on: Electrobun builds for that one alone.
		const copy: Record<string, string> = config.build.copy;
		const rule = ([from]: [string, string]) => from.startsWith("native/core/") || from.includes("libduvet_e2e_ffi");
		expect(Object.entries(copy).filter(rule)).toEqual(Object.entries(coreLibraryCopy(process.platform, process.arch)));
	});

	test("a Linux x64 build carries its library, and a Linux arm64 one none", () => {
		expect(coreLibraryCopy("linux", "x64")).toEqual({
			"native/core/linux-x64/libduvet_e2e_ffi.so": "native/libduvet_e2e_ffi.so",
		});
		expect(existsSync(join(ROOT, "native/core/linux-x64/libduvet_e2e_ffi.so"))).toBe(true);
		// No release of the core builds for it: its conversations stay unsupported.
		expect(coreLibraryCopy("linux", "arm64")).toEqual({});
	});

	test("a macOS arm64 build carries its library, and an Intel one none", () => {
		// The copy the preBuild hook leaves with the app's own libraries, signed as they are when there's a Developer ID
		// (scripts/build-native.ts): the release's own file keeps the bytes SOURCE.json pins.
		expect(coreLibraryCopy("darwin", "arm64")).toEqual({
			"native/macos/build/libduvet_e2e_ffi.dylib": "native/libduvet_e2e_ffi.dylib",
		});
		expect(coreLibraryFile("darwin", "arm64")).toBe("native/core/macos-arm64/libduvet_e2e_ffi.dylib");
		expect(existsSync(join(ROOT, "native/core/macos-arm64/libduvet_e2e_ffi.dylib"))).toBe(true);
		// The hook builds into that folder, which no build takes for a source, and no checkout keeps.
		expect(config.build.watchIgnore).toContain("native/macos/build/**");
		// No release of the core builds for an Intel Mac (the plan's Ruling 4): its conversations stay unsupported.
		expect(coreLibraryCopy("darwin", "x64")).toEqual({});
		expect(coreLibraryFile("darwin", "x64")).toBeNull();
	});

	test("each library a build carries is one the core's release pinned", () => {
		const pinned: Record<string, string> = JSON.parse(
			readFileSync(join(ROOT, "native/core/SOURCE.json"), "utf8"),
		).files;
		for (const [platform, arch] of [
			["win32", "x64"],
			["linux", "x64"],
			["darwin", "arm64"],
		] as const) {
			expect(Object.keys(pinned)).toContain(coreLibraryFile(platform, arch)!);
		}
	});

	test("the app finds it where the copy rule puts it, and without it the core is unsupported", () => {
		// Electrobun copies into Resources/app, which is nativeLibraryPath's folder (native-library.ts).
		const app = mkdtempSync(join(tmpdir(), "duvet-core-"));
		folders.push(app);
		const inApp = (name: string) => join(app, "native", name);
		const carrying = [
			["win32", "x64"],
			["linux", "x64"],
			["darwin", "arm64"],
		] as const;
		for (const [platform, arch] of carrying) expect(coreLibraryPath(inApp, platform, arch)).toBeNull();
		mkdirSync(join(app, "native"));
		for (const [platform, arch] of carrying) {
			const [copied] = Object.values(coreLibraryCopy(platform, arch));
			writeFileSync(join(app, copied), "");
			expect(coreLibraryPath(inApp, platform, arch)).toBe(join(app, copied));
		}
		expect(coreLibraryPath(inApp, "linux", "arm64")).toBeNull();
		expect(coreLibraryPath(inApp, "darwin", "x64")).toBeNull();
	});
});
