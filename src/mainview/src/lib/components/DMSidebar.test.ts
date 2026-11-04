import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// The mentions waiting in a conversation (mentionCounts, which READY's counts and DM_MENTION_CREATE fill) show on its row,
// as a room's show on its own (#91): only its tab showed them.
test("a conversation's row in the DM list shows its mentions, from its news as its tab has them", () => {
	const dmList = source("DMSidebar.svelte");
	expect(dmList).toMatch(
		/tabNews\(\s*conversationTab\(conv, [^)]*\),\s*\$unreadChannels,\s*\$unreadConversations,\s*\$mentionCounts,?\s*\)/,
	);
	expect(dmList).toContain('aria-label="{news.mentions} mentions"');
});

test("a conversation in the quick switcher shows its mentions, as a room there does", () => {
	const switcher = source("QuickSwitcher.svelte");
	expect(switcher).toContain("mentions: $mentionCounts[conv.id] ?? 0");
	expect(switcher).toContain('{#if (item.kind === "room" || item.kind === "conversation") && item.mentions}');
});
