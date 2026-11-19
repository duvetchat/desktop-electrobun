import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");
const button = source("MembersButton.svelte");

// #366: the members popover can be kept open in every chat of a kind (lib/layout-prefs.ts, followPin in lib/members.ts).
// Its panel is drawn in a portal, which a render on the server leaves out, and its focus and keys are a webview's: what
// it does kept open, as its source has it.
test("kept open, it's a panel beside the chat: no dialog, no focus taken or trapped, and clicks and Esc elsewhere leave it", () => {
	// Not a dialog: the keyboard layer and the chat take no keys while a dialog is open.
	expect(button).toContain('role={kept ? "complementary" : "dialog"}');
	expect(button).toContain("trapFocus={!kept}");
	expect(button).toContain('interactOutsideBehavior={kept ? "defer-otherwise-ignore" : "close"}');
	expect(button).toContain('escapeKeydownBehavior={kept ? "defer-otherwise-close" : "close"}');
	// Esc closes it only from inside it, and it takes no focus as the pin opens it.
	expect(button).toMatch(
		/function onEscapeKeydown\(e: KeyboardEvent\) \{\s*if \(kept && !panel\?\.contains\(document\.activeElement\)\) e\.preventDefault\(\);/,
	);
	expect(button).toMatch(/function onOpenAutoFocus\(e: Event\) \{\s*e\.preventDefault\(\);\s*if \(kept \|\|/);
	// Closed for its chat or by the pin, the focus stays where it is.
	expect(button).toMatch(
		/function onCloseAutoFocus\(e: Event\) \{\s*if \(open \|\| closedForChat\) e\.preventDefault\(\);/,
	);
});

test("the pin of its kind of chat opens and closes it with its chat, and closing it unpins it", () => {
	expect(button).toContain("const kept = $derived(kind !== undefined && layoutPrefs.membersKeptOpen[kind]);");
	expect(button).toMatch(
		/const keep = kept;\s*const visible = shown;\s*untrack\(\(\) => \{\s*const next = followPin\(/,
	);
	expect(button).toMatch(/function onOpenChange\(next: boolean\) \{[^}]*if \(!next && kept\) setKept\(false\);/);
	// The pin, in the header: a button with its name and a tooltip, only in a chat of a kind that can be kept open.
	expect(button).toMatch(
		/\{#if kind\}\s*<Tooltip\b[^]*?<IconButton\b[^]*?label="Keep open"\s+aria-pressed=\{kept\}[^]*?<\/Tooltip>\s*\{\/if\}/,
	);
});

test("a Space's text rooms and groups can keep it open while their chat shows; a voice room and a DM can't", () => {
	expect(source("PaneView.svelte")).toMatch(
		/<MembersButton\s+space=\{activeTabSpace\}\s+channelId=\{activeTab\.channelId\}\s+kind=\{activeChannel\?\.type === "text" \? "rooms" : undefined\}\s+shown=\{isActive\}\s*\/>/,
	);
	expect(source("ConversationView.svelte")).toMatch(
		/<MembersButton\s[^>]*kind=\{conversation\.type === 2 \? "groups" : undefined\}/,
	);
});
