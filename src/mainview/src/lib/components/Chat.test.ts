import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// What a browser checked against a running app, kept here so it stays.
describe("the user's typing notices", () => {
	const chat = source("Chat.svelte");
	// The module's script, which outlives each view of a chat.
	const shared = chat.slice(0, chat.indexOf("</script>"));

	// #203: a pane's Chat stays as its rooms change, and its own time of the last notice held back the next room's.
	test("their 3 s are each chat's, kept outside the view", () => {
		expect(shared).toContain("const sentNotices = new Map<string, SentNotice>();");
		expect(chat).toContain("if (!noticeDue(sentNotices, channelId, recording, now)) return;");
		expect(chat).not.toMatch(/lastTypingSent|lastTypingRecording/);
	});
});

// #204: each Chat listens for keys on window, and with two panes the first one registered put a key pressed with
// nothing focused into its own box, whichever pane the user was in.
describe("a key pressed outside any input", () => {
	const chat = source("Chat.svelte");
	const pane = source("PaneView.svelte");
	const conversation = source("ConversationView.svelte");

	test("goes into the focused pane's message box only", () => {
		expect(chat).toMatch(
			/if \(paneFocused && chatInputRef && !event\.ctrlKey && !event\.metaKey && !event\.altKey && event\.key\.length === 1\) \{\s*event\.preventDefault\(\);\s*chatInputRef\?\.focusAndInsert\(event\.key\);/,
		);
	});

	test("a pane tells its chat, a room's or a conversation's, whether it's the focused one", () => {
		expect(pane).toContain('const isFocused = $derived(node.kind === "leaf" && focusedPaneId === node.id);');
		expect(pane).toMatch(/<Chat\b[\s\S]*?paneFocused=\{isFocused\}\s*\/>/);
		expect(pane).toMatch(/<ConversationView\s+conversation=\{activeConversation\}\s+paneFocused=\{isFocused\}/);
		expect(conversation).toMatch(/<Chat\b[\s\S]*?\{paneFocused\}\s*\/>/);
	});

	test("a chat outside the panes, the friends view's, is the one on screen, which takes them", () => {
		expect(chat).toContain("paneFocused = true,");
		expect(conversation).toContain("paneFocused = true,");
		expect(source("FriendsView.svelte")).not.toContain("paneFocused");
	});
});

// #220: each Chat hears Ctrl+Up and Ctrl+Down (with Shift to edit) on window, and with two panes every one of them
// started a reply or an edit, whatever had the focus. What a browser checked against a running app, kept here.
test("the reply and edit shortcuts go to one chat: the one with the focus, or else the focused pane's", () => {
	const chat = source("Chat.svelte");
	expect(chat).toMatch(/<div\s+bind:this=\{rootEl\}\s+data-chat\s/);
	expect(chat).toContain(
		'const chatShortcut = event.ctrlKey && (event.key === "ArrowUp" || event.key === "ArrowDown");',
	);
	expect(chat).toContain(
		"if (chatShortcut && !takesChatShortcut(document.activeElement, rootEl, paneFocused)) return;",
	);
	// Before any of the four acts.
	expect(chat.indexOf("takesChatShortcut(document.activeElement")).toBeLessThan(chat.indexOf("if (isCtrlShiftUp)"));
});
