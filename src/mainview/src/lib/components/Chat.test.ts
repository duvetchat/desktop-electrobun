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

// #310: who's typing showed in the chat's column, between the list and the message box, only while someone typed: the
// list lost its 26 px and, as it keeps its newest message at its bottom, every message moved up, then down as the
// notice ended. What a browser checked against a running app (the newest message stays put while someone types), kept
// here.
describe("who's typing", () => {
	const chat = source("Chat.svelte");
	const indicator = source("TypingIndicator.svelte");

	test("shows over the list's bottom, out of the chat's column, unless the draft's bars cover it already", () => {
		expect(chat.match(/<TypingIndicator\b/g)).toHaveLength(1);
		expect(chat).toContain("{@const bars = !!pending.replyTo || pending.files.length > 0}");
		expect(chat).toMatch(
			/<div class="pointer-events-none absolute right-0 bottom-full left-0 flex flex-col">\s*\{#if typing && !bars\}\s*<TypingIndicator channelId=\{key\} \/>/,
		);
		expect(chat).toContain("{@render draftBars(channelId, () => chatInputRef?.focus(), true)}");
		// The thread's box has its draft's bars alone.
		expect(chat).toContain("{@render draftBars(key, () => threadInputRef?.focus())}");
	});

	test("fits the 20 px the list leaves under its newest message, which it doesn't cover", () => {
		// The list's padding and a message's own margin: 16 and 4 px.
		expect(source("MessageList.svelte")).toContain(
			'class="flex flex-1 flex-col-reverse overflow-x-clip overflow-y-auto px-4 pt-2 pb-4"',
		);
		expect(source("MessageList.svelte")).toContain("group relative mb-1 flex flex-col rounded-md px-3");
		// 20 px tall, with nothing that makes it taller: 16 px avatars in their 1.5 px rings.
		expect(indicator).toMatch(/<div\s+class="(?:[^"]* )?h-5(?: [^"]*)?"\s*>/);
		expect(indicator).not.toMatch(/\b(min-h|py|pt|pb)-/);
		expect(indicator).toContain("size={16}");
		// One line whatever the names, as a narrow pane would wrap a long one out of the 20 px: an ellipsis instead.
		const phrases = [...indicator.matchAll(/<span\s+class="([^"]*)"[^>]*>\s*\{(?:typingPhrase|recordingPhrase)\(/g)];
		expect(phrases).toHaveLength(2);
		for (const [, classes] of phrases)
			expect(classes.split(/\s+/)).toEqual(expect.arrayContaining(["min-w-0", "truncate"]));
	});

	test("hides the messages that pass under it as the list scrolls, with what shows there when it doesn't", () => {
		// Opaque, the chat's colour at its bottom, under the list's own fade.
		expect(chat).toContain("from-night-22 to-night-19 relative flex flex-1 flex-col overflow-hidden bg-linear-to-b");
		expect(chat).toContain("bg-linear-to-t from-stone-950/45 to-transparent");
		expect(indicator).toMatch(/class="[^"]*\bbg-night-19\b[^"]*\bbg-linear-to-t from-stone-950\/45 to-transparent\b/);
	});
});
