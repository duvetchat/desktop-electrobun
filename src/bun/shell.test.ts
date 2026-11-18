import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { mediaWindowTitleBar } from "./media-window";
import { settingsChrome } from "./settings-windows";
import { rendererFor, shellPreload, windowChrome, type InjectedShell } from "./shell";
import { mainWindowTitleBar } from "./window-keys";

/** Runs a preload script as a page would, in a frame that is or isn't the top one, and returns what it left. */
function run(script: string, topFrame: boolean): { __duvetShell?: InjectedShell } {
	const page: { top?: unknown; __duvetShell?: InjectedShell } = {};
	page.top = topFrame ? page : {};
	runInNewContext(script, { window: page });
	return page;
}

test("the preload tells the page its system, its title bar's style and which window it is", () => {
	const page = run(shellPreload("main", { titleBarStyle: "hiddenInset", nativeButtons: true }, "darwin"), true);
	expect(page.__duvetShell).toEqual({
		os: "darwin",
		titleBarStyle: "hiddenInset",
		nativeButtons: true,
		window: "main",
	});
});

test("it takes the system from the process unless told", () => {
	expect(run(shellPreload("media", { titleBarStyle: "hidden", nativeButtons: false }), true).__duvetShell).toEqual({
		os: process.platform,
		titleBarStyle: "hidden",
		nativeButtons: false,
		window: "media",
	});
});

test("the page can't change what it was told", () => {
	const shell = run(
		shellPreload("settings", { titleBarStyle: "default", nativeButtons: true }, "win32"),
		true,
	).__duvetShell!;
	expect(Object.isFrozen(shell)).toBe(true);
});

// Electrobun injects preloads into subframes on some platforms: an embedded player's page learns nothing.
test("a subframe is told nothing", () => {
	expect(
		run(shellPreload("main", { titleBarStyle: "hidden", nativeButtons: false }, "linux"), false).__duvetShell,
	).toBeUndefined();
});

test("the script is one statement of plain JavaScript, with nothing of the page's in it", () => {
	const script = shellPreload("space-settings", { titleBarStyle: "hiddenInset", nativeButtons: false }, "darwin");
	expect(script).toBe(
		'if (window.top === window) window.__duvetShell = Object.freeze({"os":"darwin","titleBarStyle":"hiddenInset","nativeButtons":false,"window":"space-settings"});',
	);
});

// C-21 of the redesign's review: these branches only ever ran on macOS, and none had a test. They are functions of the
// platform now, so every system's answer is checked on whichever one runs the tests.
const SYSTEMS = ["darwin", "win32", "linux"] as const;

test("macOS windows keep the system's buttons over a title bar that takes keys; Windows and Linux have neither", () => {
	expect(windowChrome("darwin")).toEqual({ titleBarStyle: "hiddenInset", nativeButtons: true });
	expect(windowChrome("win32")).toEqual({ titleBarStyle: "hidden", nativeButtons: false });
	expect(windowChrome("linux")).toEqual({ titleBarStyle: "hidden", nativeButtons: false });
	// A system the app doesn't ship for gets the page's own buttons, never a window with none.
	expect(windowChrome("freebsd")).toEqual({ titleBarStyle: "hidden", nativeButtons: false });
});

test("every window of the app has the same chrome on a system: the main one, Settings and the pop-out", () => {
	for (const system of SYSTEMS) {
		const chrome = windowChrome(system);
		expect(settingsChrome(system)).toEqual(chrome);
		expect(mediaWindowTitleBar(system)).toEqual(chrome);
		expect(mainWindowTitleBar(system)).toBe(chrome.titleBarStyle);
	}
});

// The system's buttons show only where the title bar that holds them does: a window with neither is one whose page
// must draw them (C-01 was a page that didn't).
test("a window without the system's buttons says so to its page, on every system and in every window", () => {
	for (const system of SYSTEMS) {
		for (const window of ["main", "media", "settings", "space-settings"] as const) {
			const chrome = windowChrome(system);
			const told = run(shellPreload(window, chrome, system), true).__duvetShell;
			expect(told).toEqual({ os: system, window, ...chrome });
			expect(told?.nativeButtons).toBe(system === "darwin");
		}
	}
});

test("Linux draws with CEF, macOS and Windows with the system's web view", () => {
	expect(SYSTEMS.map(rendererFor)).toEqual(["native", "native", "cef"]);
});
