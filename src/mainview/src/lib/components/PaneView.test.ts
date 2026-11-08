import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// #201: Close pane took the pane out of the tree, and its click went on to the pane's own, which focuses the pane by
// node.id: node was gone by then, and the handler threw. What a browser checked against a running app, kept here.
test("Close pane's click stops at the button, before the pane it closed would take it", () => {
	const pane = source("PaneView.svelte");
	expect(pane).toMatch(
		/aria-label="Close pane"\s*onclick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*onClose\?\.\(\);\s*\}\}/,
	);
	// The pane's own click, which the button's no longer reaches.
	expect(pane).toContain("onclick={() => onFocus(node.id)}");
});
