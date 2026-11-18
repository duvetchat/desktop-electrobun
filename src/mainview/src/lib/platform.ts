import { secondWindowOfPath, type WindowKind } from "$lib/app-windows";
import { isElectrobunWindow } from "$lib/electrobun-rpc";

// The platform switch (#357, docs/redesign/PLATFORM.md §11): every decision of the shell that depends on where the
// app runs reads from `shellFor`, a pure function of what the page can know before it paints:
//   - whether it runs in the desktop app: isElectrobunWindow() (lib/electrobun-rpc.ts), the one place that says so;
//   - the shell Bun hands this window in its preload (src/bun/shell.ts: window.__duvetShell), at document start: the
//     system from process.platform, the title bar's style Bun chose, whether the system's window buttons show, and
//     which window this is. Only Bun knows these;
//   - the page's own address, which says which window it is when it is not the main one (lib/app-windows.ts), whatever
//     the preload did;
//   - the user agent, as a fallback, and in a browser;
//   - under the dev server only, a preview override (?shell=mac|windows|linux|web, or localStorage duvet.dev.shell),
//     so a browser can draw another system's chrome for review. A build has none of it (import.meta.env.DEV).

export type Os = "mac" | "windows" | "linux" | "other";
export type { WindowKind };
export type TitleBarStyle = "hidden" | "hiddenInset" | "default";

/** What Bun tells a window about itself (src/bun/shell.ts). */
export interface InjectedShell {
	os: string;
	titleBarStyle: TitleBarStyle;
	/** Whether the system's own window buttons show (macOS's traffic lights). */
	nativeButtons: boolean;
	window: WindowKind;
}

export interface ShellInputs {
	inElectrobun: boolean;
	injected: InjectedShell | null;
	userAgent: string;
	/** Only ever non-null under the dev server. */
	preview: string | null;
	/** The page's path (location.pathname): a page of another window is that window's, with or without the preload. */
	path?: string;
}

export interface Shell {
	/** Whose window chrome to draw: a system's, or the web's (none). */
	chrome: "mac" | "windows" | "linux" | "web";
	os: Os;
	window: WindowKind;
	/** macOS draws the traffic lights itself: leave them their corner (PLATFORM.md §1). Only when Bun says the
	 * window's own buttons show: it hides them while the page still draws its own. */
	nativeTrafficLights: boolean;
	/** The page draws minimize, maximize and close itself: Windows and Linux, and macOS while its lights are hidden. */
	ownWindowControls: boolean;
	/** The title bar's strip drags the window (Electrobun's drag class); never on the web. */
	draggableTitleBar: boolean;
	/** Settings and Space settings open in windows of their own instead of sheets of the main window: off everywhere. */
	settingsInWindows: boolean;
	/** The media controls can pop out into their own window: the desktop app only. */
	popOut: boolean;
	/** Vibrancy behind the sidebar: off everywhere until it has been seen and approved (DECISIONS.md). */
	vibrancy: boolean;
	/** Whether this is a preview override: the dev server drawing another system. */
	preview: boolean;
}

export function osFromUserAgent(userAgent: string): Os {
	if (/Macintosh|Mac OS X/.test(userAgent)) return "mac";
	if (/Windows NT/.test(userAgent)) return "windows";
	if (/Linux|X11|CrOS/.test(userAgent)) return "linux";
	return "other";
}

const OS_OF: Record<string, Os> = { darwin: "mac", win32: "windows", linux: "linux" };
const PREVIEWS = ["mac", "windows", "linux", "web"] as const;
const WINDOWS: readonly string[] = ["main", "media", "settings", "space-settings"] satisfies WindowKind[];
const TITLE_BARS: readonly string[] = ["hidden", "hiddenInset", "default"] satisfies TitleBarStyle[];

const isWindowKind = (value: unknown): value is WindowKind => typeof value === "string" && WINDOWS.includes(value);
const isTitleBarStyle = (value: unknown): value is TitleBarStyle =>
	typeof value === "string" && TITLE_BARS.includes(value);

/** window.__duvetShell as Bun wrote it, or null for anything else: a page in a browser has none. */
export function parseInjectedShell(value: unknown): InjectedShell | null {
	if (typeof value !== "object" || value === null) return null;
	if (!("os" in value) || !("titleBarStyle" in value) || !("nativeButtons" in value) || !("window" in value))
		return null;
	const { os, titleBarStyle, nativeButtons, window } = value;
	if (typeof os !== "string" || !isTitleBarStyle(titleBarStyle) || !isWindowKind(window)) return null;
	if (typeof nativeButtons !== "boolean") return null;
	return { os, titleBarStyle, nativeButtons, window };
}

export function shellFor({ inElectrobun, injected, userAgent, preview, path = "" }: ShellInputs): Shell {
	const previewed = PREVIEWS.find((name) => name === preview) ?? null;
	const desktop = previewed ? previewed !== "web" : inElectrobun;
	const os: Os =
		previewed && previewed !== "web"
			? previewed
			: ((injected ? OS_OF[injected.os] : undefined) ?? osFromUserAgent(userAgent));
	const chrome: Shell["chrome"] = !desktop ? "web" : os === "mac" ? "mac" : os === "windows" ? "windows" : "linux";
	// A preview draws the design, where macOS has its lights; the app has them when Bun says the window shows them.
	const nativeTrafficLights = chrome === "mac" && (previewed !== null || injected?.nativeButtons === true);
	return {
		chrome,
		os,
		// The page's address first: a Settings or pop-out page whose preload didn't run would otherwise take itself
		// for the main window, renew the session and draw the main title bar. Then Bun's word, which also says "not
		// main" for any page it loaded in another window.
		window: secondWindowOfPath(path) ?? injected?.window ?? "main",
		nativeTrafficLights,
		ownWindowControls: desktop && !nativeTrafficLights,
		draggableTitleBar: desktop,
		// Sheets of the main window in the app as on the web: a window of their own opened beside it, outside its place.
		settingsInWindows: false,
		popOut: desktop,
		vibrancy: false,
		preview: previewed !== null,
	};
}

/** The inputs as this page has them. */
export function readShellInputs(): ShellInputs {
	let preview: string | null = null;
	// Under the dev server only: Vite replaces the flag, and a build drops this block whole.
	if (import.meta.env.DEV) {
		try {
			preview = new URL(location.href).searchParams.get("shell") ?? localStorage.getItem("duvet.dev.shell");
		} catch {
			preview = null;
		}
	}
	return {
		inElectrobun: isElectrobunWindow(),
		injected: parseInjectedShell("__duvetShell" in globalThis ? globalThis.__duvetShell : null),
		userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
		preview,
		path: typeof location === "undefined" ? "" : location.pathname,
	};
}

let current: Shell | null = null;

/** This page's shell, read once: nothing it depends on changes while a page lives. */
export function currentShell(): Shell {
	return (current ??= shellFor(readShellInputs()));
}

declare global {
	// Set by Bun's preload in the desktop app (src/bun/shell.ts); absent in a browser.
	var __duvetShell: unknown;
}
