import { isElectrobunWindow } from "$lib/electrobun-rpc";

type Selected = Pick<Selection, "isCollapsed" | "containsNode">;

/**
 * Whether the webview's own right-click menu is worth showing for this click: on a text field, or on the selected
 * text itself, where it holds Cut, Copy and Paste. Anywhere else it holds only Chromium's page, link and image commands.
 */
export function keepsNativeMenu(target: EventTarget | null, selection: Selected | null): boolean {
	if (!(target instanceof Element)) return false;
	if (selection && !selection.isCollapsed && selection.containsNode(target, true)) return true;
	return target.closest("input, textarea, [contenteditable]:not([contenteditable=false])") !== null;
}

/**
 * On Linux, in the packaged app, stops the webview's own menu where it adds nothing. Choosing Chromium's Inspect item
 * there kills the whole app (SIGTRAP, Electrobun 1.15.1; reproduced on the sign-in page, not on an image
 * specifically); the wrapper's own Open DevTools item opens DevTools without it (F12 doesn't: setupDevToolsKeys). A menu the page draws itself
 * (lib/components/ui/ContextMenu.svelte) has already stopped the event by then.
 */
export function setupNativeContextMenu(): void {
	if (typeof window === "undefined" || !isElectrobunWindow()) return;
	window.addEventListener("contextmenu", (event) => {
		if (event.defaultPrevented) return;
		if (!keepsNativeMenu(event.target, window.getSelection())) event.preventDefault();
	});
}

type Key = Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

/** Chromium's own keys for DevTools: F12, and Ctrl+Shift+I, J and C. */
export function isDevToolsKey(e: Key): boolean {
	if (e.altKey || e.metaKey) return false;
	if (e.key === "F12") return !e.ctrlKey && !e.shiftKey;
	return e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(e.key.toUpperCase());
}

/**
 * On Linux, takes the DevTools keys from Chromium, whose own handling of them kills the app the way its Inspect menu
 * item does (SIGTRAP, Electrobun 1.15.1; reproduced with F12). `open` asks Bun for Electrobun's own DevTools, which work.
 */
export function setupDevToolsKeys(open: () => void): void {
	if (typeof window === "undefined" || !isElectrobunWindow()) return;
	window.addEventListener(
		"keydown",
		(event) => {
			if (!isDevToolsKey(event)) return;
			event.preventDefault();
			event.stopPropagation();
			open();
		},
		true,
	);
}
