// Keys reaching the page on macOS (#357, docs/redesign/PLATFORM.md §12). On macOS 27 nobody could type in the app:
//   - the main window had no title bar (Electrobun's "hidden": an NSWindow without NSWindowStyleMaskTitled), and
//     such a window can't become the key window there (canBecomeKeyWindow is NO). Keys go to the key window, so
//     none arrived, even after a click;
//   - once a window is key, its first responder is the window itself until something makes the web view it: a click
//     in the page does, and nothing else did, so a page that focused a field by itself still got no keys.
// So the window gets a title bar that is there but shows nothing (Electrobun's "hiddenInset": transparent, the page
// under it), with the system's three buttons hidden while the page draws its own (the look "hidden" had), and the web
// view is made first responder whenever the window becomes key or a page loads. Elsewhere nothing changes.
import type { Pointer } from "bun:ffi";
import { windowChrome, type TitleBarStyle } from "./shell";

/** The main window's title-bar style: on macOS one the window can be key with; elsewhere none, as before. */
export function mainWindowTitleBar(platform: string): TitleBarStyle {
	return windowChrome(platform).titleBarStyle;
}

/** What this needs of AppKit (appkit.ts on macOS). */
export interface AppKit {
	/** Makes the web view of an Electrobun view the first responder of its window; false when it has none. */
	focusWebview(window: Pointer, view: Pointer): boolean;
	/** Hides the window's close, minimize and zoom buttons; how many it hid. */
	hideWindowButtons(window: Pointer): number;
}

/** The parts of an Electrobun BrowserWindow this listens to. */
export interface KeyWindow {
	ptr: Pointer;
	/** "focus" is the window becoming key (windowDidBecomeKey). */
	on(name: string, handler: (event: unknown) => void): void;
	webview: { ptr: Pointer; on(name: string, handler: (event: unknown) => void): void };
}

/**
 * Keeps keys reaching a window's page. `appkit` is null off macOS, where there's nothing to do. With `nativeButtons`
 * off, the system's window buttons are hidden: the page draws its own.
 */
export function keepKeysReachingThePage(
	window: KeyWindow,
	appkit: AppKit | null,
	{ nativeButtons }: { nativeButtons: boolean },
): void {
	if (!appkit) return;
	const attempt = <Result>(what: string, run: () => Result): Result | null => {
		try {
			return run();
		} catch (err) {
			console.error(`[window] couldn't ${what}:`, err);
			return null;
		}
	};
	const hidden = nativeButtons
		? null
		: attempt("hide the window's buttons", () => appkit.hideWindowButtons(window.ptr));
	const focusPage = () =>
		attempt("give the page the keyboard", () => appkit.focusWebview(window.ptr, window.webview.ptr));
	// The window may be key already, before its first page: then, when a page loads, and each time it becomes key.
	const taken = focusPage();
	console.log(
		`[window] macOS: the web view ${taken ? "is" : "isn't"} asked to take the keyboard` +
			(hidden === null ? "" : `; ${hidden} of the system's window buttons hidden`),
	);
	window.webview.on("dom-ready", focusPage);
	window.on("focus", focusPage);
}
