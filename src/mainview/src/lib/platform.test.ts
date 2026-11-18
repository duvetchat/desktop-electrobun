import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { shellPreload } from "../../../bun/shell";
import {
	currentShell,
	osFromUserAgent,
	parseInjectedShell,
	readShellInputs,
	shellFor,
	type InjectedShell,
} from "$lib/platform";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/131.0";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0";
const injected = (os: string, window: InjectedShell["window"] = "main"): InjectedShell => ({
	os,
	titleBarStyle: os === "darwin" ? "hiddenInset" : "hidden",
	window,
});
const inApp = (os: string, userAgent = MAC_UA) =>
	shellFor({ inElectrobun: true, injected: injected(os), userAgent, preview: null });

describe("shellFor", () => {
	test("the user agent tells macOS, Windows and Linux apart", () => {
		expect([MAC_UA, WIN_UA, LINUX_UA, "curl/8"].map(osFromUserAgent)).toEqual(["mac", "windows", "linux", "other"]);
	});

	test("in the app on macOS the traffic lights are native and the page draws no window controls", () => {
		expect(inApp("darwin")).toMatchObject({
			chrome: "mac",
			os: "mac",
			nativeTrafficLights: true,
			ownWindowControls: false,
			draggableTitleBar: true,
			settingsInWindows: true,
			popOut: true,
		});
	});

	// A hidden title bar has no native buttons (Electrobun hides them): the page still draws its own, as it does today.
	test("on macOS with a hidden title bar there are no native lights, and the page draws the controls", () => {
		const shell = shellFor({
			inElectrobun: true,
			injected: { os: "darwin", titleBarStyle: "hidden", window: "main" },
			userAgent: MAC_UA,
			preview: null,
		});
		expect(shell).toMatchObject({ chrome: "mac", nativeTrafficLights: false, ownWindowControls: true });
	});

	test("on Windows and Linux the page draws its own controls", () => {
		expect(inApp("win32", WIN_UA)).toMatchObject({
			chrome: "windows",
			nativeTrafficLights: false,
			ownWindowControls: true,
		});
		expect(inApp("linux", LINUX_UA)).toMatchObject({
			chrome: "linux",
			nativeTrafficLights: false,
			ownWindowControls: true,
		});
	});

	test("Bun's word wins over the user agent", () => {
		expect(inApp("linux", MAC_UA).os).toBe("linux");
	});

	test("a system Bun names that the app doesn't know falls back on the user agent", () => {
		expect(inApp("freebsd", LINUX_UA)).toMatchObject({ os: "linux", chrome: "linux" });
	});

	test("in the app without Bun's word, the user agent says which system", () => {
		expect(shellFor({ inElectrobun: true, injected: null, userAgent: WIN_UA, preview: null })).toMatchObject({
			chrome: "windows",
			window: "main",
		});
	});

	test("the web gets no window chrome, no extra windows and no pop-out", () => {
		expect(shellFor({ inElectrobun: false, injected: null, userAgent: MAC_UA, preview: null })).toMatchObject({
			chrome: "web",
			os: "mac",
			nativeTrafficLights: false,
			ownWindowControls: false,
			draggableTitleBar: false,
			settingsInWindows: false,
			popOut: false,
			preview: false,
		});
	});

	test("a preview draws another system's chrome in a browser, and says it is a preview", () => {
		expect(shellFor({ inElectrobun: false, injected: null, userAgent: MAC_UA, preview: "windows" })).toMatchObject({
			chrome: "windows",
			ownWindowControls: true,
			popOut: true,
			preview: true,
		});
		expect(shellFor({ inElectrobun: false, injected: null, userAgent: WIN_UA, preview: "mac" })).toMatchObject({
			chrome: "mac",
			nativeTrafficLights: true,
			preview: true,
		});
		expect(
			shellFor({ inElectrobun: true, injected: injected("darwin"), userAgent: MAC_UA, preview: "web" }),
		).toMatchObject({ chrome: "web", popOut: false, preview: true });
	});

	test("an unknown preview is ignored", () => {
		expect(shellFor({ inElectrobun: false, injected: null, userAgent: MAC_UA, preview: "beos" })).toMatchObject({
			chrome: "web",
			preview: false,
		});
	});

	// DECISIONS.md: the opaque tint everywhere until someone has seen the vibrant sidebar.
	test("vibrancy stays off everywhere, previews included", () => {
		for (const os of ["darwin", "win32", "linux"]) expect(inApp(os).vibrancy).toBe(false);
		for (const preview of ["mac", "windows", "linux", "web"]) {
			expect(shellFor({ inElectrobun: false, injected: null, userAgent: MAC_UA, preview }).vibrancy).toBe(false);
		}
	});

	test("a window knows which window it is from Bun", () => {
		for (const window of ["main", "media", "settings", "space-settings"] as const) {
			expect(
				shellFor({ inElectrobun: true, injected: injected("darwin", window), userAgent: MAC_UA, preview: null }).window,
			).toBe(window);
		}
	});
});

describe("what Bun's preload hands the page", () => {
	const handed = (script: string): unknown => {
		const page: { top?: unknown; __duvetShell?: unknown } = {};
		page.top = page;
		runInNewContext(script, { window: page });
		return page.__duvetShell;
	};

	test("is a shell the switch reads as it is", () => {
		expect(parseInjectedShell(handed(shellPreload("media", "hiddenInset", "darwin")))).toEqual({
			os: "darwin",
			titleBarStyle: "hiddenInset",
			window: "media",
		});
		expect(
			shellFor({
				inElectrobun: true,
				injected: parseInjectedShell(handed(shellPreload("main", "hidden", "win32"))),
				userAgent: MAC_UA,
				preview: null,
			}),
		).toMatchObject({ chrome: "windows", window: "main" });
	});

	test("anything else is no shell", () => {
		for (const value of [
			undefined,
			null,
			"main",
			{},
			{ os: "darwin", titleBarStyle: "hiddenInset" },
			{ os: "darwin", titleBarStyle: "frameless", window: "main" },
			{ os: "darwin", titleBarStyle: "hidden", window: "about" },
			{ os: 1, titleBarStyle: "hidden", window: "main" },
		]) {
			expect(parseInjectedShell(value)).toBeNull();
		}
	});
});

describe("reading the page", () => {
	const globals = globalThis as { window?: unknown; __duvetShell?: unknown };
	afterEach(() => {
		delete globals.window;
		delete globals.__duvetShell;
	});

	// isElectrobunWindow() is the one place that says whether the page runs in the app.
	test("a page outside Electrobun is the web, whatever it claims about its shell", () => {
		globals.__duvetShell = { os: "darwin", titleBarStyle: "hiddenInset", window: "main" };
		const inputs = readShellInputs();
		expect(inputs.inElectrobun).toBe(false);
		expect(shellFor(inputs).chrome).toBe("web");
	});

	test("a page in Electrobun reads the shell Bun handed it", () => {
		globals.window = { __electrobunWindowId: 1 };
		globals.__duvetShell = { os: "win32", titleBarStyle: "hidden", window: "settings" };
		const inputs = readShellInputs();
		expect(inputs).toMatchObject({
			inElectrobun: true,
			injected: { os: "win32", titleBarStyle: "hidden", window: "settings" },
		});
		expect(shellFor(inputs)).toMatchObject({ chrome: "windows", window: "settings" });
	});

	test("no preview is read outside the dev server", () => {
		localStorage.setItem("duvet.dev.shell", "windows");
		try {
			expect(readShellInputs().preview).toBeNull();
		} finally {
			localStorage.removeItem("duvet.dev.shell");
		}
	});

	test("the page's shell is read once", () => {
		expect(currentShell()).toBe(currentShell());
	});
});

// The preview must not reach a build: its only reads sit inside the block Vite's flag removes.
test("the preview override is read only inside the dev-only block", () => {
	const source = readFileSync(join(import.meta.dir, "platform.ts"), "utf8");
	const block = /if \(import\.meta\.env\.DEV\) \{([\s\S]*?)\n\t\}/.exec(source)?.[1] ?? "";
	expect(block).toContain('searchParams.get("shell")');
	expect(block).toContain('localStorage.getItem("duvet.dev.shell")');
	const outside = source.replace(block, "").replace(/^\s*\/\/.*$/gm, "");
	expect(outside).not.toContain("duvet.dev.shell");
	expect(outside).not.toContain("searchParams");
});
