import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { get } from "svelte/store";
import type { DirectMessage } from "$lib/api/conversations";
import { MessageType, type Message } from "$lib/types";

// The stores' module uses $state, which only Svelte's compiler knows: here it's the value itself (as test-gateway.ts).
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { channelMessages, dmMessages, ephemeralMessages, keepEphemeral } = await import("$lib/stores.svelte");

// #320: the stores of chats' messages keep the lists of 50 chats at most. They dropped the lists they had seen first,
// whatever their use: every change marked every list as used, in the order the chats came in, so the chat on screen
// could lose its list.
const message = (id: string): Message => ({
	id,
	content: "",
	type: MessageType.Text,
	author_id: "alice",
	author_name: "alice",
	author_avatar_url: null,
	author_is_bot: false,
	created_at: "",
	updated_at: "",
});
const lists = () => Object.keys(get(channelMessages));
/** A message more in a room's list, adding the list when the room has none. */
const add = (room: string) =>
	channelMessages.update((all) => ({
		...all,
		[room]: [...(all[room] ?? []), message(`${room}-${all[room]?.length ?? 0}`)],
	}));
const fill = () => {
	for (let i = 0; i < 50; i++) add(`room${i}`);
};

beforeEach(() => channelMessages.set({}));

test("past 50 lists, the one changed least recently goes, not the first that came", () => {
	fill();
	add("room0");
	add("room50");
	expect(lists()).toHaveLength(50);
	expect(lists()).toContain("room0");
	expect(lists()).not.toContain("room1");
});

test("a list a view holds stays, however long it goes unchanged", () => {
	fill();
	const release = channelMessages.keep("room0");
	add("room50");
	add("room51");
	expect(lists()).toContain("room0");
	expect(lists()).not.toContain("room1");
	expect(lists()).not.toContain("room2");
	release();
});

test("a view letting go of a list counts as its use", () => {
	fill();
	channelMessages.keep("room0")();
	add("room50");
	expect(lists()).toContain("room0");
	expect(lists()).not.toContain("room1");
});

test("a list taken out of the store isn't counted against the others", () => {
	fill();
	channelMessages.update(({ room0: _gone, ...rest }) => rest);
	add("room50");
	expect(lists()).toHaveLength(50);
	expect(lists()).toContain("room1");
});

test("the conversations' store keeps its lists the same way", () => {
	dmMessages.set({});
	for (let i = 0; i < 50; i++) dmMessages.update((all) => ({ ...all, [`dm${i}`]: [] as DirectMessage[] }));
	const release = dmMessages.keep("dm0");
	dmMessages.update((all) => ({ ...all, dm50: [] as DirectMessage[] }));
	expect(Object.keys(get(dmMessages))).toContain("dm0");
	expect(Object.keys(get(dmMessages))).not.toContain("dm1");
	release();
});

test("the views hold the lists they show", () => {
	const source = (file: string) => readFileSync(join(import.meta.dir, "components", file), "utf8");
	// A pane holds its room's list, shown or under the Friends view, which keeps the panes' chats mounted.
	expect(source("PaneView.svelte")).toMatch(
		/\$effect\(\(\) => \{\s*if \(node\.kind === "leaf" && node\.activeChannelId\) return channelMessages\.keep\(node\.activeChannelId\);\s*\}\);/,
	);
	// A conversation's view holds its list from its mount to its end.
	const conversation = source("ConversationView.svelte");
	expect(conversation).toContain("const release = dmMessages.keep(convId);");
	expect(conversation).toMatch(/hide\(\);\s*release\(\);/);
});

// #321: the ephemeral messages bots send were kept without a limit, where the API keeps the newest 50 per person and
// bot, for 15 minutes.
test("a room keeps its newest 50 ephemeral messages", () => {
	for (let i = 0; i < 60; i++) keepEphemeral("room", message(`e${i}`));
	const kept = get(ephemeralMessages).room;
	expect(kept).toHaveLength(50);
	expect(kept[0].id).toBe("e10");
	expect(kept.at(-1)?.id).toBe("e59");
	// One replaced (edited by its bot) is still one.
	keepEphemeral("room", { ...message("e30"), content: "edited" });
	expect(get(ephemeralMessages).room).toHaveLength(50);
	expect(get(ephemeralMessages).room[0].id).toBe("e10");
});
