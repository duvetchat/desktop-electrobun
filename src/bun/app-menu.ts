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
//   - Every item is in the app's language (#464, i18n.ts), a role's too: without a label of its own, Electrobun gives a
//     role item its English name (menuRoles.ts: roleLabelMap). The menu is made again when the language changes.
import type { ApplicationMenuItemConfig } from "electrobun/bun";
import { t } from "./i18n";

/** Where Help sends the user: Duvet's documentation, in the browser. */
export const DOCS_URL = "https://docs.duvet.chat";

/** What an item that isn't one of AppKit's own asks of the app. */
export type MenuAction = "settings" | "docs";

const ACTIONS: readonly MenuAction[] = ["settings", "docs"];

/** The menu bar of the app called `name`, in the language Bun speaks now. Keys are Electrobun's accelerators; an
 * editing role without one has its own. */
export function appMenu(name: string): ApplicationMenuItemConfig[] {
	return [
		{
			// macOS titles the first menu with the app's own name, whatever its label says.
			label: name,
			submenu: [
				{ role: "about", label: t("menu_about", { name }) },
				{ type: "separator" },
				{ label: t("menu_settings"), action: "settings", accelerator: "Command+," },
				{ type: "separator" },
				{ role: "hide", label: t("menu_hide", { name }), accelerator: "Command+H" },
				{ role: "hideOthers", label: t("menu_hide_others"), accelerator: "Option+Command+H" },
				{ role: "showAll", label: t("menu_show_all") },
				{ type: "separator" },
				{ role: "quit", label: t("menu_quit", { name }), accelerator: "Command+Q" },
			],
		},
		{
			label: t("menu_edit"),
			submenu: [
				{ role: "undo", label: t("menu_undo") },
				{ role: "redo", label: t("menu_redo") },
				{ type: "separator" },
				{ role: "cut", label: t("menu_cut") },
				{ role: "copy", label: t("menu_copy") },
				{ role: "paste", label: t("menu_paste") },
				{ role: "pasteAndMatchStyle", label: t("menu_paste_and_match_style") },
				{ role: "selectAll", label: t("menu_select_all") },
			],
		},
		{
			label: t("menu_view"),
			submenu: [{ role: "toggleFullScreen", label: t("menu_toggle_full_screen"), accelerator: "Control+Command+F" }],
		},
		{
			label: t("menu_window"),
			submenu: [
				{ role: "minimize", label: t("menu_minimize"), accelerator: "Command+M" },
				{ role: "zoom", label: t("menu_zoom") },
				{ type: "separator" },
				{ role: "close", label: t("menu_close_window"), accelerator: "Shift+Command+W" },
				{ type: "separator" },
				{ role: "bringAllToFront", label: t("menu_bring_all_to_front") },
			],
		},
		{
			label: t("menu_help"),
			submenu: [{ label: t("menu_docs", { name }), action: "docs" }],
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
