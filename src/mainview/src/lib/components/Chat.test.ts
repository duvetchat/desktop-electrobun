import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8").replaceAll("\r\n", "\n");

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
// here. Since the redesign (#357) the message box is a glass bar over the list's foot, and the list's bottom padding
// is the bar's height plus the room for this line, which hangs above the bar.
describe("who's typing", () => {
	const chat = source("Chat.svelte");
	const indicator = source("TypingIndicator.svelte");

	test("shows over the list's bottom, out of the message box's own height", () => {
		expect(chat.match(/<TypingIndicator\b/g)).toHaveLength(1);
		expect(chat).toMatch(
			/\{#if typing\}\s*<div class="pointer-events-none absolute right-0 bottom-full left-0 flex flex-col[^"]*">\s*<TypingIndicator channelId=\{key\} \/>/,
		);
		expect(chat).toContain("{@render draftBars(channelId, () => chatInputRef?.focus(), true)}");
		// The thread's box has its draft's strips alone.
		expect(chat).toContain("{@render draftBars(key, () => threadInputRef?.focus())}");
	});

	test("fits the 24 px the list leaves under its newest message, over the message box, which it doesn't cover", () => {
		// The list's bottom padding: the box's height, which the chat measures, and 24 px.
		expect(source("MessageList.svelte")).toContain("pb-[calc(var(--composer-h,64px)+24px)]");
		// The chat measures the box and hands the height to the list, which sets it on the two things that read it. The
		// property doesn't inherit, so a box that grows restyles no row.
		expect(chat).toContain("composerHeight = bar.offsetHeight");
		expect(chat).not.toContain('style.setProperty("--composer-h"');
		expect(source("MessageList.svelte").match(/style:--composer-h=\{composerH\}/g)).toHaveLength(2);
		expect(readFileSync(join(import.meta.dir, "..", "..", "app.css"), "utf8")).toMatch(
			/@property --composer-h \{\s*syntax: "<length>";\s*inherits: false;\s*initial-value: 64px;\s*\}/,
		);
		// 20 px tall and 2 px off the box, with nothing that makes it taller: the ghost that leads it (#418) is the
		// pill's own 20 px.
		const pill = /\{#if active\.length > 0\}\s*<div\s+class="([^"]*)"/.exec(indicator)?.[1]?.split(/\s+/) ?? [];
		expect(pill).toEqual(expect.arrayContaining(["h-5", "mb-0.5"]));
		expect(indicator).not.toMatch(/\b(min-h|py|pt|pb)-/);
		expect(indicator).toContain("<GhostMark size={20}");
		// One line whatever the names, as a narrow pane would wrap a long one out of the 20 px: an ellipsis instead.
		const phrases = [...indicator.matchAll(/<span\s+class="([^"]*)"[^>]*>\s*\{(?:typingPhrase|recordingPhrase)\(/g)];
		expect(phrases).toHaveLength(2);
		for (const [, classes] of phrases)
			expect(classes!.split(/\s+/)).toEqual(expect.arrayContaining(["min-w-0", "truncate"]));
	});

	test("keeps its words clear of the messages that pass under it as the list scrolls", () => {
		// A glass pill: a tinted fill over a blur of what's behind it.
		expect(indicator).toMatch(/class="[^"]*\bbg-duvet-glass\b[^"]*\bbackdrop-blur-\[20px\]/);
	});
});

// Task 28: a conversation's send may ask the person first (a verified contact's changed key): a no sends nothing and
// gives back to its draft what the box handed over, its reply too.
describe("a conversation's send", () => {
	const chat = source("Chat.svelte");

	test("asks first where its conversation says so, and a no gives back what was written", () => {
		expect(chat).toMatch(
			/setReplyIn\(sending\.key, null\);\s*if \(onSend\) \{\s*(?:\/\/[^\n]*\n\s*)*if \(beforeSend && !\(await beforeSend\(\)\)\) return putBack\(channelId, nonce, fromDraft, sending\.key\);/,
		);
		expect(chat).toContain("beforeSend?: () => Promise<boolean>;");
	});

	// The edit's close once it's done: only where it's still the one open, whichever chat the view shows by then (#584).
	const closes = String.raw`if \(chat === channelId && editingMessageId === messageId\) editingMessageId = null;\s*\}`;

	// Review, Minor 8: an edit the conversation kept from going (the person's no) keeps its box open, with its text,
	// which the box keeps as the chat's (#584: false, not nothing).
	test("an edit its conversation says no to keeps its box, and what was typed in it", () => {
		expect(chat).toMatch(
			new RegExp(
				String.raw`async function saveEdit\(messageId: string, content: string\)[^{]*\{[^]*?=== false\) return false;[^]*?` +
					closes,
			),
		);
	});

	// T-M1: one it refused keeps its box too, and hands the box what to say at the message.
	test("an edit its conversation refuses keeps its box, with what was typed, and says why there", () => {
		expect(chat).toMatch(
			new RegExp(
				String.raw`async function saveEdit\(messageId: string, content: string\): Promise<string \| false \| void> \{[^]*?if \(typeof saved === "string"\) return saved;[^]*?` +
					closes,
			),
		);
		// The box keeps the refusal's words (lib/edit-box.svelte.ts, whose tests hold them) and says them at the message.
		const editor = source("InlineMessageEditor.svelte");
		expect(editor).toContain("const box = untrack(() => editBoxOf(chat, message, content));");
		expect(editor).toMatch(/\{#if box\.refused\}\s*<p role="alert"[^>]*>\{box\.refused\}<\/p>\s*\{\/if\}/);
	});
});

// #584 (FG-M8): the chat keeps the edit it has open while its box saves (lib/edit-box.test.ts holds the box's rule):
// Edit on another message, Up in the empty box or Ctrl+Shift with the arrows, keyboard navigation's edit, a reply, a
// mention, a quote, another chat, a READY's remount and the row leaving its list all leave it open.
describe("an edit whose save waits", () => {
	const chat = source("Chat.svelte");

	test("stays the chat's, whatever unmounts its box, and nothing but its answer closes it", () => {
		// Another chat, a remount: the edit open is the one the chat keeps, while the person opened none here.
		expect(chat).toContain("const editing = $derived(editingMessageId ?? keptIn(channelId)?.message ?? null);");
		// Another edit or none: refused while the edit open here saves.
		expect(chat).toMatch(
			/function editMessage\(id: string \| null\): boolean \{\s*const open = keptIn\(channelId\);\s*if \(open && open\.message === editing && open\.message !== id && !open\.close\(\)\) return false;\s*editingMessageId = id;\s*return true;\s*\}/,
		);
		// Every other way to open or close an edit goes through it: the list's Edit and Discard, Up, Ctrl+Shift with
		// the arrows, keyboard navigation, a reply, a mention, a quote. The chat's change and the save's own close are
		// the only other writes.
		expect(chat).toContain("bind:editingMessageId={() => editing, (id) => void editMessage(id)}");
		expect(chat).toContain("if (!msg || !editMessage(msg.id)) return false;");
		expect(chat).toContain("if (editMessage(null)) editMessageIndex = null;");
		expect(chat).toContain("else if (message.author_id === $currentUser?.id) editMessage(message.id);");
		expect(chat).toMatch(/function cancelEdit\(\): boolean \{\s*return editMessage\(null\);\s*\}/);
		expect([...chat.matchAll(/(?<!let )editingMessageId = /g)]).toHaveLength(3);
		expect(chat).toContain("if (editing !== null && cancelEdit()) await tick();");
		// Its box, mounted again, is the one kept, by the message it edits.
		const list = source("MessageList.svelte");
		expect(list).toMatch(/<InlineMessageEditor\s+chat=\{channelId\}\s+message=\{message\.id\}/);
	});
});
