import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// #205 took the user's own typing off their row of the members column, where Chat kept it with the others' notices,
// and with it from everywhere. Their own row now shows it again from a store of its own (ownTyping), the one place it
// shows. What a browser checked against a running app, kept here.
test("the members column shows the others' typing as the rows and tabs do, and the user's own on their own row", () => {
	const list = source("MemberList.svelte");
	expect(list).toContain("const typers = $derived(channelId ? ($typingNow[channelId] ?? []) : []);");
	expect(list).toContain("const ownRecording = $derived(channelId ? $ownTyping[channelId] : undefined);");
	expect(list).toMatch(
		/function isTyping\(userId: string\): boolean \{\s*if \(userId === \$currentUser\?\.id\) return ownRecording !== undefined;\s*return typers\.some\(\(u\) => u\.user_id === userId\);/,
	);
	expect(list).not.toContain("$typingUsers");
	// Chat notes the user's own typing apart from the others' notices, which the rows, the tabs and its line read.
	const chat = source("Chat.svelte");
	expect(chat).toContain("noteOwnTyping(channelId, recording);");
	expect(chat).not.toContain("typingUsers.update");
});

// Every file under a folder, its subfolders' too.
function filesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
	);
}

test("nothing but the members column reads the user's own typing", () => {
	const src = join(import.meta.dir, "..", "..");
	const readers = filesUnder(src)
		.filter((file) => /\.(svelte|ts)$/.test(file) && !file.endsWith(".test.ts"))
		.filter((file) => readFileSync(file, "utf8").includes("ownTyping"))
		.map((file) => relative(src, file).split(sep).join("/"))
		.sort();
	expect(readers).toEqual(["lib/components/MemberList.svelte", "lib/stores.svelte.ts"]);
});
