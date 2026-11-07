import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

test("a group's bar offers what the user can do to it, a DM's nothing", () => {
	const view = source("ConversationView.svelte");
	expect(view).toContain("const actionsOnGroup = $derived(groupActions(conversation, me?.id));");
	expect(view).toMatch(/\{#if actionsOnGroup\.leave\}\s*<DropdownMenu\.Root>/);
	expect(view).toMatch(
		/\{#if actionsOnGroup\.rename\}\s*<DropdownMenu\.Item class=\{groupMenuItem\} onSelect=\{renameGroup\}>/,
	);
});

test("renaming starts from the name, asks nothing for the same one or none, and shows a refusal", () => {
	const view = source("ConversationView.svelte");
	expect(view).toContain('await promptDialog("Rename group", "Group name", current);');
	expect(view).toContain("if (!name || name === current) return;");
	expect(view).toContain(`toast(getApiError(err, "Couldn't rename the group"), "error");`);
});

test("leaving asks first, and what the API took goes here at once, a call there included", () => {
	const view = source("ConversationView.svelte");
	expect(view).toMatch(
		/confirmAction\("Leave the group\?", "Leave group", async \(\) => \{\s*await leaveConversation\(convId\);\s*conversationLeft\(convId\);\s*\}\)/,
	);
});

test("a conversation the user is no longer in acks nothing as its view goes, and leaves no unread dot to clear", () => {
	expect(source("ConversationView.svelte")).toMatch(
		/return \(\) => \{\s*\/\/ [^\n]*\n\s*if \(!get\(conversations\)\.some\(\(c\) => c\.id === convId\)\) return;\s*const msgs = get\(dmMessages\)\[convId\]/,
	);
});

test("the new group dialog goes by what's picked: one friend's DM, or a group", () => {
	const friends = source("FriendsView.svelte");
	expect(friends).toContain("const plan = newConversation(selectedFriendIds, groupName);");
	expect(friends).toContain(
		'plan.kind === "dm" ? await createDM(plan.userId) : await createGroup(plan.name, plan.userIds)',
	);
	expect(friends).toMatch(/\{#if selectedFriendIds\.size > 1\}\s*<div[^>]*>\s*<label for="group-name"/);
	expect(friends).toContain('selectedFriendIds.size === 1 ? "Start conversation" : "Create group"');
	// What it refused is about the picks before this one.
	expect(friends).toMatch(/selectedFriendIds = next;\s*groupError = "";/);
});

test("the prompt is ready to type, and Enter doesn't go on to press what opened it", () => {
	const prompt = source("PromptDialog.svelte");
	expect(prompt).toMatch(
		/onOpenAutoFocus=\{\(e\) => \{\s*e\.preventDefault\(\);\s*inputEl\?\.focus\(\);\s*inputEl\?\.select\(\);\s*\}\}/,
	);
	expect(prompt).toMatch(/if \(e\.key !== "Enter"\) return;\s*\/\/ [^\n]*\n\s*e\.preventDefault\(\);\s*submit\(\);/);
});
