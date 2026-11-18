import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactorsRequest } from "$lib/stores.svelte";

// The stores' module keeps the session token in a $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const stores = await import("$lib/stores.svelte");
const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// Who reacted to a message shows in one dialog for the app, opened from the message's menu or a reaction's right click,
// in the list and in the previews alike (desktop#92).
describe("who reacted", () => {
	test("opens from a reaction's right click, wherever reactions show", () => {
		expect(source("MessageReactions.svelte")).toMatch(
			/oncontextmenu=\{\(e\) => \{\s*e\.preventDefault\(\);\s*onShowReactors\(reaction\);\s*\}\}/,
		);
		expect(source("MessageList.svelte")).toContain("onShowReactors={(r) => showReactors(message, r.emoji_name)}");
		expect(source("MessagePreview.svelte")).toMatch(
			/onShowReactors=\{\(r\) =>\s*reactorsRequest\.set\(\{ messageId: message\.id, reactions, picked: r\.emoji_name, members, customEmojiMap \}\)\}/,
		);
	});

	test("opens from the menu of a message that has reactions, on its first one", () => {
		const list = source("MessageList.svelte");
		// The one menu of a message, the user's own or another's, from its More button and from a right-click.
		expect(list.match(/\{@render reactionsItem\(message\)\}/g)).toHaveLength(1);
		expect(list).toMatch(/\{#snippet reactionsItem\(message: Message\)\}\s*\{#if message\.reactions\?\.length\}/);
		expect(list).toContain(
			'function showReactors(message: Message, picked = message.reactions?.[0]?.emoji_name ?? "")',
		);
	});

	test("is one dialog for the app, which follows the reactions while it's open and closes once none is left", () => {
		expect(readFileSync(join(import.meta.dir, "../../routes/app/+page.svelte"), "utf8")).toContain(
			"<ReactionsDialog />",
		);
		const dialog = source("ReactionsDialog.svelte");
		expect(dialog).toContain(
			"if (request && change.message_id === request.messageId) reactions = withReaction(reactions, change);",
		);
		expect(dialog).toContain("if (open && reactions.length === 0) open = false;");
	});

	// Over the pins list or a thread, the dialog would open under it, or fight it for the keyboard: they close first, as
	// they do for a jump or an invite a message in them opens.
	test("closes what shows messages over the chat, as a jump or an invite does", () => {
		let closed = 0;
		const stop = stores.onOpenElsewhere(() => closed++);
		const request: ReactorsRequest = { messageId: "m", reactions: [], picked: "👍", members: [], customEmojiMap: {} };
		stores.reactorsRequest.set(request);
		stores.jumpToMessageRequest.set({ id: "j", spaceId: "s", roomId: "r", messageId: "m" });
		stores.spaceInviteRequest.set("code");
		stores.botInviteRequest.set("bot");
		// A request taken (set back to null) is nothing new.
		stores.reactorsRequest.set(null);
		stop();
		stores.reactorsRequest.set(request);
		expect(closed).toBe(4);
	});
});
