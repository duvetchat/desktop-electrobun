import { afterEach, expect, it } from "bun:test";
import { isDevToolsKey, keepsNativeMenu } from "./native-context-menu";

class FakeElement {
	constructor(private editable: boolean) {}
	closest() {
		return this.editable ? this : null;
	}
}

afterEach(() => Reflect.deleteProperty(globalThis, "Element"));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test has no DOM: a stand-in takes an Element's place.
const el = (editable: boolean) => new FakeElement(editable) as unknown as Element;
const selecting = (inside: Element) => ({ isCollapsed: false, containsNode: (node: Node) => node === inside });

it("shows the webview's menu over text fields and on the selected text, and nowhere else", () => {
	Object.defineProperty(globalThis, "Element", { value: FakeElement, configurable: true });
	const word = el(false);
	expect(keepsNativeMenu(el(true), null)).toBe(true);
	expect(keepsNativeMenu(word, selecting(word))).toBe(true);
	expect(keepsNativeMenu(el(false), selecting(word))).toBe(false);
	expect(keepsNativeMenu(word, { isCollapsed: true, containsNode: () => true })).toBe(false);
	expect(keepsNativeMenu(null, null)).toBe(false);
});

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
