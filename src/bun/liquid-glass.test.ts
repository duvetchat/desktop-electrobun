import type { Pointer } from "bun:ffi";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config from "../../electrobun.config";

// The glass behind the main window on macOS (#374). Its library is AppKit's and only builds and runs on a Mac; what
// can be checked anywhere is that the three places that name it agree: the preBuild hook writes it where the copy rule
// takes it from, and the wrapper loads it where the copy rule puts it. A library left out of the app is no error: the
// window stays opaque, so a mismatch would only show as a sidebar that never turns to glass.

// Electrobun's Bun API starts its updater as it loads, which only runs inside the app: the wrapper gets its folders
// alone. They are an app's that doesn't exist, so the library is never found here, on a Mac included.
const RESOURCES = join(tmpdir(), "duvet-no-such.app", "Contents", "Resources");
void mock.module("electrobun/bun", () => ({ PATHS: { VIEWS_FOLDER: join(RESOURCES, "app", "views") } }));
const glass = await import("./liquid-glass");

const LIBRARY = "native/macos/build/libLiquidGlass.dylib";
const ROOT = join(import.meta.dir, "../..");
const copy: Record<string, string> = config.build.copy;

describe("where the glass's library is", () => {
	test("the copy rule takes it from the build script's output, into the app's native folder", () => {
		expect(config.scripts.preBuild).toBe("scripts/build-liquid-glass.ts");
		expect(copy[LIBRARY]).toBe("native/libLiquidGlass.dylib");
	});

	// Electrobun copies into Resources/app. 1.15.1 names only the views' folder; 2.x names Resources itself.
	test("the wrapper loads it where the copy rule puts it, on Electrobun 1.15.1 and 2.x", () => {
		const inApp = join(RESOURCES, "app", copy[LIBRARY]);
		expect(glass.dylibPath({ VIEWS_FOLDER: join(RESOURCES, "app", "views") })).toBe(inApp);
		expect(glass.dylibPath({ RESOURCES_FOLDER: RESOURCES, VIEWS_FOLDER: join(RESOURCES, "app", "views") })).toBe(inApp);
		expect(glass.dylibPath()).toBe(inApp);
	});
});

describe("the build script", () => {
	const dirs: string[] = [];
	afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

	// Electrobun runs the hook from the project's root with the target's system in ELECTROBUN_OS. For Windows and
	// Linux there's nothing to compile, and the copy rule still needs its file: an empty one, which no app loads.
	test.each(["win", "linux"])("writes an empty placeholder where the copy rule looks, for %s", (target) => {
		const cwd = mkdtempSync(join(tmpdir(), "duvet-glass-"));
		dirs.push(cwd);
		const result = spawnSync(process.execPath, [join(ROOT, config.scripts.preBuild)], {
			cwd,
			env: { ...process.env, ELECTROBUN_OS: target, ELECTROBUN_ARCH: "x64", ELECTROBUN_BUILD_ENV: "dev" },
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(existsSync(join(cwd, LIBRARY))).toBe(true);
		expect(statSync(join(cwd, LIBRARY)).size).toBe(0);
	});
});

describe("without the library", () => {
	// The main window then stays as it was: opaque, its page told there is no glass (index.ts).
	test("there is no glass, and every call does nothing", () => {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a made-up window's address: nothing reads it.
		const window = 0x1234 as Pointer;
		expect(glass.glassAvailable()).toBe(false);
		expect(glass.glassSupported()).toBe(false);
		expect(glass.addWindowGlass(window)).toBe("unavailable");
		expect(glass.setGlassAppearance(window, "dark")).toBe(false);
		expect(glass.enablePrivateCssGlass(window)).toBe(0);
		expect(() => glass.removeWindowGlass(window)).not.toThrow();
		expect(() => glass.debugWindowGlass(window)).not.toThrow();
	});
});
