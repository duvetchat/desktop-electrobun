import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// #368: a group's pane bar had two ⋯ side by side, the pane's More and the group's own. The group's Rename and Leave
// go to the pane's More (PaneView.test.ts), and only a view with no pane's bar keeps a menu of its own for them.
test("a group's bar offers what the user can do to it in the pane's one More, a DM's nothing", () => {
	const view = source("ConversationView.svelte");
	expect(view).toContain("const actionsOnGroup = $derived(groupActions(conversation, me?.id));");
	const groupMenu = view.slice(view.indexOf("{#snippet groupMenu()}"), view.indexOf("{#snippet actions()}"));
	expect(groupMenu).toMatch(/\{#if actionsOnGroup\.rename\}\s*<MenuItem icon=\{Pencil\} onSelect=\{renameGroup\}>/);
	expect(groupMenu).toContain("<MenuItem icon={LogOut} danger onSelect={leaveGroup}>Leave group</MenuItem>");
	// The bar gets them with the actions, a group's alone.
	expect(view).toContain("show(convId, actions, actionsOnGroup.leave ? groupMenu : null);");
	// The actions draw a ⋯ of their own only without a bar.
	const start = view.indexOf("{#snippet actions()}");
	const actions = view.slice(start, view.indexOf("\n{/snippet}", start));
	expect(actions.match(/<Ellipsis\b/g)).toHaveLength(1);
	expect(actions).toMatch(
		/\{#if actionsOnGroup\.leave && !onBarActions\}\s*<Menu align="end" label="More for this group">[\s\S]*?\{@render groupMenu\(\)\}\s*<\/Menu>/,
	);
});

// #370: a DM's or a group's call button started a voice call only, and the camera could only be turned on in the call.
// Its chevron offers a voice call or a video call: one control, not a second button beside it.
test("the call button calls with one press, and its chevron offers a voice call or a video call", () => {
	const view = source("ConversationView.svelte");
	const start = view.indexOf("{#snippet actions()}");
	const actions = view.slice(start, view.indexOf("\n{/snippet}", start));
	// The phone itself places a voice call, as before; the chevron beside it opens the menu. Both wait while a call
	// shows, or the user's own rings from another device.
	expect(actions).toMatch(/onclick=\{startCall\}\s*disabled=\{!!\$activeCall \|\| joinWaits\}\s*title="Start call"/);
	expect(actions).toMatch(
		/<Menu align="end" label="Start a call">\s*\{#snippet trigger\(props\)\}\s*<button\s*\{\.\.\.props\}[^>]*disabled=\{!!\$activeCall \|\| joinWaits\}\s*title="Voice or video call"\s*aria-label="Voice or video call"\s*>\s*<ChevronDown/,
	);
	expect(actions).toContain("<MenuItem icon={Phone} onSelect={startCall}>Voice call</MenuItem>");
	expect(actions).toContain("<MenuItem icon={Video} onSelect={startVideoCall}>Video call</MenuItem>");
	expect(view).toMatch(
		/function startVideoCall\(\) \{\s*startConversationCall\(conversation, \{ video: true \}\);\s*\}/,
	);
	// No second button: the bar's one phone is the call's.
	expect(actions.match(/<Phone class=/g)).toHaveLength(1);
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
		/const stillIn = get\(conversations\)\.some\(\(c\) => c\.id === convId\);[\s\S]*?\s*keepList\(\s*convId,\s*listFetched && !hasMoreBelow && stillIn \? \(get\(dmMessages\)\[convId\] \?\? null\) : null,\s*hasMore,\s*session,\s*\);/,
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
	// The name is a group's alone: out of sight and out of reach until two friends are picked (its place is kept).
	expect(friends).toMatch(
		/<div class="[^"]*\{selectedFriendIds\.size > 1 \? '' : 'invisible'\}">\s*<label for="group-name"/,
	);
	expect(friends).toContain("disabled={selectedFriendIds.size <= 1}");
	expect(friends).toContain('selectedFriendIds.size === 1 ? "Start chat" : "Create group"');
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
	// A list cut back has older messages to load again, and the device's rows it no longer lists go from memory (M1).
	expect(view).toMatch(
		/const unhear = dmMessages\.onTrim\(\(chat\) => \{\s*if \(chat !== convId\) return;\s*hasMore = true;\s*letGo\(convId, /,
	);
	expect(view).toMatch(/release\(\);\s*unhear\(\);/);
	expect(view).toContain("if (!convId || !isAtBottom || hasMoreBelow) return;");
	expect(view).toContain("if (($dmMessages[convId]?.length ?? 0) > LIST_ON_SCREEN_MAX) {");
	expect(view).toContain("void tick().then(() => dmMessages.trim(convId, LIST_ON_SCREEN_MAX));");
	// An older page that comes once its cursor was cut away is dropped.
	expect(view).toContain("if (before && !get(dmMessages)[convId]?.some((m) => m.id === before)) return true;");
});

// The re-review of task 16 (I4): rows from before the user joined, which the device doesn't hold, end the pages only
// where the device holds nothing older than the oldest row loaded.
test("the pages go on past rows from before joining while the device holds older ones", () => {
	const view = source("ConversationView.svelte");
	expect(view).toContain("hasMoreMessages={hasMore && (!beforeJoining || olderHeld)}");
	expect(view).toMatch(/if \(!beforeJoining \|\| oldest === null\) \{\s*olderHeld = false;\s*return;\s*\}/);
	expect(view).toContain("heldBeforeEncrypted(convId, oldest)");
});

// M3: a message the conversation's queue settles at its Dismiss went after all: the API's copy shows, as an answer's.
test("a Dismiss whose message went shows the API's copy", () => {
	const view = source("ConversationView.svelte");
	expect(view).toContain("const went = await discardEncrypted(convId, nonce);");
	expect(view).toContain("const real = await getDirectMessageById(convId, went);");
});

// A conversation's files (PLAN-E2E-CLIENTES.md, «Adjuntos»): a message's files, a voice note and a GIF go through the
// encryption engine, sealed; a Cancel of their upload lets the message go from the device too.
test("a conversation's files, voice notes and GIFs are sent sealed, through the engine", () => {
	const view = source("ConversationView.svelte");
	expect(view).not.toContain("if (saved?.files?.length) throw");
	expect(view).toMatch(/saved\.outgoing = await outgoingFiles\(saved\.files\)/);
	expect(view).toMatch(/const facts = await voiceNoteFacts\(blob\)/);
	expect(view).toMatch(/const picked = await gifFile\(url, gifBytes\)/);
	expect(view).toContain("gifFile={dmGif}");
});

test("a cancelled upload discards its message", () => {
	const view = source("ConversationView.svelte");
	expect(view).toMatch(/if \(real === CANCELLED\) return dmCancelled\(convId, nonce, fromDraft, saved\?\.draft\);/);
	expect(view).toMatch(/async function dmCancelled[\s\S]*?const went = await discardEncrypted\(convId, nonce\)/);
});
