import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import { tags } from "./server-render";
import type { Conversation } from "$lib/api/conversations";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules use $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { conversations, currentUser } = await import("$lib/stores.svelte");
const { navPrefs } = await import("$lib/nav-prefs.svelte");
const { default: DMSidebar } = await import("./DMSidebar.svelte");

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// The mentions waiting in a conversation (mentionCounts, which READY's counts and DM_MENTION_CREATE fill) show on its row,
// as a room's show on its own (#91): only its tab showed them. Both read the marks a level of nothing leaves
// (lib/notification-marks.ts).
test("a conversation's row in the DM list shows its mentions, from its news as its tab has them", () => {
	const dmList = source("DMSidebar.svelte");
	expect(dmList).toMatch(
		/tabNews\(\s*conversationTab\(conv, [^)]*\),\s*\$shownUnreadRooms,\s*\$shownUnreadConversations,\s*\$shownMentionCounts,?\s*\)/,
	);
	// The count's name agrees with it: "1 mention", "3 mentions" (shell-layout.ts: mentionsLabel).
	expect(dmList).toContain("aria-label={mentionsLabel(news.mentions)}");
});

test("a conversation in the quick switcher shows its mentions, as a room there does", () => {
	const switcher = source("QuickSwitcher.svelte");
	expect(switcher).toContain("mentions: $shownMentionCounts[conv.id] ?? 0");
	expect(switcher).toContain('{#if (item.kind === "room" || item.kind === "conversation") && item.mentions}');
});

// #416: a direct message or a group is pinned to the top of the chats from its row's menu, as a Space is to the top of
// the Spaces. A room isn't: its Space is what the sidebar pins.
describe("a pinned chat", () => {
	const ME = "01920000-0000-7000-8000-00000000b0b0";
	const WREN = "01920000-0000-7000-8000-00000000a11c";
	const user = (id: string, alias: string) => ({
		id,
		username: alias.toLowerCase(),
		alias,
		avatar: null,
		banner: null,
	});
	const group = (id: string, name: string): Conversation => ({
		id,
		type: 2,
		name,
		owner_id: ME,
		created_at: "",
		updated_at: "",
		deleted_at: null,
		members: [],
	});
	const directMessage: Conversation = {
		...group("c0", ""),
		type: 1,
		name: null,
		members: [user(ME, "Me"), user(WREN, "Wren")].map((member) => ({
			id: `m-${member.id}`,
			conversation_id: "c0",
			user_id: member.id,
			created_at: "",
			updated_at: "",
			user: member,
		})),
	};
	// The user's chats as the gateway lists them, the latest message first: the direct message with Wren, then groups.
	const NAMES = ["Wren", "Alder", "Birch", "Cedar", "Dogwood", "Elder", "Fennel", "Ginkgo", "Hazel"];
	const chats = [directMessage, ...NAMES.slice(1).map((name, index) => group(`c${index + 1}`, name))];
	currentUser.set({
		...user(ME, "Me"),
		email_verified: true,
		custom: "",
		flags: 0,
		badges: 0,
		is_bot: false,
		created_at: "",
		updated_at: "",
	});

	/** The chats the list draws, top to bottom, by name, and what else it says. */
	const drawn = (folded: boolean) => {
		const { body } = render(DMSidebar, { props: { onSelect: () => {}, folded } });
		const names = NAMES.filter((name) => body.includes(name)).sort((a, b) => body.indexOf(a) - body.indexOf(b));
		return { names, body };
	};
	/** Each row the list draws, top to bottom: whether it carries the pin's mark. */
	const pinMarks = async (folded: boolean) => {
		const rows: boolean[] = [];
		for (const tag of await tags(DMSidebar, { onSelect: () => {}, folded })) {
			if (tag.name === "button" && tag.attributes.draggable === "true") rows.push(false);
			else if (tag.attributes["aria-label"] === "Pinned") rows[rows.length - 1] = true;
		}
		return rows;
	};

	test("heads the list in the order pinned, a direct message as a group, each with the pin's mark", async () => {
		conversations.set(chats);
		navPrefs.pinnedChats = [];
		expect(drawn(false).names).toEqual(NAMES);
		expect(await pinMarks(false)).toEqual(NAMES.map(() => false));

		// Hazel (a group, the oldest chat) pinned first, then Wren (the direct message).
		navPrefs.pinnedChats = ["c8", "c0"];
		expect(drawn(false).names).toEqual([
			"Hazel",
			"Wren",
			"Alder",
			"Birch",
			"Cedar",
			"Dogwood",
			"Elder",
			"Fennel",
			"Ginkgo",
		]);
		expect(await pinMarks(false)).toEqual([true, true, false, false, false, false, false, false, false]);
	});

	test("shows under All whatever its age, above the six latest of the others", async () => {
		conversations.set(chats);
		navPrefs.pinnedChats = ["c8", "c0"];
		const { names, body } = drawn(true);
		expect(names).toEqual(["Hazel", "Wren", "Alder", "Birch", "Cedar", "Dogwood", "Elder", "Fennel"]);
		// Ginkgo, the seventh of the others, waits behind the row.
		expect(body).toContain("1 more chat");
		expect(await pinMarks(true)).toEqual([true, true, false, false, false, false, false, false]);
	});

	test("is pinned and unpinned from its row's menu, above its notifications", () => {
		expect(source("DMSidebar.svelte")).toMatch(
			/<MenuItem icon=\{pinned \? PinOffIcon : PinIcon\} onSelect=\{\(\) => togglePinnedChat\(conv\.id\)\}\s*>\{pinned \? "Unpin" : "Pin to top"\}<\/MenuItem\s*>\s*<NotificationSubmenu/,
		);
	});

	test("a room has no pin", () => {
		expect(source("ChannelsSidebar.svelte")).not.toMatch(/Pin to top|togglePinned/);
	});
});

// Who's typing shows on the rows and tabs of chats that aren't open (#88): what's held back is the user and the old
// notices (lib/typing.ts). A row keeps its height: a conversation's line says it in words, and a room's or a tab's mark
// stands in the place of its icon, of its size.
describe("who's typing, outside the open chat", () => {
	test("a conversation's row says it in its second line", () => {
		expect(source("DMSidebar.svelte")).toContain("{typingSentence($typingNow[conv.id]) ?? convSubtitle(conv)}");
	});

	test("a room's row shows the mark for its hash, and says who in its tooltip", () => {
		const rooms = source("ChannelsSidebar.svelte");
		expect(rooms).toMatch(/\{#if typers\}\s*<TypingMark users=\{typers\} \/>\s*\{:else if channel\.type === "text"\}/);
		expect(rooms).toContain("title={typing ? `${channel.name} · ${typing}` : channel.name}");
	});

	test("a tab's mark, wherever tabs show, takes the place and size of its icon", () => {
		expect(source("TabIcon.svelte")).toMatch(
			/\{#if typers\}\s*<TypingMark\s+users=\{typers\}\s+size=\{isConversationTab\(tab\) \? size \+ 4 : size\}/,
		);
		expect(source("TabBar.svelte")).toContain("{@const typing = typingSentence($typingNow[tab.channelId])}");
	});

	// The redesign (#357) draws every unfolded Space as its rooms' tree (ChannelsSidebar, above) in place of the short
	// list of rooms with news a Space that wasn't selected had: the mark shows on the room's own row there.
	test("a Space's rooms in the sidebar, and the open chats in the column, show it too", () => {
		const nav = source("SpaceNav.svelte");
		expect(nav).toMatch(/\{#if open\}\s*<ChannelsSidebar/);
		expect(nav).toMatch(/typingSentence\(\$typingNow\[tab\.channelId\]\) \?\?\s*\(isConversationTab\(tab\)/);
	});
});
