import { afterEach, expect, it } from "bun:test";
import { keepsNativeMenu } from "./native-context-menu";

class FakeElement {
	constructor(private editable: boolean) {}
	closest() {
		return this.editable ? this : null;
	}
}

afterEach(() => Reflect.deleteProperty(globalThis, "Element"));

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
