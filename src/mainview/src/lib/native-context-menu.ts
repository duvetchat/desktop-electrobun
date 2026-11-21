import { isElectrobunWindow } from "$lib/electrobun-rpc";

// The webview's own DevTools keys, on Linux. Its own right-click menu shows only over text fields since #423, which
// gives every other right-click Duvet's menu (lib/default-menu.ts, DefaultContextMenu.svelte): there its Inspect item
// still kills the app (SIGTRAP, Electrobun 1.15.1; reproduced on the sign-in page), as the keys below would.

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
