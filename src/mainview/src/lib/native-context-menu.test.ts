import { expect, it } from "bun:test";
import { isDevToolsKey } from "./native-context-menu";

it("takes F12 and Ctrl+Shift+I, J and C for DevTools, and no other key", () => {
	const key = (k: string, mods: Partial<Parameters<typeof isDevToolsKey>[0]> = {}) =>
		isDevToolsKey({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
	expect(key("F12")).toBe(true);
	expect(key("I", { ctrlKey: true, shiftKey: true })).toBe(true);
	expect(key("j", { ctrlKey: true, shiftKey: true })).toBe(true);
	expect(key("F12", { shiftKey: true })).toBe(false);
	expect(key("I", { ctrlKey: true })).toBe(false);
	expect(key("F11")).toBe(false);
});
