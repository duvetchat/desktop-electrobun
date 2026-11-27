import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config from "../../../electrobun.config";
import { coreLibraryCopy, coreLibraryPath } from "./library";

// The library each build carries and where the app finds it (PLAN-E2E-CLIENTES.md, Task 7; PLAN-E2E-PLATAFORMAS.md,
// Task 4): Windows x64's DLL and Linux x64's shared object, each copied to Resources/app/native/.

const ROOT = join(import.meta.dir, "../../..");

const folders: string[] = [];
afterAll(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));

describe("the core's library in the app", () => {
	test("a Windows build carries the DLL, where the app loads it; macOS carries none", () => {
		expect(coreLibraryCopy("win32", "x64")).toEqual({
			"native/core/win-x64/duvet_e2e_ffi.dll": "native/duvet_e2e_ffi.dll",
		});
		expect(existsSync(join(ROOT, "native/core/win-x64/duvet_e2e_ffi.dll"))).toBe(true);
		for (const [platform, arch] of [
			["darwin", "arm64"],
			["darwin", "x64"],
			["win32", "arm64"],
		] as const) {
			expect(coreLibraryCopy(platform, arch)).toEqual({});
		}
		// The build's own rule, on the system it runs on: Electrobun builds for that one alone.
		const copy: Record<string, string> = config.build.copy;
		expect(Object.entries(copy).filter(([from]) => from.startsWith("native/core/"))).toEqual(
			Object.entries(coreLibraryCopy(process.platform, process.arch)),
		);
	});

	test("a Linux x64 build carries its library, and a Linux arm64 one none", () => {
		expect(coreLibraryCopy("linux", "x64")).toEqual({
			"native/core/linux-x64/libduvet_e2e_ffi.so": "native/libduvet_e2e_ffi.so",
		});
		expect(existsSync(join(ROOT, "native/core/linux-x64/libduvet_e2e_ffi.so"))).toBe(true);
		// No release of the core builds for it: its conversations stay unsupported.
		expect(coreLibraryCopy("linux", "arm64")).toEqual({});
	});

	test("the app finds it where the copy rule puts it, and without it the core is unsupported", () => {
		// Electrobun copies into Resources/app, which is nativeLibraryPath's folder (native-library.ts).
		const app = mkdtempSync(join(tmpdir(), "duvet-core-"));
		folders.push(app);
		const inApp = (name: string) => join(app, "native", name);
		expect(coreLibraryPath(inApp, "win32", "x64")).toBeNull();
		expect(coreLibraryPath(inApp, "linux", "x64")).toBeNull();
		mkdirSync(join(app, "native"));
		for (const [platform, arch] of [
			["win32", "x64"],
			["linux", "x64"],
		] as const) {
			const [copied] = Object.values(coreLibraryCopy(platform, arch));
			writeFileSync(join(app, copied), "");
			expect(coreLibraryPath(inApp, platform, arch)).toBe(join(app, copied));
		}
		expect(coreLibraryPath(inApp, "linux", "arm64")).toBeNull();
		expect(coreLibraryPath(inApp, "darwin", "arm64")).toBeNull();
	});
});
