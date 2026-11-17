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

test("a conversation shown again shows the list a view of this gateway session left, as it is, with no page asked for", () => {
	const view = source("ConversationView.svelte");
	expect(view).toContain("const session = listSession();");
	expect(view).toMatch(/const kept = takeJump\(convId, list\);\s*const keptList = takeList\(convId, list\);/);
	expect(view).toMatch(/\} else if \(keptList\) \{\s*hasMore = keptList\.hasMore;\s*\}/);
	expect(view).toMatch(/if \(kept \|\| keptList\) \{[^}]*isLoading = false;\s*\} else \{\s*loadFirstPage\(\);\s*\}/);
	expect(view).toMatch(
		/const stillIn = get\(conversations\)\.some\(\(c\) => c\.id === convId\);[\s\S]*?\s*keepList\(convId, listFetched && !hasMoreBelow && stillIn \? get\(dmMessages\)\[convId\] : null, hasMore, session\);/,
	);
});

test("only pages a view fetched make its list worth keeping: the newest page, a jump's, the present's", () => {
	const view = source("ConversationView.svelte");
	expect(view).toContain("if (!before) listFetched = true;");
	expect(view).toMatch(/\[convId\]: combined \}\)\);\s*listFetched = true;/);
	expect(view).toMatch(/withPresent\(all\[convId\] \?\? \[\], fetched\) \}\)\);\s*listFetched = true;/);
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

// #326: as a room's (PaneView.test.ts), a conversation's list only grew, and its view shown again mounted all of it.
test("a conversation's list goes back to its newest page as its view leaves it at the present, and at its bottom", () => {
	const view = source("ConversationView.svelte");
	// Before it's kept for the next view, which then has older messages to load again; not as a READY takes it down.
	expect(view).toMatch(
		/if \(!hasMoreBelow && get\(friendsReady\)\) dmMessages\.trim\(convId, MESSAGE_PAGE\);\s*keepList\(/,
	);
	expect(view).toMatch(
		/const unhear = dmMessages\.onTrim\(\(chat\) => \{\s*if \(chat === convId\) hasMore = true;\s*\}\);/,
	);
	expect(view).toMatch(/release\(\);\s*unhear\(\);/);
	expect(view).toContain("if (!convId || !isAtBottom || hasMoreBelow) return;");
	expect(view).toContain("if (($dmMessages[convId]?.length ?? 0) > LIST_ON_SCREEN_MAX) {");
	expect(view).toContain("void tick().then(() => dmMessages.trim(convId, LIST_ON_SCREEN_MAX));");
	// An older page that comes once its cursor was cut away is dropped.
	expect(view).toContain("if (before && !get(dmMessages)[convId]?.some((m) => m.id === before)) return true;");
});
