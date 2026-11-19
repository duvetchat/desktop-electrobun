// The menu bar on macOS (#372). A WKWebView does ⌘C, ⌘V, ⌘X, ⌘Z, ⇧⌘Z and ⌘A only through the menu bar's items, and
// the app had none: those keys did nothing, nor ⌘Q, ⌘H and ⌘M.
//   - The page sees each key first. The web view, the window's first responder (window-keys.ts), takes every key with
//     ⌘ to the page, and one the page lets through, without preventDefault, goes back to AppKit, which tries the menu's
//     items (WebKit's WebViewImpl::performKeyEquivalent, then doneWithKeyEvent). So the app's own shortcuts (⌘1–9 and
//     ⌘/ of lib/keyboard.ts, the shell's ⌘T, ⌘W, ⌘K and ⌃⌘S, Settings' ⌘,) still reach it, menu or not.
//   - An item with a role sends AppKit's selector for it (copy:, paste:, undo:…) to the first responder, the web view,
//     and an editing role brings its own key (Electrobun's createMenuFromConfig). Settings… and Help come back to Bun,
//     as a click Electrobun reports.
//   - No item takes a key the page uses for something else: the menu acts on it whenever the page lets it through, over
//     a dialog or while signing in. ⌘W closes a tab, so Close Window is ⇧⌘W, as in macOS's tabbed apps: on ⌘W, the ⌘W
//     of someone in Settings would close the main window, and the app with it.
import type { ApplicationMenuItemConfig } from "electrobun/bun";

/** Where Help sends the user: Duvet's documentation, in the browser. */
export const DOCS_URL = "https://docs.duvet.chat";

/** What an item that isn't one of AppKit's own asks of the app. */
export type MenuAction = "settings" | "docs";

const ACTIONS: readonly MenuAction[] = ["settings", "docs"];

/** The menu bar of the app called `name`. Keys are Electrobun's accelerators; an editing role without one has its own. */
export function appMenu(name: string): ApplicationMenuItemConfig[] {
	return [
		{
			// macOS titles the first menu with the app's own name, whatever its label says.
			label: name,
			submenu: [
				{ role: "about", label: `About ${name}` },
				{ type: "separator" },
				{ label: "Settings…", action: "settings", accelerator: "Command+," },
				{ type: "separator" },
				{ role: "hide", label: `Hide ${name}`, accelerator: "Command+H" },
				{ role: "hideOthers", accelerator: "Option+Command+H" },
				{ role: "showAll" },
				{ type: "separator" },
				{ role: "quit", label: `Quit ${name}`, accelerator: "Command+Q" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "pasteAndMatchStyle" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [{ role: "toggleFullScreen", accelerator: "Control+Command+F" }],
		},
		{
			label: "Window",
			submenu: [
				{ role: "minimize", accelerator: "Command+M" },
				{ role: "zoom" },
				{ type: "separator" },
				{ role: "close", label: "Close Window", accelerator: "Shift+Command+W" },
				{ type: "separator" },
				{ role: "bringAllToFront", label: "Bring All to Front" },
			],
		},
		{
			label: "Help",
			submenu: [{ label: `${name} Documentation`, action: "docs" }],
		},
	];
}

/** The action of a click Electrobun reports (application-menu-clicked), or null for anything else. */
export function menuAction(event: unknown): MenuAction | null {
	if (typeof event !== "object" || event === null || !("data" in event)) return null;
	const { data } = event;
	if (typeof data !== "object" || data === null || !("action" in data)) return null;
	return ACTIONS.find((action) => action === data.action) ?? null;
}

/** Does what a click on an item of the app's own asks, if it is one. */
export function runMenuAction(event: unknown, actions: Record<MenuAction, () => void>): void {
	const action = menuAction(event);
	if (action) actions[action]();
}
