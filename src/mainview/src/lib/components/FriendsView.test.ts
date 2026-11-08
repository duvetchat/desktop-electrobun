import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const friendsView = readFileSync(join(import.meta.dir, "FriendsView.svelte"), "utf8");

// #206: New group, under Direct messages, sets showGroupModal, whose dialog was FriendsView's own markup: hidden with the
// friends list while a chat shows, it opened where nobody saw it. What a browser checked against a running app, kept here.
test("the new group dialog goes to the page's body, so it shows over a chat too", () => {
	expect(friendsView).toContain('import { Portal } from "bits-ui";');
	expect(friendsView).toMatch(/\{#if showGroupModal\}\s*<Portal>[\s\S]*?role="dialog"[\s\S]*?<\/Portal>\s*\{\/if\}/);
});

// Chat leaves the keys pressed in a dialog alone, and takes the others for its message box.
test("it takes the focus as it opens, so a key typed then doesn't go into a chat behind it", () => {
	expect(friendsView).toMatch(/role="dialog"\s*aria-labelledby="group-title"\s*tabindex="-1"\s*use:takeFocus/);
	expect(friendsView).toMatch(/function takeFocus\(node: HTMLElement\) \{\s*node\.focus\(\);\s*\}/);
});
