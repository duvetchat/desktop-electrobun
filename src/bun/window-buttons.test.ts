/* oxlint-disable typescript/no-unsafe-type-assertion -- a test's pointers are numbers it makes up or reads off the bridge. */
import { CString, dlopen, FFIType, ptr, type Pointer } from "bun:ffi";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config from "../../electrobun.config";

// The traffic lights' place in the title line on macOS (#406). What can be checked anywhere: the places that name the
// library agree, the app goes on without it, and the title line Bun places the lights in is the one the page draws.
// On a Mac, the library itself, on a window AppKit makes and never shows.

// Electrobun's Bun API starts its updater as it loads, which only runs inside the app: the wrapper gets its folders
// alone. They are an app's that doesn't exist, so the library is never found here, on a Mac included.
const RESOURCES = join(tmpdir(), "duvet-no-such.app", "Contents", "Resources");
void mock.module("electrobun/bun", () => ({ PATHS: { VIEWS_FOLDER: join(RESOURCES, "app", "views") } }));
const buttons = await import("./window-buttons");

const LIBRARY = "native/macos/build/libWindowButtons.dylib";
const ROOT = join(import.meta.dir, "../..");
const copy: Record<string, string> = config.build.copy;

describe("where the lights' library is", () => {
	test("the copy rule takes it from the build script's output, into the app's native folder", () => {
		expect(config.scripts.preBuild).toBe("scripts/build-native.ts");
		expect(copy[LIBRARY]).toBe("native/libWindowButtons.dylib");
	});

	// Electrobun copies into Resources/app. 1.15.1 names only the views' folder; 2.x names Resources itself.
	test("the wrapper loads it where the copy rule puts it, on Electrobun 1.15.1 and 2.x", () => {
		const inApp = join(RESOURCES, "app", copy[LIBRARY]);
		expect(buttons.dylibPath({ VIEWS_FOLDER: join(RESOURCES, "app", "views") })).toBe(inApp);
		expect(buttons.dylibPath({ RESOURCES_FOLDER: RESOURCES, VIEWS_FOLDER: join(RESOURCES, "app", "views") })).toBe(
			inApp,
		);
		expect(buttons.dylibPath()).toBe(inApp);
	});
});

describe("the build script", () => {
	const dirs: string[] = [];
	afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

	// For Windows and Linux there's nothing to compile, and the copy rule still needs its file: an empty one.
	test.each(["win", "linux"])("writes an empty placeholder where the copy rule looks, for %s", (target) => {
		const cwd = mkdtempSync(join(tmpdir(), "duvet-lights-"));
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
	// The lights then stay where the system has them, at the window's corner (index.ts).
	test("nothing is placed, and the call does nothing", () => {
		const window = 0x1234 as Pointer;
		expect(buttons.placeWindowButtons(window)).toBe(false);
		expect(buttons.placeWindowButtons(window, { height: 36, lightsLeft: 9 })).toBe(false);
	});
});

describe("the title line", () => {
	const page = (file: string) => readFileSync(join(ROOT, "src/mainview/src/lib", file), "utf8");

	// Bun centres the lights in the height the page draws its title line at: the two are written in two places.
	test("is as tall as the page draws it, in the main window and in a Settings window", () => {
		const height = `h-[${buttons.TITLE_LINE.height}px]`;
		expect(page("components/TitleStrip.svelte")).toContain(height);
		expect(page("components/SpaceNav.svelte")).toContain(height);
		expect(page("components/settings/SettingsFrame.svelte")).toContain(height);
	});

	// Three buttons 14 pt wide, 20 pt from one to the next, as the system spaces them in the app.
	test("has the lights end inside the corner the page keeps free for them", () => {
		const inset = /export const TRAFFIC_LIGHTS_INSET = (\d+);/.exec(page("shell-layout.ts"))?.[1];
		expect(inset).toBeDefined();
		expect(buttons.TITLE_LINE.lightsLeft + 2 * 20 + 14).toBeLessThanOrEqual(Number(inset));
	});
});

// The library itself, built as the app's build does and loaded as the wrapper does, on a window of AppKit's that is
// never shown. AppKit lays a title bar out the same on or off screen: a resize, and a new title, put its buttons back.
describe.skipIf(process.platform !== "darwin")("on a Mac, the library", () => {
	const TITLED = 1;
	const CLOSABLE = 2;
	const MINIATURIZABLE = 4;
	const RESIZABLE = 8;
	const FULL_SIZE_CONTENT = 1 << 15;

	const load = async () => {
		const built = spawnSync(process.execPath, [join(ROOT, config.scripts.preBuild)], {
			cwd: ROOT,
			env: { ...process.env, ELECTROBUN_OS: "macos", ELECTROBUN_ARCH: process.arch, ELECTROBUN_BUILD_ENV: "dev" },
			encoding: "utf8",
		});
		expect(built.stderr).toBe("");
		expect(built.status).toBe(0);
		const { symbols } = dlopen(join(ROOT, LIBRARY), {
			wb_placeWindowButtons: { args: [FFIType.ptr, FFIType.f64, FFIType.f64], returns: FFIType.bool },
		});
		const appkit = await import("./appkit");
		const { cls, msg, onMain } = appkit;
		msg(cls("NSApplication"), "sharedApplication");
		const text = (value: string) => {
			const bytes = Buffer.from(`${value}\0`, "utf8");
			return msg(cls("NSString"), "stringWithUTF8String:", BigInt(ptr(bytes)));
		};
		/** A view's frame, through key-value coding: "NSRect: {{17, 18}, {14, 16}}". */
		const frameOf = (view: bigint) => {
			const described = msg(msg(view, "valueForKey:", text("frame")), "description");
			const numbers = new CString(Number(msg(described, "UTF8String")) as Pointer).toString().match(/-?[\d.]+/g);
			const [x, y, width, height] = (numbers ?? []).map(Number);
			return { x, y, width, height };
		};
		/** A window as Electrobun makes a hiddenInset one, 1000 × 700, with its three buttons and their container. */
		const makeWindow = () => {
			const window = onMain(msg(cls("NSWindow"), "alloc"), "init", [], "id");
			onMain(window, "setReleasedWhenClosed:", [{ t: "bool", v: false }]);
			onMain(window, "setStyleMask:", [
				{ t: "int", v: TITLED | CLOSABLE | MINIATURIZABLE | RESIZABLE | FULL_SIZE_CONTENT },
			]);
			onMain(window, "setContentSize:", [{ t: "size", width: 1000, height: 700 }]);
			const [close, minimize, zoom] = [0, 1, 2].map((kind) =>
				onMain(window, "standardWindowButton:", [{ t: "int", v: kind }], "id"),
			) as [bigint, bigint, bigint];
			const container = msg(msg(close, "superview"), "superview");
			return { window, close, minimize, zoom, container, pointer: Number(window) as Pointer };
		};
		/** One turn of the run loop: what the library put off until then runs. */
		const turn = () => void msg(msg(cls("NSRunLoop"), "currentRunLoop"), "runUntilDate:", msg(cls("NSDate"), "date"));
		return { symbols, appkit, text, frameOf, makeWindow, turn };
	};

	test("centres the three buttons in the title line and keeps them there", async () => {
		const { symbols, appkit, text, frameOf, makeWindow, turn } = await load();
		const { onMain } = appkit;
		const made = makeWindow();
		const system = { close: frameOf(made.close), minimize: frameOf(made.minimize), container: frameOf(made.container) };
		const pitch = system.minimize.x - system.close.x;
		expect(pitch).toBeGreaterThan(0);

		const placed = () => {
			const [close, minimize, zoom] = [made.close, made.minimize, made.zoom].map(frameOf) as [
				ReturnType<typeof frameOf>,
				ReturnType<typeof frameOf>,
				ReturnType<typeof frameOf>,
			];
			return {
				line: frameOf(made.container).height,
				lefts: [close.x, minimize.x, zoom.x],
				// From the title line's lower edge, in a line 52 tall: the same from its upper one.
				centred: [close, minimize, zoom].every((button) => button.y === (52 - button.height) / 2),
			};
		};
		const inPlace = { line: 52, lefts: [17, 17 + pitch, 17 + 2 * pitch], centred: true };

		expect(symbols.wb_placeWindowButtons(made.pointer, 17, 52)).toBe(true);
		expect(placed()).toEqual(inPlace);

		// A resize: AppKit lays the title bar out again, and the buttons are back in the line before the call returns.
		onMain(made.window, "setContentSize:", [{ t: "size", width: 1200, height: 800 }]);
		expect(placed()).toEqual(inPlace);

		// A new title: AppKit puts them back at once, and they are in the line again once the run loop has turned.
		onMain(made.window, "setTitle:", [{ t: "id", v: text("Another title") }]);
		expect(frameOf(made.container).height).toBe(system.container.height);
		turn();
		expect(placed()).toEqual(inPlace);

		// Asked again, for another line: they move there.
		expect(symbols.wb_placeWindowButtons(made.pointer, 30, 36)).toBe(true);
		expect(frameOf(made.container).height).toBe(36);
		expect(frameOf(made.close).x).toBe(30);

		onMain(made.window, "close");
	});

	test("leaves alone what isn't a window with the three buttons", async () => {
		const { symbols, appkit, makeWindow, frameOf } = await load();
		const { cls, msg, onMain } = appkit;
		const notAWindow = Number(msg(msg(cls("NSObject"), "alloc"), "init")) as Pointer;
		expect(symbols.wb_placeWindowButtons(notAWindow, 17, 52)).toBe(false);
		expect(symbols.wb_placeWindowButtons(null, 17, 52)).toBe(false);

		// A line without a height, and a place off the window's left edge: nothing moves.
		const made = makeWindow();
		const before = frameOf(made.close);
		expect(symbols.wb_placeWindowButtons(made.pointer, 17, 0)).toBe(false);
		expect(symbols.wb_placeWindowButtons(made.pointer, -4, 52)).toBe(false);
		expect(frameOf(made.close)).toEqual(before);
		onMain(made.window, "close");
	});
});
