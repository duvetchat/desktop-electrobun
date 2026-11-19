import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ApplicationMenuItemConfig } from "electrobun/bun";
import { roleLabelMap } from "../../node_modules/electrobun/dist/api/bun/core/menuRoles";
import { shortcutCommand } from "../mainview/src/lib/keyboard";
import { voiceKey } from "../mainview/src/lib/voice-keys";
import { appMenu, DOCS_URL, menuAction, runMenuAction } from "./app-menu";

// macOS's menu bar (#372): a WKWebView does ⌘C, ⌘V, ⌘Z and the other editing keys only through the menu's items, and
// the app had none, so they did nothing.

type Item = Exclude<ApplicationMenuItemConfig, { type: "divider" | "separator" }>;
const isItem = (entry: ApplicationMenuItemConfig): entry is Item =>
	entry.type !== "separator" && entry.type !== "divider";
const roleOf = (item: Item) => ("role" in item ? item.role : undefined);
const actionOf = (item: Item) => ("action" in item ? item.action : undefined);

const menu = appMenu("Duvet");
const menuNamed = (label: string): Item[] => {
	const found = menu.filter(isItem).find((entry) => entry.label === label);
	if (!found?.submenu) throw new Error(`no ${label} menu`);
	return found.submenu.filter(isItem);
};
/** Every item under the menu bar, at any depth. */
const everyItem = (entries: ApplicationMenuItemConfig[]): Item[] =>
	entries.filter(isItem).flatMap((item) => [item, ...everyItem(item.submenu ?? [])]);

describe("the menu bar", () => {
	test("has the app's menu, then Edit, View, Window and Help", () => {
		expect(menu.filter(isItem).map((entry) => entry.label)).toEqual(["Duvet", "Edit", "View", "Window", "Help"]);
	});

	// Each is a role: Electrobun gives it AppKit's selector (copy:, paste:, undo:…), which goes to the web view, and its
	// own key (⌘Z, ⇧⌘Z, ⌘X, ⌘C, ⌘V, ⌥⇧⌘V, ⌘A). One gone and its key does nothing again.
	test("Edit has every editing command, each by its role and with its own key", () => {
		const edit = menuNamed("Edit");
		expect(edit.map(roleOf)).toEqual(["undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll"]);
		for (const item of edit) {
			expect(item.accelerator).toBeUndefined();
			expect(actionOf(item)).toBeUndefined();
		}
	});

	test("the app's menu is About, Settings…, Hide, Hide Others, Show All and Quit, with macOS's keys", () => {
		expect(
			menuNamed("Duvet").map((item) => [item.label ?? roleLabelMap[roleOf(item) ?? ""], item.accelerator ?? null]),
		).toEqual([
			["About Duvet", null],
			["Settings…", "Command+,"],
			["Hide Duvet", "Command+H"],
			["Hide Others", "Option+Command+H"],
			["Show All", null],
			["Quit Duvet", "Command+Q"],
		]);
		expect(menuNamed("Duvet").map(roleOf)).toEqual(["about", undefined, "hide", "hideOthers", "showAll", "quit"]);
	});

	test("View enters full screen, Window minimizes, zooms and closes, and Help opens the documentation", () => {
		expect(menuNamed("View").map((item) => [roleOf(item), item.accelerator])).toEqual([
			["toggleFullScreen", "Control+Command+F"],
		]);
		expect(menuNamed("Window").map((item) => [roleOf(item), item.accelerator ?? null])).toEqual([
			["minimize", "Command+M"],
			["zoom", null],
			["close", "Shift+Command+W"],
			["bringAllToFront", null],
		]);
		expect(menuNamed("Help").map(actionOf)).toEqual(["docs"]);
		expect(DOCS_URL).toBe("https://docs.duvet.chat");
	});

	// A role Electrobun doesn't know leaves its item without a selector: it shows, and does nothing.
	test("every role is one Electrobun maps to AppKit's selector, and every other item has an action", () => {
		for (const item of everyItem(menu)) {
			const role = roleOf(item);
			if (role !== undefined) expect(Object.hasOwn(roleLabelMap, role)).toBe(true);
			else if (!item.submenu) expect(["settings", "docs"]).toContain(actionOf(item) ?? "");
		}
	});
});

// The page sees each key first and the menu only what it lets through (app-menu.ts): a key of the page's own on an item
// would do the item's thing whenever the page lets it through, over a dialog, while signing in.
describe("the menu's keys", () => {
	/** A key press as the page reads it, from an accelerator as Electrobun's parser reads it (accelerator_parser.h). */
	function pressOf(accelerator: string) {
		const parts = accelerator.split("+");
		const key = (parts.pop() ?? "").toLowerCase();
		const mods = new Set(parts.map((part) => part.toLowerCase()));
		return {
			key,
			metaKey: mods.has("command") || mods.has("cmd") || mods.has("commandorcontrol") || mods.has("cmdorctrl"),
			ctrlKey: mods.has("control") || mods.has("ctrl"),
			altKey: mods.has("option") || mods.has("alt"),
			shiftKey: mods.has("shift"),
		};
	}
	const presses = everyItem(menu).flatMap((item) => (item.accelerator ? [pressOf(item.accelerator)] : []));

	test("are the ones an item names, read as Electrobun reads them", () => {
		expect(pressOf("Shift+Command+W")).toEqual({
			key: "w",
			metaKey: true,
			ctrlKey: false,
			altKey: false,
			shiftKey: true,
		});
		expect(presses).toHaveLength(7);
	});

	test("are none of the page's shortcuts: ⌘1–9, ⌘/, the chats', mute and deafen", () => {
		for (const press of presses) {
			expect(shortcutCommand(press, true)).toBeNull();
			expect(voiceKey(press, true)).toBeNull();
		}
	});

	// The shell's own (lib/shell-layout.ts: shellShortcut) and the switcher's (routes/app/+page.svelte). ⌘, is Settings
	// there and here alike, and ⌘Z and ⇧⌘Z the message box's own undo and redo, which take them first.
	test("are none of the shell's: ⌘W closes a tab, so the window closes with ⇧⌘W", () => {
		const shell = ["Command+W", "Command+T", "Command+K", "Control+Command+S", "Control+Tab", "Control+Shift+Tab"];
		const taken = (press: ReturnType<typeof pressOf>) => JSON.stringify(press);
		const ours = new Set(presses.map(taken));
		for (const accelerator of shell) expect(ours.has(taken(pressOf(accelerator)))).toBe(false);
	});
});

describe("a click on an item of the app's own", () => {
	test("is its action, as Electrobun reports it", () => {
		expect(menuAction({ data: { id: 0, action: "settings" } })).toBe("settings");
		expect(menuAction({ data: { action: "docs", data: undefined } })).toBe("docs");
	});

	test("is nothing for anything else", () => {
		for (const event of [undefined, null, "settings", {}, { data: null }, { data: {} }, { data: { action: "quit" } }]) {
			expect(menuAction(event)).toBeNull();
		}
	});

	test("runs its action, and only it", () => {
		const ran: string[] = [];
		const actions = { settings: () => void ran.push("settings"), docs: () => void ran.push("docs") };
		runMenuAction({ data: { action: "docs" } }, actions);
		runMenuAction({ data: { action: "settings" } }, actions);
		runMenuAction({ data: { action: "about" } }, actions);
		expect(ran).toEqual(["docs", "settings"]);
	});
});

describe("the app", () => {
	const main = readFileSync(join(import.meta.dir, "index.ts"), "utf8");

	test("sets the menu bar on macOS only", () => {
		expect(main).toMatch(
			/if \(currentOS === "darwin"\) \{\s*ApplicationMenu\.setApplicationMenu\(appMenu\("Duvet"\)\);/,
		);
		expect(main.match(/setApplicationMenu\(/g)).toHaveLength(1);
	});

	// Electrobun 1.15.1 reads the menu on macOS's main thread later, from memory nothing keeps (2.0 copies it first):
	// making the window waits on that thread, behind the menu.
	test("sets it before it makes the main window", () => {
		expect(main.indexOf("setApplicationMenu(")).toBeGreaterThan(-1);
		expect(main.indexOf("setApplicationMenu(")).toBeLessThan(main.indexOf("new BrowserWindow("));
	});

	test("does what Settings… and Help ask", () => {
		expect(main).toContain('Electrobun.events.on("application-menu-clicked"');
		expect(main).toMatch(
			/runMenuAction\(event, \{\s*settings: openSettingsFromMenu,\s*docs: \(\) => openExternalUrl\(DOCS_URL\),/,
		);
		expect(main).toMatch(
			/function openSettingsFromMenu\(\) \{\s*focusMain\(\);\s*void rpc\.request\s*\.windowCommand\(SETTINGS_MENU_COMMAND\)/,
		);
	});
});
