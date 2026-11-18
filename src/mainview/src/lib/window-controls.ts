import { getElectrobunRpc, type AppRPCClient } from "$lib/electrobun-rpc";

// The window's own controls and its drag regions (#357, docs/redesign/DESIGN-MAP.md S-01). The page draws minimize,
// maximize and close itself on Windows and Linux (WindowControls.svelte), in whichever title line is on screen: the
// app's tab strip, or the slim bar of the pages outside it (Header.svelte). They mount and unmount with those lines,
// so each control calls these rather than being found by an id once at start.

/** Whether a press on the title bar drags the window: the primary button's, off the window's buttons. */
export function pressDrags(button: number, target: { closest(selector: string): unknown } | null): boolean {
	return button === 0 && target !== null && !target.closest(".titlebar-actions");
}

let bridge: Promise<AppRPCClient | null> | undefined;

/** The bridge to the Bun process, or null in a browser, or if it can't be set up. */
function windowBridge(): Promise<AppRPCClient | null> {
	return (bridge ??= getElectrobunRpc().catch(() => null));
}

/** Closes the window; through the page when there's no bridge. */
export async function closeWindow(): Promise<void> {
	const rpc = await windowBridge();
	if (rpc) rpc.send.closeWindow();
	else window.close();
}

/** Minimizes the window; nothing without the bridge. */
export async function minimizeWindow(): Promise<void> {
	(await windowBridge())?.send.minimizeWindow();
}

/**
 * Maximizes the window, or restores it. The Bun process finds the display from the window's own frame: this page's
 * window.screen can still be the monitor the window was dragged from (#187). Without the bridge, full screen instead.
 */
export async function maximizeWindow(): Promise<void> {
	const rpc = await windowBridge();
	if (rpc) {
		rpc.send.maximizeWindow();
		return;
	}
	if (!document.fullscreenElement) await document.documentElement.requestFullscreen().catch(() => undefined);
	else await document.exitFullscreen().catch(() => undefined);
}

let nativeDrag: Promise<boolean> | undefined;

/**
 * Whether Windows' move loop drags the window (on Windows, once src/bun/window-snap.ts is in): a drag region then
 * reports its presses (startWindowDrag), so a maximized window restores as it's dragged and the display's edges snap
 * it. Elsewhere, and if Bun can't say, Electrobun drags it, by the region's class.
 */
export function usesNativeWindowDrag(): Promise<boolean> {
	return (nativeDrag ??= windowBridge().then((rpc) => rpc?.request.nativeWindowDrag().catch(() => false) ?? false));
}

/** A press on a drag region where Windows' move loop drags the window: Bun follows it until it turns into a drag. */
export async function startWindowDrag(): Promise<void> {
	(await windowBridge())?.send.startWindowDrag();
}
