// A window's own buttons on macOS, its traffic lights, put in the page's title line (native/macos/window_buttons.mm,
// #406). A no-op everywhere else. The library is built by scripts/build-native.ts (electrobun.config.ts:
// scripts.preBuild) and bundled at Resources/app/native/libWindowButtons.dylib (the config's copy rule).
//
// Electrobun 1.15.1 leaves the lights where the system puts them, in the corner of its own title bar, 28 pt tall.
// Electrobun 2.0.6 has a call of its own for this (BrowserWindow's setWindowButtonPosition), which does the same.
import { dlopen, FFIType, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { nativeLibraryPath, type AppPaths } from "./native-library";

/** A title line as a page draws it at the window's top: its height, and where the first light's button starts, both in
 * points (a page's px). */
export interface TitleLine {
	height: number;
	lightsLeft: number;
}

/**
 * The title line of the main window and of the Settings windows on macOS (TitleStrip.svelte and SpaceNav.svelte's
 * header; SettingsFrame.svelte's side panel): 52 px tall, the lights centred in it and starting 18 px in
 * (docs/redesign/DESIGN-MAP.md, S-01). A light is a 12 pt circle in a button 14 pt wide, so the first button starts
 * at 17. The three end at 70, inside the corner the page keeps free for them (lib/shell-layout.ts:
 * TRAFFIC_LIGHTS_INSET, 76).
 */
export const TITLE_LINE: TitleLine = { height: 52, lightsLeft: 17 };

const symbolsSpec = {
	wb_placeWindowButtons: { args: [FFIType.ptr, FFIType.f64, FFIType.f64], returns: FFIType.bool },
} as const;

type Lib = ReturnType<typeof dlopen<typeof symbolsSpec>>["symbols"];
let lib: Lib | null | undefined;

/** Where the library is in the app: the copy rule puts it at Resources/app/native/. */
export function dylibPath(paths?: AppPaths): string {
	return nativeLibraryPath("libWindowButtons.dylib", paths);
}

function load(): Lib | null {
	if (lib !== undefined) return lib;
	lib = null;
	if (process.platform !== "darwin") return lib;
	const path = dylibPath();
	if (!existsSync(path)) {
		console.warn("[window-buttons] not bundled:", path);
		return lib;
	}
	try {
		lib = dlopen(path, symbolsSpec).symbols;
	} catch (err) {
		console.error("[window-buttons] couldn't load:", err);
	}
	return lib;
}

/**
 * Puts a window's traffic lights in its page's title line, centred in its height, and keeps them there as the window
 * is resized and leaves full screen. Safe to call again. False when nothing was placed: off macOS, without the
 * library, or for a window without the three buttons; the lights then stay where the system has them.
 */
export function placeWindowButtons(window: Pointer, line: TitleLine = TITLE_LINE): boolean {
	return load()?.wb_placeWindowButtons(window, line.lightsLeft, line.height) ?? false;
}
