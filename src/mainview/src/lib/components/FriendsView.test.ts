import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const friendsView = readFileSync(join(import.meta.dir, "FriendsView.svelte"), "utf8");

const sheet = readFileSync(join(import.meta.dir, "ui/Sheet.svelte"), "utf8");

// #206: New group, under Direct messages, sets showGroupModal, whose dialog was FriendsView's own markup: hidden with the
// friends list while a chat shows, it opened where nobody saw it. What a browser checked against a running app, kept
// here. Since #357 the dialog is the sheet primitive, which draws in a portal of its own.
test("the new group dialog goes to the page's body, so it shows over a chat too", () => {
	expect(friendsView).toMatch(/<Sheet\s*bind:open=\{\s*\(\) => showGroupModal,/);
	expect(sheet).toMatch(/<Dialog\.Portal>[\s\S]*?<Dialog\.Content[\s\S]*?<\/Dialog\.Portal>/);
});

// Chat leaves the keys pressed in a dialog alone, and takes the others for its message box. The sheet is bits-ui's
// dialog, which moves the focus into itself as it opens, holds it there, and gives it back as it closes.
test("it takes the focus as it opens, so a key typed then doesn't go into a chat behind it", () => {
	expect(sheet).toContain('import { Dialog } from "bits-ui";');
	expect(sheet).not.toContain("trapFocus={false}");
	expect(friendsView).not.toMatch(/role="dialog"/);
});

// A friend's Remove friend was a bare icon, shown only on hover; it takes a card of its own beside Message's.
test("a friend's Remove friend has the same card as Message", () => {
	expect(friendsView).toMatch(/class=\{cardIconButtonClass\(\)\}[\s\S]*?aria-label="Message \{member\.username\}"/);
	expect(friendsView).toMatch(
		/class=\{cardIconButtonClass\(true\)\}[\s\S]*?aria-label="Remove \{member\.username\} from your friends"/,
	);
});
