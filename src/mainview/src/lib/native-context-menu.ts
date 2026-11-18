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
 * specifically); the wrapper's own Open DevTools item and F12 open DevTools without it. A menu the page draws itself
 * (lib/components/ui/ContextMenu.svelte) has already stopped the event by then.
 */
export function setupNativeContextMenu(): void {
	if (typeof window === "undefined" || !isElectrobunWindow()) return;
	window.addEventListener("contextmenu", (event) => {
		if (event.defaultPrevented) return;
		if (!keepsNativeMenu(event.target, window.getSelection())) event.preventDefault();
	});
}
