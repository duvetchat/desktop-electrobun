import { describe, expect, test } from "bun:test";
import { copyCode } from "$lib/code-copy";

// Bun has no DOM: the element a click lands on, as copyCode reads it, a copy button's or anything else's.
class FakeElement extends EventTarget {
	dataset = { code: "const a = 1;" };
	classes = new Set<string>();
	classList = {
		add: (name: string) => this.classes.add(name),
		remove: (name: string) => this.classes.delete(name),
	};
	innerHTML = "";
	constructor(private inCopyButton: boolean) {
		super();
	}
	closest(selector: string) {
		return this.inCopyButton && selector === ".msg-code-copy" ? this : null;
	}
}
Object.assign(globalThis, { Element: FakeElement });

const copied: string[] = [];
Object.defineProperty(navigator, "clipboard", {
	value: { writeText: async (text: string) => void copied.push(text) },
});

describe("copyCode", () => {
	test("copies a code block's code when its button is clicked, and marks the button", async () => {
		const button = new FakeElement(true);
		copyCode({ target: button });
		await Bun.sleep(0);
		expect(copied).toEqual(["const a = 1;"]);
		expect(button.classes.has("copied")).toBe(true);
	});

	test("leaves any other click alone", async () => {
		copied.length = 0;
		const other = new FakeElement(false);
		copyCode({ target: other });
		await Bun.sleep(0);
		expect(copied).toEqual([]);
		expect(other.classes.size).toBe(0);
	});
});

test("the message list hears the same copy buttons through it", async () => {
	const list = await Bun.file(new URL("components/MessageList.svelte", import.meta.url)).text();
	expect(list).toContain('scrollEl?.addEventListener("click", copyCode);');
});
