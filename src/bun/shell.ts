// A window's shell: what only Bun knows about a window, handed to its page before the page's own scripts run. The
// page's platform switch reads it (src/mainview/src/lib/platform.ts: window.__duvetShell) to decide whose window
// chrome to draw, and which window it is (#357, docs/redesign/PLATFORM.md §11).

/** Which of the app's windows a page is in: the main one, the media controls' pop-out, Settings or a Space's settings. */
export type WindowKind = "main" | "media" | "settings" | "space-settings";

/** Electrobun's title-bar styles: hidden has no title bar and no native buttons, hiddenInset a transparent one with
 * macOS's traffic lights inset, default the system's own. */
export type TitleBarStyle = "hidden" | "hiddenInset" | "default";

export interface InjectedShell {
	/** process.platform: darwin, win32 or linux. */
	os: string;
	titleBarStyle: TitleBarStyle;
	/** Whether the system's own window buttons show (macOS's traffic lights): else the page draws its own. */
	nativeButtons: boolean;
	window: WindowKind;
}

/**
 * The script for a BrowserWindow's `preload`: Electrobun injects it as a user script at document start, measured to
 * run before any of the page's scripts. It sets window.__duvetShell, frozen, in the top frame only: Electrobun injects
 * preloads into subframes too on some platforms, and an embedded player's page is told nothing.
 */
export function shellPreload(
	window: WindowKind,
	{ titleBarStyle, nativeButtons }: { titleBarStyle: TitleBarStyle; nativeButtons: boolean },
	os: string = process.platform,
): string {
	const shell: InjectedShell = { os, titleBarStyle, nativeButtons, window };
	return `if (window.top === window) window.__duvetShell = Object.freeze(${JSON.stringify(shell)});`;
}

/** A window's chrome: its title bar's style, and whether the system's own buttons show. */
export interface WindowChrome {
	titleBarStyle: TitleBarStyle;
	nativeButtons: boolean;
}

/**
 * The chrome of every window of the app, the main one, Settings, a Space's settings and the media controls' pop-out,
 * by the system it runs on. On macOS a transparent title bar with the system's traffic lights: a window with no title
 * bar can't take keys there (window-keys.ts), and the lights are the window's buttons. On Windows and Linux none, and
 * no system buttons either: the page draws minimize, maximize and close itself (lib/platform.ts: ownWindowControls,
 * WindowControls.svelte), in every one of those windows.
 */
export function windowChrome(platform: string): WindowChrome {
	return platform === "darwin"
		? { titleBarStyle: "hiddenInset", nativeButtons: true }
		: { titleBarStyle: "hidden", nativeButtons: false };
}

/** What draws the app's pages: the system's own web view (WKWebView, WebView2), and CEF on Linux, whose system web
 * view (WebKitGTK) the app doesn't use. Every window of the app takes the same one. */
export function rendererFor(platform: string): "native" | "cef" {
	return platform === "linux" ? "cef" : "native";
}
