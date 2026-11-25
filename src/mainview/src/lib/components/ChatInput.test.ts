import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// As committed, with LF line endings: a Windows checkout has CRLF (core.autocrlf), which the patterns below don't take
// (#430).
const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8").replace(/\r\n/g, "\n");

// #58: a draft per chat. A room's box stayed as the rooms changed, with its text, undo steps and recording, and a
// conversation's went with its view; the drafts themselves are lib/drafts.ts's. What follows is what a browser checked
// against a running app, kept here so it stays.
describe("a draft per chat", () => {
	const input = source("ChatInput.svelte");
	const chat = source("Chat.svelte");

	test("each chat has a box of its own, which holds that chat's draft", () => {
		expect(chat).toMatch(/\{#key channelId\}\s*<ChatInput\s+bind:this=\{chatInputRef\}\s+draftChat=\{channelId\}/);
	});

	test("the box reads its chat once: what comes after the user left it can't write the chat they went to", () => {
		expect(input).toContain("const chat = untrack(() => draftChat);");
		expect(input).toContain("changeDraft(chat, { text: kept });");
		// Every change of the text goes through the one place that keeps it.
		expect(input.match(/onValueChange\?\.\(/g)).toHaveLength(1);
		expect(input).toMatch(/function changed\(raw: string\) \{\s*keepDraft\(raw\);\s*onValueChange\?\.\(raw\);/);
	});

	test("a send and a picked command leave the box's draft empty, there and then, not when the answer comes", () => {
		expect(input).toMatch(/onSubmit\(raw, filesToSend\);[\s\S]{0,200}keepDraft\(""\);\s*\}/);
		expect(input).toMatch(/keepDraft\(""\);\s*onCommand\?\.\(entry, app\);/);
	});

	test("a box that's gone sends nothing: an Enter waiting for the commands list, a recording, a file dialog", () => {
		expect(input).toContain("if (destroyed || commandRequest !== request || getRaw(inputEl) !== raw) return;");
		expect(input).toMatch(/onDestroy\(\(\) => \{\s*destroyed = true;\s*cancelRecording\(\);/);
		expect(input).toMatch(/getUserMedia[\s\S]{0,300}if \(destroyed\) \{\s*rawStream\.getTracks\(\)/);
		expect(input).toContain("if (chunks.length > 0 && !destroyed) {");
		expect(input).toContain("if (input.files && !destroyed) {");
	});

	test("what another pane's box of the chat writes shows here, without moving the caret, and undo starts over", () => {
		const show =
			/const text = draftOf\(\$chatDrafts, chat\)\.text;[\s\S]*?closeSuggestions\(\);/.exec(input)?.[0] ?? "";
		expect(show).toContain("if (el === filledEl && text === kept) return;");
		expect(show).toContain("el.innerHTML = buildHtml(text);");
		expect(show).toContain("undoStack = [{ raw: text, cursor: text.length }];");
		expect(show).not.toContain("rerender(");
		expect(show).not.toContain("setOffset(");
	});

	test("coming back, the caret goes after the text, only where the box got the focus", () => {
		expect(input).toMatch(
			/const caretHere = selectionInBox\(\);\s*inputEl\.focus\(\);\s*if \(caretHere \|\| document\.activeElement !== inputEl\) return;\s*setOffset\(getRaw\(inputEl\)\.length\);/,
		);
		expect(chat).toContain("autofocus={!keyboard.keepNavigating}");
	});

	test("the chat's reply and files are its draft's", () => {
		expect(chat).toContain("const draft = $derived(draftOf($chatDrafts, channelId));");
		expect(chat).toMatch(/const replyTo = \$derived\(draft\.replyTo\);/);
		expect(chat).toMatch(/const pendingFiles = \$derived\(draft\.files\);/);
		expect(chat).toContain("bind:pendingFiles={() => pendingFiles, (files) => changeDraft(channelId, { files })}");
	});

	test("a command and an edit end on leaving: neither is a draft", () => {
		expect(chat).toMatch(
			/channelId;\s*command = null;\s*editingMessageId = null;\s*editMessageIndex = null;\s*replyMessageIndex = null;/,
		);
		expect(source("CommandOptions.svelte")).toContain("if (!gone) onExit();");
	});

	test("a hidden chat takes no keys: they'd go into a draft nobody sees", () => {
		expect(chat).toContain("if (!rootEl?.offsetParent) return;");
	});
});

// A message the API would refuse for its size isn't sent: the box says why and keeps its text and files, so a file can
// come out and the rest go (#182). The check comes before the send and before the box is emptied.
test("a message too large for the API stays in the box, with why, and nothing is sent", () => {
	const input = source("ChatInput.svelte");
	expect(input).toMatch(
		/const tooLarge = messageTooLarge\(raw, pendingFiles, sealed\);\s*if \(tooLarge\) \{\s*toast\(tooLarge, "error"\);\s*return;\s*\}\s*const filesToSend = [^;]+;\s*onSubmit\(raw, filesToSend\);\s*inputEl\.innerHTML = "";/,
	);
});

// #381: an emoji picked from the : suggestions counts as a use of it, as one picked in the picker does (as on the mobile
// app), so it leads the picker's Recently used.
test("a pick from the : suggestions counts as a use of its emoji", () => {
	expect(source("ChatInput.svelte")).toMatch(
		/function insertSuggestion\(entry: EmojiEntry\) \{\s*(?:\/\/[^\n]*\n\s*)*emojiUsed\(entry\.emoji\);/,
	);
});

// #415: Shift+Enter showed a line break and left the caret on the old line (WebKit, on macOS). The box makes the break
// itself, in its text; what the break, the text read back and the caret's place are is lib/message-box.ts's, tested
// there. What real keys showed in the macOS app and in Chromium, kept here.
describe("Shift+Enter starts a new line", () => {
	const input = source("ChatInput.svelte");
	const keys = /function handleKeyDown\(e: KeyboardEvent\) \{[\s\S]*?\n\t\}\n/.exec(input)?.[0] ?? "";

	test("the box makes the line break itself: the web view's own is prevented", () => {
		expect(keys).toMatch(
			/if \(enterKey\(e\) === "break"\) \{\s*e\.preventDefault\(\);\s*insertLineBreak\(\);\s*return;\s*\}/,
		);
		expect(input).toMatch(
			/function insertLineBreak\(\) \{[\s\S]*?const next = breakLine\(\s*getRaw\(inputEl\),[\s\S]*?rerender\(next\.raw, next\.caret\);\s*revealCaret\(\);[\s\S]*?changed\(next\.raw\);\s*\}/,
		);
	});

	test("an IME's Enter is left to it, and the break comes before any menu takes the key", () => {
		const composing = keys.indexOf("if (e.isComposing) return;");
		const line = keys.indexOf('enterKey(e) === "break"');
		expect(composing).toBeGreaterThan(-1);
		expect(line).toBeGreaterThan(composing);
		for (const menu of ["commandSuggestions", "mentionSuggestions", "roomSuggestions", "suggestions"]) {
			expect(keys.indexOf(`if (${menu}.length > 0) {`)).toBeGreaterThan(line);
		}
	});

	test("Enter still sends", () => {
		expect(keys).toMatch(/if \(enterKey\(e\) === "send"\) \{\s*e\.preventDefault\(\);[\s\S]*?sendMessage\(\);/);
	});

	test("the box's text, its last line and its caret go through lib/message-box.ts", () => {
		expect(input).toMatch(/function getRaw\(el: HTMLElement\): string \{\s*return rawOf\(el\);/);
		expect(input).toContain("return lineBreaksHtml(html);");
		expect(input).toContain("const place = caretAt<Node>(inputEl, target);");
		expect(input).toContain("return rawOffsetOf(inputEl, container, offset);");
		// A line break alone is text: the placeholder goes, as for a space.
		expect(input).toContain('const hasNoText = (raw: string) => raw === "";');
	});
});

// #239: Arrow Up in the empty box started the edit of the user's last message, whose box put the caret at the message's
// end, and then the key's own move carried it to the start of the line (Chromium). What a browser checked against a
// running app, kept here.
test("the Arrow Up that starts an edit doesn't move the edit box's caret off the message's end", () => {
	expect(source("ChatInput.svelte")).toContain(
		'if (e.key === "ArrowUp" && isEmpty && !e.ctrlKey && onArrowUpWhenEmpty?.()) e.preventDefault();',
	);
	// Only an edit that starts takes the key: with nothing to edit, it's left as it is.
	expect(source("Chat.svelte")).toMatch(/function tryEditLastMessage\(\) \{\s*return tryEditAtIndex\(0\);/);
});

// A conversation takes no link to a GIF (PLAN-E2E-CLIENTES.md, Ruling 12): its pick goes to the chat, which sends the
// GIF itself, sealed.
test("a GIF picked in a conversation goes as a sealed file", () => {
	const input = readFileSync(join(import.meta.dir, "ChatInput.svelte"), "utf8").replace(/\r\n/g, "\n");
	expect(input).toMatch(
		/function handleGifPick\(url: string\) \{\s*showPicker = false;\s*if \(onGif\) return onGif\(url\);\s*onSubmit\(url\);/,
	);
	const chat = readFileSync(join(import.meta.dir, "Chat.svelte"), "utf8");
	expect(chat).toContain(
		'onGif={gifFile ? (url) => void pickGif(url, (file) => handleSendMessage("", [file])) : undefined}',
	);
	// What a conversation's message holds is counted as it goes up, sealed.
	expect(input).toContain("messageTooLarge(raw, pendingFiles, sealed)");
});
