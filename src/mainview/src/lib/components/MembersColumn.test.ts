import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import { tags } from "./server-render";
import type { MemberOnSidebar } from "$lib/types";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
void mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules the list imports use $state, which only Svelte's compiler knows: the value itself here.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { default: MembersColumn } = await import("./MembersColumn.svelte");
const { default: MemberList } = await import("./MemberList.svelte");

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

const person = (n: number, status: MemberOnSidebar["status"]): MemberOnSidebar => ({
	id: `user-${n}`,
	member_id: `member-${n}`,
	username: `user${n}`,
	raw_username: `user${n}`,
	avatar_url: null,
	banner_url: null,
	status,
	mobile_only: false,
	badges: 0,
	is_bot: false,
	is_owner: false,
	roles: [],
	bio: "",
});
const crew = [person(1, "online"), person(2, "online"), person(3, "offline")];

// #409: a chat's members are back in a column at the right of its pane, with the members list's rows as the popover
// has them (virtualised, grouped, with who's typing), under the popover's head. An <aside>, whose role is complementary.
test("the column is a complementary region named Members, with the list's head and rows", async () => {
	const all = await tags(MembersColumn, { members: crew, channelId: "group-1" });
	const regions = all.filter((tag) => tag.name === "aside");
	expect(regions).toHaveLength(1);
	expect(regions[0]?.attributes["aria-label"]).toBe("Members");
	// 240 px, at the pane's right, past the chat's hairline.
	expect(regions[0]?.attributes.class).toMatch(/(^|\s)w-60(\s|$)/);
	expect(regions[0]?.attributes.class).toMatch(/(^|\s)shrink-0(\s|$)/);
	expect(regions[0]?.attributes.class).toMatch(/(^|\s)border-l(\s|$)/);

	const drawn = render(MembersColumn, { props: { members: crew, channelId: "group-1" } }).body.replace(
		/<!--[^]*?-->/g,
		"",
	);
	expect(drawn).toMatch(/<p[^>]*>Members<\/p>\s*<span[^>]*>2 online<\/span>/);
	for (const name of ["user1", "user2", "user3"]) expect(drawn).toContain(`>${name}</span>`);
	expect(drawn).toContain("Online — 2");
	expect(drawn).toContain("Offline — 1");
});

// The list's sticky headings and the rings around its status dots take the colour it's drawn on, and the column is on
// the pane's: the popover's colour there would draw a band behind each heading.
test("on the pane, the list takes the pane's colour; in the popover, the popover's", async () => {
	const classes = async (props: { surface?: "popover" | "pane" }, part: string) =>
		(await tags(MemberList, { members: crew, channelId: "group-1", ...props }))
			.map((tag) => tag.attributes.class ?? "")
			.filter((cls) => cls.includes(part));
	const onPane = await classes({ surface: "pane" }, "sticky");
	expect(onPane.length).toBeGreaterThan(0);
	for (const cls of onPane) {
		expect(cls).toContain("bg-duvet-bg");
		expect(cls).not.toContain("bg-duvet-pop-ring");
	}
	for (const cls of await classes({}, "sticky")) expect(cls).toContain("bg-duvet-pop-ring");
	// The status dots' rings, one for each member.
	const rings = await classes({ surface: "pane" }, "-bottom-0.5 w-2.5");
	expect(rings).toHaveLength(crew.length);
	for (const cls of rings) expect(cls).toMatch(/(^|\s)text-duvet-bg(\s|$)/);
	for (const cls of await classes({}, "-bottom-0.5 w-2.5")) expect(cls).toMatch(/(^|\s)text-duvet-pop-ring(\s|$)/);

	const inColumn = (await tags(MembersColumn, { members: crew, channelId: "group-1" }))
		.map((tag) => tag.attributes.class ?? "")
		.filter((cls) => cls.includes("sticky"));
	expect(inColumn.length).toBeGreaterThan(0);
	for (const cls of inColumn) expect(cls).toContain("bg-duvet-bg");
});

// What a webview does with it, which a server's render leaves out: the column scrolls on its own, and a Space's members
// come a page at a time as it nears its end, as the popover's do (the list they share, MembersPanel). A new Space's
// list starts at its top.
test("it scrolls and pages as the popover does, and starts over for another Space", () => {
	const column = source("MembersColumn.svelte");
	expect(column).toMatch(
		/<aside\b[^>]*aria-label="Members"[^>]*class="[^"]*\bflex-col\b[^"]*"[^>]*>\s*\{#key pagedSpaceId\}\s*<MembersPanel \{members\} spaceId=\{pagedSpaceId\} \{space\} \{channelId\} \{onRemoveMember\} \{onMention\} surface="pane" \/>\s*\{\/key\}\s*<\/aside>/,
	);
	const panel = source("MembersPanel.svelte");
	expect(panel).toMatch(/<div class="min-h-0 flex-1 overflow-y-auto pb-2" \{onscroll\}>/);
	expect(panel).toMatch(
		/function onscroll\(e: Event\) \{\s*const el = e\.currentTarget as HTMLElement;\s*if \(spaceId && !membersFailed\(spaceId\) && el\.scrollHeight - el\.scrollTop - el\.clientHeight < 150\)\s*void loadMoreMembers\(spaceId\);/,
	);
	// The button in the bar loads the Space's first page, for its faces, whether its list shows in the column or the
	// popover.
	expect(source("MembersButton.svelte")).toMatch(
		/\$effect\(\(\) => \{\s*if \(pagedSpaceId\) void ensureMembers\(pagedSpaceId\);/,
	);
});

// A pane measures itself, the container its bar's search folds in (@container/pane): its chat's members are a column
// from MEMBERS_COLUMN_MIN_PANE px on, and the popover under it (membersColumnOf, lib/members.ts).
test("a pane measures itself, and a text room has its column beside its chat while the panes show", () => {
	const pane = source("PaneView.svelte");
	expect(pane).toMatch(/<div\s+bind:clientWidth=\{paneWidth\}\s+class="bg-duvet-bg @container\/pane /);
	expect(pane).toMatch(
		/const roomColumn = \$derived\(\s*isActive && activeChannel\?\.type === "text" \? membersColumnOf\("rooms", paneWidth\) : undefined,?\s*\);/,
	);
	// The bar's button opens and closes it, or opens the popover without one (a voice room, a narrow pane). A text
	// room's members are mentioned in its box (#423).
	expect(pane).toMatch(
		/<MembersButton\s+space=\{activeTabSpace\}\s+channelId=\{activeTab\.channelId\}\s+column=\{roomColumn\}\s+onMention=\{activeChannel\?\.type === "text" \? mentionInRoom : undefined\}\s*\/>/,
	);
	// The column, at the right of the room's chat, while its kind's is open.
	const text = pane.slice(pane.indexOf("{@const introRoom"));
	const room = text.slice(0, text.indexOf("{:else if activeTab && isConversationTab(activeTab)}"));
	expect(room).toContain("<Chat");
	expect(room).toMatch(
		/<Chat\b[^]*?\/>\s*(?:<!--[^]*?-->\s*)?\{#if roomColumn && activeTabSpace && layoutPrefs\.membersColumn\[roomColumn\]\}\s*<MembersColumn\s+space=\{activeTabSpace\}\s+channelId=\{node\.activeChannelId \?\? ""\}\s+onMention=\{mentionInRoom\}\s*\/>\s*\{\/if\}\s*$/,
	);
	// A conversation's view decides its own, by the same width.
	expect(pane).toMatch(
		/<ConversationView\s+conversation=\{activeConversation\}\s+paneFocused=\{isFocused\}\s+\{paneWidth\}/,
	);
});

test("a group has its column beside its chat; a DM's members open in the popover", () => {
	const view = source("ConversationView.svelte");
	expect(view).toContain(
		'const column = $derived(membersColumnOf(conversation.type === 2 ? "groups" : undefined, paneWidth));',
	);
	expect(view).toMatch(/paneWidth = 0,/);
	const start = view.indexOf("{#snippet actions()}");
	const actions = view.slice(start, view.indexOf("\n{/snippet}", start));
	// Its owner takes members out of a group, from the button's popover and the column alike; any member mentions them
	// in its box (#423).
	expect(view).toContain(
		"const removeMember = $derived(conversation.type === 2 && isOwner ? handleRemoveMember : undefined);",
	);
	expect(actions).toMatch(
		/<MembersButton\s+members=\{convMembers\}\s+channelId=\{conversation\.id\}\s+\{column\}\s+onRemoveMember=\{removeMember\}\s+onMention=\{mentionHere\}\s*\/>/,
	);
	// The column stays beside the chat, or beside what a conversation this app can't open says in its place (Task 34).
	expect(view).toMatch(
		/<Chat\b[^]*?\{paneFocused\}\s*\/>\s*\{\/if\}\s*(?:<!--[^]*?-->\s*)?\{#if column && layoutPrefs\.membersColumn\[column\]\}\s*<MembersColumn\s+members=\{convMembers\}\s+channelId=\{conversation\.id\}\s+onRemoveMember=\{removeMember\}\s+onMention=\{mentionHere\}\s*\/>\s*\{\/if\}/,
	);
});
