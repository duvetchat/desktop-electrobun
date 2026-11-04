import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const search = readFileSync(join(import.meta.dir, "MessageSearch.svelte"), "utf8");

// The empty box is wider while it's focused (and unfolded from its icon in a narrow pane). A press on a button left of
// it in the bar takes its focus: had it shrunk then, the button would have moved from under the pointer before the
// press ended, and its click been lost, so the pins didn't open from a focused search (#80).
test("the search box keeps its focused width until a press elsewhere has ended and made its click", () => {
	expect(search).toContain('window.addEventListener("pointerdown", onPress, true)');
	expect(search).toContain("afterPress(window, () => (pressHeld = false))");
	// While held, as wide as focused, in a wide pane and in a narrow one.
	expect(search).toMatch(/pressHeld\s*\?\s*'w-64 @max-3xl\/pane:w-44'/);
	expect(search).toContain("focus-within:w-64");
	expect(search).toContain("@max-3xl/pane:focus-within:w-44");
});

// The pins open from the focused box before it shrinks back, which moves their button: the list follows it.
test("the pins list follows its button", () => {
	const pins = readFileSync(join(import.meta.dir, "PinnedMessages.svelte"), "utf8");
	expect(pins).toMatch(/<Popover\.Content[^>]*\supdatePositionStrategy="always"/);
});
