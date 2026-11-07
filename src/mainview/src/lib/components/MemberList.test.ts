import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// #205: the members column read every typing notice of the chat, and Chat kept the user's own there as they typed, so
// the dots showed on the user's own row. What a browser checked against a running app, kept here.
test("the members column shows who's typing as the rows and tabs do, the user aside", () => {
	const list = source("MemberList.svelte");
	expect(list).toContain("const typers = $derived(channelId ? ($typingNow[channelId] ?? []) : []);");
	expect(list).toMatch(
		/function isTyping\(userId: string\): boolean \{\s*return typers\.some\(\(u\) => u\.user_id === userId\);/,
	);
	expect(list).not.toContain("$typingUsers");
	// Nor is the user's own notice kept: nothing shows it.
	expect(source("Chat.svelte")).not.toContain("typingUsers.update");
});
