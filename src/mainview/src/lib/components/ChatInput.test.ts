import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

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
			/channelId;\s*command = null;\s*editingMessageId = null;\s*editContent = "";\s*editMessageIndex = null;\s*replyMessageIndex = null;/,
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
		/const tooLarge = messageTooLarge\(raw, pendingFiles\);\s*if \(tooLarge\) \{\s*toast\(tooLarge, "error"\);\s*return;\s*\}\s*const filesToSend = [^;]+;\s*onSubmit\(raw, filesToSend\);\s*inputEl\.innerHTML = "";/,
	);
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
