import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { shellPreload, windowChrome } from "../../../bun/shell";
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
	nativeButtons: os === "darwin",
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
			settingsInWindows: false,
			popOut: true,
		});
	});

	// Until the shell's phase the page draws its own controls on macOS too, and Bun hides the system's (its title
	// bar is there for the window to take keys, window-keys.ts): the switch says what shows, not what the style is.
	test("on macOS with the system's buttons hidden there are no native lights, and the page draws the controls", () => {
		const shell = shellFor({
			inElectrobun: true,
			injected: { os: "darwin", titleBarStyle: "hiddenInset", nativeButtons: false, window: "main" },
			userAgent: MAC_UA,
			preview: null,
		});
		expect(shell).toMatchObject({ chrome: "mac", nativeTrafficLights: false, ownWindowControls: true });
	});

	test("in the app without Bun's word, macOS draws its own controls: nothing says the lights are there", () => {
		expect(shellFor({ inElectrobun: true, injected: null, userAgent: MAC_UA, preview: null })).toMatchObject({
			chrome: "mac",
			nativeTrafficLights: false,
			ownWindowControls: true,
		});
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
		expect(
			parseInjectedShell(
				handed(shellPreload("media", { titleBarStyle: "hiddenInset", nativeButtons: true }, "darwin")),
			),
		).toEqual({ os: "darwin", titleBarStyle: "hiddenInset", nativeButtons: true, window: "media" });
		expect(
			shellFor({
				inElectrobun: true,
				injected: parseInjectedShell(
					handed(shellPreload("main", { titleBarStyle: "hidden", nativeButtons: false }, "win32")),
				),
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
			{ os: "darwin", titleBarStyle: "hiddenInset", nativeButtons: true },
			{ os: "darwin", titleBarStyle: "hiddenInset", window: "main" },
			{ os: "darwin", titleBarStyle: "frameless", nativeButtons: true, window: "main" },
			{ os: "darwin", titleBarStyle: "hidden", nativeButtons: false, window: "about" },
			{ os: "darwin", titleBarStyle: "hidden", nativeButtons: "no", window: "main" },
			{ os: 1, titleBarStyle: "hidden", nativeButtons: false, window: "main" },
		]) {
			expect(parseInjectedShell(value)).toBeNull();
		}
	});
});

// C-13 of the redesign's review: a window whose preload did not run believed it was the main window, which alone
// renews the session, opens the gateway and answers the other windows. That the preload runs before the page's scripts
// was measured on macOS only.
describe("which window a page is", () => {
	const bare = { inElectrobun: true, injected: null, userAgent: WIN_UA, preview: null };

	test("a page of another window is that window's with no preload at all", () => {
		expect(shellFor({ ...bare, path: "/settings.html" }).window).toBe("settings");
		expect(shellFor({ ...bare, path: "/space-settings.html" }).window).toBe("space-settings");
		expect(shellFor({ ...bare, path: "/voice-controls.html" }).window).toBe("media");
		expect(shellFor({ ...bare, path: "/settings" }).window).toBe("settings");
	});

	test("and stays so whatever the preload claims", () => {
		const claimsMain = { ...bare, injected: injected("win32", "main") };
		expect(shellFor({ ...claimsMain, path: "/settings.html" }).window).toBe("settings");
		expect(shellFor({ ...claimsMain, path: "/voice-controls.html" }).window).toBe("media");
	});

	test("a page Bun loaded in another window is not the main one, whatever its address", () => {
		expect(shellFor({ ...bare, injected: injected("win32", "settings"), path: "/app.html" }).window).toBe("settings");
	});

	test("the app's own pages are the main window's, in the app and in a browser", () => {
		for (const path of ["/app.html", "/sign-in.html", "/", ""]) {
			expect(shellFor({ ...bare, injected: injected("win32"), path }).window).toBe("main");
			expect(shellFor({ ...bare, inElectrobun: false, path }).window).toBe("main");
		}
	});

	// Without the preload the page still draws a window's chrome: its system from the user agent, and its own buttons.
	test("a Settings page with no preload still draws its system's chrome and its own window buttons", () => {
		expect(shellFor({ ...bare, path: "/settings.html" })).toMatchObject({
			chrome: "windows",
			window: "settings",
			nativeTrafficLights: false,
			ownWindowControls: true,
		});
	});
});

// C-21 of the redesign's review: off macOS no window has the system's buttons, and C-01 was a window whose page drew
// none that worked. Bun's chrome for a system (src/bun/shell.ts) and the page's reading of it must agree, in every
// window: where Bun shows no system buttons, the page says it draws its own.
describe("the window's buttons, by system and window", () => {
	for (const os of ["darwin", "win32", "linux"] as const) {
		for (const window of ["main", "media", "settings", "space-settings"] as const) {
			test(`${os}, ${window}: the page draws the buttons exactly where the system doesn't`, () => {
				const chrome = windowChrome(os);
				const page: { top?: unknown; __duvetShell?: unknown } = {};
				page.top = page;
				runInNewContext(shellPreload(window, chrome, os), { window: page });
				const shell = shellFor({
					inElectrobun: true,
					injected: parseInjectedShell(page.__duvetShell),
					userAgent: "",
					preview: null,
				});
				expect(shell.window).toBe(window);
				expect(shell.ownWindowControls).toBe(!chrome.nativeButtons);
				expect(shell.nativeTrafficLights).toBe(chrome.nativeButtons);
				expect(shell.chrome).toBe(os === "darwin" ? "mac" : os === "win32" ? "windows" : "linux");
				// One of the two always: no window is left without a way to close it.
				expect(shell.ownWindowControls || shell.nativeTrafficLights).toBe(true);
			});
		}
	}
});

describe("reading the page", () => {
	const globals = globalThis as { window?: unknown; __duvetShell?: unknown; location?: unknown };
	afterEach(() => {
		delete globals.window;
		delete globals.__duvetShell;
		delete globals.location;
	});

	test("the page's address is read, and decides the window with nothing from Bun", () => {
		globals.window = { __electrobunWindowId: 3 };
		globals.location = { pathname: "/space-settings.html", href: "views://mainview/space-settings.html" };
		const inputs = readShellInputs();
		expect(inputs).toMatchObject({ inElectrobun: true, injected: null, path: "/space-settings.html" });
		expect(shellFor(inputs).window).toBe("space-settings");
	});

	// isElectrobunWindow() is the one place that says whether the page runs in the app.
	test("a page outside Electrobun is the web, whatever it claims about its shell", () => {
		globals.__duvetShell = { os: "darwin", titleBarStyle: "hiddenInset", nativeButtons: true, window: "main" };
		const inputs = readShellInputs();
		expect(inputs.inElectrobun).toBe(false);
		expect(shellFor(inputs).chrome).toBe("web");
	});

	test("a page in Electrobun reads the shell Bun handed it", () => {
		globals.window = { __electrobunWindowId: 1 };
		globals.__duvetShell = { os: "win32", titleBarStyle: "hidden", nativeButtons: false, window: "settings" };
		const inputs = readShellInputs();
		expect(inputs).toMatchObject({
			inElectrobun: true,
			injected: { os: "win32", titleBarStyle: "hidden", nativeButtons: false, window: "settings" },
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

// The app's title bar (Header.svelte) is the main window's: the layout, which every page renders in, draws it there
// alone (#357). The other windows have chrome of their own, the pop-out a strip and the Settings windows a bar, so
// none of their pages hides or covers a title bar the layout drew, as the pop-out's once did.
describe("the app's title bar", () => {
	const source = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");
	const layout = source("routes/+layout.svelte");
	// The layout's rule, as it writes it.
	const draws = (shell: ReturnType<typeof shellFor>) => shell.window === "main" && shell.chrome !== "web";

	test("the layout draws it by the platform switch: in the main window, in the desktop app", () => {
		expect(layout).toContain('const titleBar = shell.window === "main" && shell.chrome !== "web";');
		expect(layout).toMatch(/\{#if titleBar\}\s*<Header \/>\s*\{\/if\}/);
		expect(layout.match(/<Header\b/g)).toHaveLength(1);
	});

	test("the main window has it on every system, and the web has none", () => {
		for (const os of ["darwin", "win32", "linux"]) expect(draws(inApp(os)), os).toBe(true);
		expect(draws(shellFor({ inElectrobun: false, injected: null, userAgent: MAC_UA, preview: null }))).toBe(false);
	});

	test("the pop-out, the Settings window and a Space's settings window have none, on any system", () => {
		for (const os of ["darwin", "win32", "linux"])
			for (const window of ["media", "settings", "space-settings"] as const) {
				const shell = shellFor({
					inElectrobun: true,
					injected: injected(os, window),
					userAgent: MAC_UA,
					preview: null,
				});
				expect(shell.window, `${window} on ${os}`).toBe(window);
				expect(draws(shell), `${window} on ${os}`).toBe(false);
			}
	});

	test("none of their pages hides or covers a title bar", () => {
		for (const route of ["voice-controls", "settings", "space-settings"]) {
			const page = source(`routes/${route}/+page.svelte`);
			expect(page, route).not.toMatch(/window-titlebar|data-title-bar|style\.display|<Header\b/);
			expect(page, route).not.toMatch(/\bfixed inset-0\b/);
		}
	});
});
