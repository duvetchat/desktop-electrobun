import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// #201: Close pane took the pane out of the tree, and its click went on to the pane's own, which focuses the pane by
// node.id: node was gone by then, and the handler threw. What a browser checked against a running app, kept here.
test("Close pane's click stops at the button, before the pane it closed would take it", () => {
	const pane = source("PaneView.svelte");
	expect(pane).toMatch(
		/aria-label=\{t\("shell_pane_close"\)\}\s*onclick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*onClose\?\.\(\);\s*\}\}/,
	);
	// The pane's own click, which the button's no longer reaches.
	expect(pane).toContain("onclick={() => onFocus(node.id)}");
});

// #368: a group's pane bar had two ⋯ side by side: the pane's More, with the splits, and the group's own, with Rename
// and Leave. The pane's More holds the chat's own actions too, after its own, in a section of their own.
test("the pane's bar has one More, which holds its chat's own actions in a section of their own", () => {
	const pane = source("PaneView.svelte");
	expect(pane).toContain("function showConversationActions(conversationId: string, actions: Snippet | null, menu");
	const start = pane.indexOf('<Menu align="end" label={t("shell_more")}>');
	const more = pane.slice(start, pane.indexOf("</Menu>", start));
	expect(more).toContain('<IconButton {...props} label={t("shell_more")}><EllipsisIcon size={16} /></IconButton>');
	expect(more).toMatch(
		/<MenuItem icon=\{ColumnsIcon\} onSelect=\{splitH\}>\{t\("shell_split_horizontally"\)\}<\/MenuItem>/,
	);
	expect(more).toMatch(
		/\{#if conversationMenu\}\s*<MenuSeparator \/>\s*\{@render conversationMenu\(\)\}\s*\{\/if\}\s*$/,
	);
	// The active conversation's, as its actions are.
	expect(pane).toMatch(
		/const conversationMenu = \$derived\(\s*conversationActions && conversationActions\.conversationId === activeConversation\?\.id\s*\?\s*conversationActions\.menu\s*:\s*null,?\s*\);/,
	);
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

// #326: a room's list only grew, its older pages and the messages that came, and a room shown again mounted all of it.
// What a browser checked against a running app, kept here; the store's part is in message-stores.test.ts.
describe("a room's list cut back to its newest page", () => {
	const pane = source("PaneView.svelte");
	const effectWith = (line: string) => {
		const at = pane.indexOf(line);
		return pane.slice(pane.lastIndexOf("$effect(", at), pane.indexOf("\n\t});", at));
	};

	test("as its pane leaves it at the present, and not as a READY takes the panes down", () => {
		// Only when the room shown changes, or the pane goes: not each time the pane's node is made anew.
		expect(pane).toContain('const heldRoom = $derived(node.kind === "leaf" ? node.activeChannelId : null);');
		const held = effectWith("const release = channelMessages.keep(room);");
		expect(held).toContain("const room = heldRoom;");
		expect(held).toMatch(
			/if \(!channelHasMoreBelow\[room\] && get\(friendsReady\)\) channelMessages\.trim\(room, MESSAGE_PAGE\);\s*release\(\);/,
		);
	});

	test("while its reader is at its bottom, once it holds more than LIST_ON_SCREEN_MAX", () => {
		const atBottom = effectWith("channelMessages.trim(room, LIST_ON_SCREEN_MAX)");
		expect(atBottom).toContain("if (!room || !paneIsAtBottom || channelHasMoreBelow[room]) return;");
		expect(atBottom).toContain("($channelMessages[room]?.length ?? 0) > LIST_ON_SCREEN_MAX");
		// After the update that brought the message: cut in the same one, the list didn't see it come (lib/arrivals.ts).
		expect(atBottom).toContain("void tick().then(() => channelMessages.trim(room, LIST_ON_SCREEN_MAX));");
	});

	test("leaves older messages to load again, in every pane that had the room", () => {
		expect(pane).toMatch(/channelMessages\.onTrim\(\(room\) => \{\s*channelHasMore\[room\] = true;\s*\}\)/);
	});

	test("drops an older page that comes once its cursor is cut away", () => {
		const loadMore = pane.slice(pane.indexOf("async function loadMoreMessages()"), pane.indexOf("function startJump("));
		expect(loadMore).toMatch(
			/clearTimeout\(timeoutId\);\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*if \(!get\(channelMessages\)\[channelId\]\?\.some\(\(m\) => m\.id === oldest\)\) return;/,
		);
	});

	test("loads a room's newest page again once the store dropped its list", () => {
		expect(pane).toContain("const list = get(channelMessages)[channelId];");
		expect(pane).toContain("if (list && (list.length > 0 || !hasServerMsgs)) return;");
	});
});
