import { describe, expect, test } from "bun:test";
import { closesSettingsWindow, pressIn, type WindowPress } from "$lib/settings-keys";

const press = (over: Partial<WindowPress>): WindowPress => ({
	key: "Escape",
	meta: false,
	ctrl: false,
	alt: false,
	shift: false,
	typing: false,
	overlay: false,
	...over,
});

describe("the keys that close a Settings window", () => {
	test("Esc closes it", () => {
		expect(closesSettingsWindow(press({}), true)).toBe(true);
		expect(closesSettingsWindow(press({}), false)).toBe(true);
	});

	test("Esc doesn't while something is typed in, or a dialog or a menu is open: it is theirs", () => {
		expect(closesSettingsWindow(press({ typing: true }), true)).toBe(false);
		expect(closesSettingsWindow(press({ overlay: true }), true)).toBe(false);
	});

	test("⌘W closes it on macOS, Ctrl W on Windows and Linux, typing or not", () => {
		expect(closesSettingsWindow(press({ key: "w", meta: true, typing: true }), true)).toBe(true);
		expect(closesSettingsWindow(press({ key: "W", ctrl: true, overlay: true }), false)).toBe(true);
		expect(closesSettingsWindow(press({ key: "w", ctrl: true }), true)).toBe(false);
		expect(closesSettingsWindow(press({ key: "w", meta: true }), false)).toBe(false);
	});

	test("nothing else does", () => {
		expect(closesSettingsWindow(press({ key: "w" }), true)).toBe(false);
		expect(closesSettingsWindow(press({ key: "w", meta: true, shift: true }), true)).toBe(false);
		expect(closesSettingsWindow(press({ key: "Escape", alt: true }), true)).toBe(false);
		expect(closesSettingsWindow(press({ key: "q", meta: true }), true)).toBe(false);
	});
});

describe("a press, read against the page", () => {
	const event = { key: "Escape", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
	type Page = Parameters<typeof pressIn>[1];

	test("is typing when the focus is in a field", () => {
		let asked = "";
		const focused = {
			matches: (selector: string) => {
				asked = selector;
				return true;
			},
		};
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the two members pressIn reads
		const page = { activeElement: focused, querySelector: () => null } as unknown as Page;
		const read = pressIn(event, page);
		expect(read.typing).toBe(true);
		expect(read.overlay).toBe(false);
		for (const typed of ["input", "textarea", "select", "contenteditable"]) expect(asked).toContain(typed);
	});

	test("has an overlay when a dialog, an alert or a menu is in the page", () => {
		let asked = "";
		const find = (selector: string) => {
			asked = selector;
			return {};
		};
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the two members pressIn reads
		const page = { activeElement: null, querySelector: find } as unknown as Page;
		const read = pressIn(event, page);
		expect(read.overlay).toBe(true);
		expect(read.typing).toBe(false);
		for (const role of ["dialog", "alertdialog", "menu"]) expect(asked).toContain(`[role='${role}']`);
	});
});
