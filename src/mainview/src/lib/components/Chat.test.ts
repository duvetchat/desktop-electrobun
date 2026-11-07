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
