import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MESSAGE_TEXT, MESSAGE_TEXT_OWN, MESSAGE_TEXT_PLAIN, messageTextClass } from "./message-styles";

const markdown = readFileSync(join(import.meta.dir, "markdown.ts"), "utf8");
const emoji = readFileSync(join(import.meta.dir, "emoji.ts"), "utf8");
const targets = (classes: string) => new Set([...classes.matchAll(/\.((?:msg|emoji)-[a-z-]+)/g)].map((m) => m[1]!));

// The classes restyle what markdown.ts writes, by its class names: one it no longer writes would style nothing.
test("every class they target is one a message's HTML has", () => {
	const all = targets(`${MESSAGE_TEXT} ${MESSAGE_TEXT_PLAIN} ${MESSAGE_TEXT_OWN}`);
	expect(all.size).toBeGreaterThan(8);
	for (const name of all) expect(`${markdown}\n${emoji}`, name).toContain(name);
});

// Two classes that set one thing on one target would leave the winner to the stylesheet's order: the fills are in the
// two tones, never in what both share.
test("the shared classes set no fill a tone sets", () => {
	const fills = (classes: string) =>
		classes.split(/\s+/).filter((c) => /\]:bg-/.test(c) && !c.includes("bg-transparent"));
	expect(fills(MESSAGE_TEXT)).toEqual([]);
	expect(fills(MESSAGE_TEXT_PLAIN).length).toBeGreaterThan(0);
	expect(fills(MESSAGE_TEXT_OWN).length).toBeGreaterThan(0);
});

test("a tone is the shared classes with its own, never both tones", () => {
	expect(messageTextClass()).toBe(`${MESSAGE_TEXT} ${MESSAGE_TEXT_PLAIN}`);
	expect(messageTextClass(true)).toBe(`${MESSAGE_TEXT} ${MESSAGE_TEXT_OWN}`);
});

test("a closed spoiler's specks take each tone's own colours", () => {
	for (const tone of [MESSAGE_TEXT_PLAIN, MESSAGE_TEXT_OWN]) {
		expect(tone).toContain("[--speck:");
		expect(tone).toContain("[--spoiler-fill:");
	}
});

// A mention is the member's name in bold: in their role's colour where it has one (an inline style from markdown.ts),
// violet where it has none, as mobile writes it. The violet comes through a variable, so a lit bubble and one's own
// bubble can name another ink without depending on where each rule lands in the stylesheet.
test("a mention is violet through --mention-ink, and one's own bubble writes it in the bubble's ink", () => {
	expect(MESSAGE_TEXT).toContain("[&_.msg-mention]:[color:var(--mention-ink,var(--duvet-chosen-ink))]");
	expect(MESSAGE_TEXT).not.toContain("[&_.msg-mention]:text-");
	expect(MESSAGE_TEXT_OWN).toContain("[--mention-ink:currentColor]");
	expect(MESSAGE_TEXT_PLAIN).not.toContain("--mention-ink");
});
