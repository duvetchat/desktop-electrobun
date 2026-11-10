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

// #243: a room's older page that failed, or hadn't come in its 10 s, set the room's channelHasMore to false: the list
// showed the room's start above the loaded messages, as if the room began there, and asked for no older page again.
// What a browser checked against a running app, kept here.
test("a room's older page that fails is asked for again after a wait, never taken for the room's start", () => {
	const pane = source("PaneView.svelte");
	const loadMore = pane.slice(pane.indexOf("async function loadMoreMessages()"), pane.indexOf("function startJump("));
	expect(loadMore).toContain("if (Date.now() - (aboveFailedAt.get(channelId) ?? 0) < RETRY_WAIT) {");
	const failed = loadMore.slice(loadMore.indexOf("} catch (err) {"), loadMore.indexOf("} finally {"));
	expect(failed).toContain("aboveFailedAt.set(channelId, Date.now());");
	expect(failed).not.toContain("channelHasMore[channelId]");
	expect(pane).toContain("const RETRY_WAIT = 2_000;");
});
