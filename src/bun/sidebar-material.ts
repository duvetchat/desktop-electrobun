// The sidebar's glass on macOS (#374, docs/redesign/DESIGN-MAP.md §8.14). The design's sidebar is vibrant there: the
// desktop shows through it, blurred, under the sidebar's tint. A page can only blur what it draws itself, so the blur
// is the system's: its sidebar material goes behind the main window's web view (appkit.ts: addSidebarMaterial), and
// the page, told so in its shell (shell.ts: vibrancy), paints nothing behind its sidebar but the tint
// (--duvet-sb-bg-vibrant in app.css). The window itself stays opaque.
//
// The material follows the system's appearance by itself, and the page's theme can be picked apart from it
// (lib/theme.ts): the page says which theme it wears (the windowTheme message, lib/vibrancy.ts), and the material
// wears the same.
import type { Pointer } from "bun:ffi";

/** What this needs of AppKit (appkit.ts on macOS). A view is an Objective-C object, 0n for none. */
export interface MaterialKit {
	/** Puts the sidebar's material behind everything in a window; the view, or 0n when the window took none. */
	addSidebarMaterial(window: Pointer): bigint;
	/** Gives a view the light or the dark appearance. */
	setViewTheme(view: bigint, theme: "light" | "dark"): void;
}

export type WindowTheme = "light" | "dark";

/** The theme a page's message names; null for anything else, as a page can send anything. */
export function parseWindowTheme(message: unknown): WindowTheme | null {
	if (typeof message !== "object" || message === null || !("theme" in message)) return null;
	return message.theme === "light" || message.theme === "dark" ? message.theme : null;
}

/** Whether a window on this system, with this bridge, gets the material: macOS only, and only with AppKit's bridge
 * loaded. Asked before the window is made, as its page is told in its preload. */
export function hasSidebarMaterial(platform: string, appkit: MaterialKit | null): boolean {
	return platform === "darwin" && appkit !== null;
}

/** A window's sidebar material. Without one (another system, no bridge, or a window that took none) it does nothing. */
export class SidebarMaterial {
	private view = 0n;
	private theme: WindowTheme | null = null;

	constructor(
		private readonly appkit: MaterialKit | null,
		private readonly log: (line: string, err?: unknown) => void = (line, err) =>
			err === undefined ? console.log(line) : console.error(line, err),
	) {}

	/** Puts the material behind the window's page; whether it is there. A failure is logged, and the app goes on: the
	 * page's sidebar then has the window's own background under its tint. */
	add(window: Pointer): boolean {
		if (!this.appkit || this.view) return this.view !== 0n;
		try {
			this.view = this.appkit.addSidebarMaterial(window);
		} catch (err) {
			this.log("[window] couldn't put the sidebar's material behind the page:", err);
			return false;
		}
		this.log(`[window] macOS: the sidebar's material ${this.view ? "is" : "isn't"} behind the page`);
		// A theme the page named before the material was there.
		if (this.view && this.theme) this.wear(this.theme);
		return this.view !== 0n;
	}

	/** The page's theme, as it says it (parseWindowTheme): the material takes the same. */
	themed(message: unknown): void {
		const theme = parseWindowTheme(message);
		if (!theme || theme === this.theme) return;
		this.theme = theme;
		if (this.view) this.wear(theme);
	}

	private wear(theme: WindowTheme) {
		try {
			this.appkit?.setViewTheme(this.view, theme);
		} catch (err) {
			this.log("[window] couldn't give the sidebar's material the page's theme:", err);
		}
	}
}
