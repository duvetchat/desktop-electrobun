import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { shellPreload, type InjectedShell } from "./shell";

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
