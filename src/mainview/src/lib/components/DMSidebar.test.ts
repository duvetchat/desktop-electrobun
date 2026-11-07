import { describe, expect, test } from "bun:test";
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

// Who's typing shows on the rows and tabs of chats that aren't open (#88): what's held back is the user and the old
// notices (lib/typing.ts). A row keeps its height: a conversation's line says it in words, and a room's or a tab's mark
// stands in the place of its icon, of its size.
describe("who's typing, outside the open chat", () => {
	test("a conversation's row says it in its second line", () => {
		expect(source("DMSidebar.svelte")).toContain("{typingSentence($typingNow[conv.id]) ?? convSubtitle(conv)}");
	});

	test("a room's row shows the mark for its hash, and says who in its tooltip", () => {
		const rooms = source("ChannelsSidebar.svelte");
		expect(rooms).toMatch(/\{#if typers\}\s*<TypingMark users=\{typers\} \/>\s*\{:else if channel\.type === "text"\}/);
		expect(rooms).toContain("title={typing ? `${channel.name} · ${typing}` : channel.name}");
	});

	test("a tab's mark, wherever tabs show, takes the place and size of its icon", () => {
		expect(source("TabIcon.svelte")).toMatch(
			/\{#if typers\}\s*<TypingMark\s+users=\{typers\}\s+size=\{isConversationTab\(tab\) \? size \+ 4 : size\}/,
		);
		expect(source("TabBar.svelte")).toContain("{@const typing = typingSentence($typingNow[tab.channelId])}");
	});

	test("the rooms with news under a space, and the open chats in the column, show it too", () => {
		const nav = source("SpaceNav.svelte");
		expect(nav).toMatch(/\{#if typers\}\s*<TypingMark users=\{typers\} class="text-duvet-ink2" \/>/);
		expect(nav).toMatch(/typingSentence\(\$typingNow\[tab\.channelId\]\) \?\?\s*\(isConversationTab\(tab\)/);
	});
});
