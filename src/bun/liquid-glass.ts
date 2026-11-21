// Liquid Glass behind a window's webview on macOS (native/macos/liquid_glass.mm). A no-op everywhere else.
// The library is built by scripts/build-native.ts (electrobun.config.ts: scripts.preBuild) and bundled at
// Resources/app/native/libLiquidGlass.dylib (the config's copy rule). #374.
import { dlopen, FFIType, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { nativeLibraryPath, type AppPaths } from "./native-library";

export type GlassResult = "glass" | "vibrancy" | "failed" | "unavailable";
export interface GlassOptions {
	/** Corner radius of the glass, in points. 0 = square. */
	cornerRadius?: number;
	/** "regular" (default) or "clear". */
	style?: "regular" | "clear";
	/** sRGB tint, components 0–1; alpha 0 = no tint. */
	tint?: [r: number, g: number, b: number, a: number];
}
/** The glass's own appearance: the window's (which follows the system), light or dark. */
export type GlassAppearance = "system" | "light" | "dark";

const symbolsSpec = {
	lg_isSupported: { args: [], returns: FFIType.bool },
	lg_addWindowGlass: {
		args: [FFIType.ptr, FFIType.f64, FFIType.i32, FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64],
		returns: FFIType.i32,
	},
	lg_removeWindowGlass: { args: [FFIType.ptr], returns: FFIType.void },
	lg_setGlassAppearance: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.bool },
	lg_debugDump: { args: [FFIType.ptr], returns: FFIType.void },
	lg_enablePrivateCssGlass: { args: [FFIType.ptr], returns: FFIType.i32 },
} as const;

type Lib = ReturnType<typeof dlopen<typeof symbolsSpec>>["symbols"];
let lib: Lib | null | undefined;

/** Where the library is in the app: the copy rule puts it at Resources/app/native/. */
export function dylibPath(paths?: AppPaths): string {
	return nativeLibraryPath("libLiquidGlass.dylib", paths);
}

function load(): Lib | null {
	if (lib !== undefined) return lib;
	lib = null;
	if (process.platform !== "darwin") return lib;
	const path = dylibPath();
	if (!existsSync(path)) {
		console.warn("[liquid-glass] not bundled:", path);
		return lib;
	}
	try {
		lib = dlopen(path, symbolsSpec).symbols;
	} catch (err) {
		console.error("[liquid-glass] couldn't load:", err);
	}
	return lib;
}

/** Whether the library is there to put glass (or, before macOS 26, vibrancy) behind a window: macOS, with the dylib
 * bundled and loaded. Asked before a window is made, as its page is told in its preload whether glass is behind it. */
export function glassAvailable(): boolean {
	return load() !== null;
}

/** True on macOS 26+ with the dylib bundled: real Liquid Glass. */
export function glassSupported(): boolean {
	return load()?.lg_isSupported() ?? false;
}

/** Puts glass (or, before macOS 26, vibrancy) behind the window's webviews. The window must be created with
 * `transparent: true` and the page must paint nothing where the glass should show. Safe to call again. */
export function addWindowGlass(windowPtr: Pointer, options: GlassOptions = {}): GlassResult {
	const l = load();
	if (!l) return "unavailable";
	const [r, g, b, a] = options.tint ?? [0, 0, 0, 0];
	const code = l.lg_addWindowGlass(windowPtr, options.cornerRadius ?? 0, options.style === "clear" ? 1 : 0, r, g, b, a);
	return code === 2 ? "glass" : code === 1 ? "vibrancy" : "failed";
}

export function removeWindowGlass(windowPtr: Pointer): void {
	load()?.lg_removeWindowGlass(windowPtr);
}

/** Sets the appearance of the window's glass alone, not the window's: the window's would change the page's
 * prefers-color-scheme. False when the window has no glass, or the library isn't there. */
export function setGlassAppearance(windowPtr: Pointer, appearance: GlassAppearance): boolean {
	const code = appearance === "light" ? 1 : appearance === "dark" ? 2 : 0;
	return load()?.lg_setGlassAppearance(windowPtr, code) ?? false;
}

/** QA: NSLogs the window's state and subviews (glass must be subview[0]). */
export function debugWindowGlass(windowPtr: Pointer): void {
	load()?.lg_debugDump(windowPtr);
}

/** EXPERIMENTAL, private WebKit API (not App Store safe): enables `-apple-visual-effect` in the window's
 * webviews and reloads them. Returns how many webviews were switched; -2 if this WebKit lacks the switch. */
export function enablePrivateCssGlass(windowPtr: Pointer): number {
	return load()?.lg_enablePrivateCssGlass(windowPtr) ?? 0;
}
