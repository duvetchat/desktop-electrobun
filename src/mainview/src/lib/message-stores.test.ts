import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { get } from "svelte/store";
import type { DirectMessage } from "$lib/api/conversations";
import { MessageType, type Message } from "$lib/types";

// The stores' module uses $state, which only Svelte's compiler knows: here it's the value itself (as test-gateway.ts).
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { channelMessages, dmMessages, ephemeralMessages, keepEphemeral, newestPage, MESSAGE_PAGE } =
	await import("$lib/stores.svelte");

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
		/const room = heldRoom;\s*if \(!room\) return;\s*const release = channelMessages\.keep\(room\);/,
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

// #326: a chat's list only grew, older pages as its reader scrolled up and live messages as they came, for every chat
// whether a view showed it or not, and a chat shown again mounted all of it.
describe("a chat's list cut back to its newest page", () => {
	const page = (room: string, from: number, n: number) =>
		Array.from({ length: n }, (_, i) => message(`${room}-${String(from + i).padStart(4, "0")}`));
	const ids = (list: Message[] | undefined) => list?.map((m) => m.id);

	test("keeps the newest page by ID, in the list's order, and every message being sent", () => {
		const sending = { ...message("nonce-1"), nonce: "nonce-1" };
		// Older pages go after the newer ones, as a room's list gets them.
		const list = [...page("r", 200, 50), sending, ...page("r", 100, 100), ...page("r", 0, 100)];
		const kept = newestPage(list);
		expect(kept).toHaveLength(MESSAGE_PAGE + 1);
		expect(ids(kept)).toEqual([...ids(page("r", 200, 50))!, "nonce-1", ...ids(page("r", 150, 50))!]);
		// A page or less stays as it is.
		const short = page("r", 0, MESSAGE_PAGE);
		expect(newestPage(short)).toBe(short);
	});

	test("is cut once it holds more than its caller allows, and every view hears of it", () => {
		channelMessages.set({ r: page("r", 0, 250) });
		const heard: string[] = [];
		const stop = channelMessages.onTrim((chat) => heard.push(chat));
		expect(channelMessages.trim("r", 300)).toBe(false);
		expect(channelMessages.trim("r", 200)).toBe(true);
		stop();
		expect(ids(get(channelMessages).r)).toEqual(ids(page("r", 150, 100)));
		expect(heard).toEqual(["r"]);
		// Nothing to cut: no list.
		expect(channelMessages.trim("nowhere", 0)).toBe(false);
	});

	test("isn't cut while a view other than the asking one holds it", () => {
		channelMessages.set({ r: page("r", 0, 250) });
		const mine = channelMessages.keep("r");
		const other = channelMessages.keep("r");
		expect(channelMessages.trim("r", MESSAGE_PAGE)).toBe(false);
		other();
		expect(channelMessages.trim("r", MESSAGE_PAGE)).toBe(true);
		mine();
	});

	test("says whether a view holds a chat, before its list is there too", () => {
		expect(channelMessages.holds("r")).toBe(false);
		const release = channelMessages.keep("r");
		expect(channelMessages.holds("r")).toBe(true);
		release();
		expect(channelMessages.holds("r")).toBe(false);
	});

	test("one no view holds goes once a page of messages came after its view let go of it", () => {
		channelMessages.set({ r: page("r", 0, 50), held: page("held", 0, 50) });
		channelMessages.keep("r")();
		const stillHeld = channelMessages.keep("held");
		const arrive = (chat: string, n: number) =>
			channelMessages.update((all) => ({ ...all, [chat]: [...all[chat], ...page(chat, 1000 + all[chat].length, n)] }));
		arrive("r", MESSAGE_PAGE);
		expect(get(channelMessages).r).toHaveLength(50 + MESSAGE_PAGE);
		arrive("r", 1);
		expect(get(channelMessages).r).toBeUndefined();
		// One a view holds keeps them, as its view shows them.
		arrive("held", 3 * MESSAGE_PAGE);
		expect(get(channelMessages).held).toHaveLength(50 + 3 * MESSAGE_PAGE);
		stillHeld();
	});

	test("the conversations' lists the same way", () => {
		const dm = (id: string): DirectMessage => ({
			id,
			conversation_id: "dm",
			author_id: "alice",
			content: "",
			type: MessageType.Text,
			created_at: "",
			updated_at: "",
		});
		dmMessages.set({ dm: Array.from({ length: 150 }, (_, i) => dm(`dm-${String(i).padStart(4, "0")}`)) });
		expect(dmMessages.trim("dm", MESSAGE_PAGE)).toBe(true);
		expect(get(dmMessages).dm[0].id).toBe("dm-0050");
	});
});
