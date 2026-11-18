import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// A mention's click goes to its member's profile before whatever is around it hears it (a reply's quote, a search
// result), so each list that shows messages hears it in the capture phase, with its own members.
describe("what shows messages opens a mention's profile", () => {
	test("the message list, for its list and for a thread's dialog", () => {
		const list = source("MessageList.svelte");
		expect(list).toContain('scrollEl?.addEventListener("click", openMention, true);');
		expect(list).toContain('scrollEl?.removeEventListener("click", openMention, true);');
		expect(list).toMatch(/<div class="flex flex-col gap-2" onclickcapture=\{openMention\}>\s*\{#each threadShown /);
		expect(list).toContain("<MentionProfile bind:this={mentionProfile} {members} {space} />");
	});

	for (const file of ["PinnedMessages.svelte", "MessageSearch.svelte"])
		test(file, () => {
			const shown = source(file);
			expect(shown).toContain("onclickcapture={(e) => mentionProfile.open(e)}");
			expect(shown).toContain("<MentionProfile bind:this={mentionProfile} {members} {space} />");
			// Around the previews, which it's the capture phase's point to reach first.
			expect(shown.indexOf("onclickcapture")).toBeLessThan(shown.indexOf("<MessagePreview"));
		});
});

test("the profile popover opens beside an anchor, without a trigger of its own", () => {
	const popover = source("MemberProfilePopover.svelte");
	expect(popover).toMatch(/\{#if children\}\s*<Popover\.Trigger/);
	expect(popover).toContain("customAnchor={anchor}");
});

// A press on a chip focuses the text around it (tabindex -1: a whole message, a search result). bits-ui hands the focus
// back there as the popover closes, without preventScroll: the list moved, a click elsewhere lost its release to the move,
// the text got a focus ring on Escape, and Enter then edited one's own message.
test("a profile opened beside an anchor doesn't hand the focus back as it closes, and one with a trigger does", () => {
	const popover = source("MemberProfilePopover.svelte");
	expect(popover).toMatch(/onCloseAutoFocus=\{\(e\) => \{\s*if \(anchor\) e\.preventDefault\(\);\s*\}\}/);
});

// A mention of someone who left, or isn't loaded, opens nothing, and doesn't look as if it did.
test("only a mention with an ID shows a pointer and reacts to it", () => {
	const css = readFileSync(join(import.meta.dir, "../../app.css"), "utf8");
	expect(css).toMatch(/\.msg-mention:not\(\[data-user-id\]\) \{\s*cursor: default;/);
	expect(css).toContain(".msg-mention[data-user-id]:hover");
	expect(css).not.toMatch(/\.msg-mention:hover/);
});

// A chip that's gone can't place what opens beside it: the popover would jump to the window's corner.
test("a mention's profile closes when its chip goes", () => {
	const profile = source("MentionProfile.svelte");
	expect(profile).toContain("if (!chip.isConnected) opened = null;");
	expect(profile).toContain("observer.observe(document.body, { childList: true, subtree: true });");
});
