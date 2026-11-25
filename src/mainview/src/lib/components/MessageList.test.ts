import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRawSnippet } from "svelte";
import { render } from "svelte/server";
import { tags } from "./server-render";
import { MessageType, type MemberOnSidebar, type Message } from "$lib/types";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules the list imports use $state, which only Svelte's compiler knows: the value itself here.
// And the page a message's Duvet links are read against (window.location).
Object.assign(globalThis, {
	$state: <T>(value: T) => value,
	window: globalThis,
	location: new URL("http://localhost:5173/app"),
});
const { default: MessageList } = await import("./MessageList.svelte");
const { currentUser } = await import("$lib/stores.svelte");

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");
const intro = createRawSnippet(() => ({ render: () => "<p>The start of #general.</p>" }));
const message: Message = {
	id: "0190a3b2-0000-7000-8000-00000000aaaa",
	content: "Welcome to Alpha.",
	type: 0,
	author_id: "0190a3b2-0000-7000-8000-000000000002",
	author_name: "Ana",
	author_avatar_url: null,
	author_is_bot: false,
	created_at: "2026-11-01T10:00:00Z",
	updated_at: "2026-11-01T10:00:00Z",
};
const retry = () => {};
type Props = { messages?: Message[]; isInitialLoading?: boolean; retryFirstPage?: (() => void) | null };
const props = (p: Props) => ({ messages: [], channelId: "room", intro, ...p });
const shown = (p: Props) => render(MessageList, { props: props(p) }).body;
const FAILED = "Couldn't load messages";

// A room's or a conversation's first page that failed (an error, or no answer in 20 s) left an empty list, which showed
// the chat's start as if it had no messages, until its next visit.
describe("a chat whose first page failed", () => {
	test("says so in its empty list, with Try again, rather than showing the chat's start", async () => {
		const html = shown({ retryFirstPage: retry });
		expect(html).toContain(FAILED);
		expect(html).not.toContain("The start of #general.");
		const buttons = (await tags(MessageList, props({ retryFirstPage: retry }))).filter((t) => t.name === "button");
		expect(buttons).toHaveLength(1);
		expect(html).toMatch(/<button[^>]*>\s*Try again\s*<\/button>/);
	});

	test("shows the skeleton again while Try again asks for the page", () => {
		const html = shown({ retryFirstPage: retry, isInitialLoading: true });
		expect(html).not.toContain(FAILED);
		expect(html).toContain("animate-pulse");
	});

	test("shows what came meanwhile (a message sent, or one that arrived) rather than the failure", () => {
		const html = shown({ retryFirstPage: retry, messages: [message] });
		expect(html).not.toContain(FAILED);
		expect(html).toContain("Welcome to Alpha.");
	});

	test("a first page that came back empty shows the chat's start, as before", () => {
		const html = shown({});
		expect(html).toContain("The start of #general.");
		expect(html).not.toContain(FAILED);
	});

	test("a room and a conversation mark it as their first page fails, and Try again asks for that page again", () => {
		const pane = source("PaneView.svelte");
		expect(pane).toMatch(
			/loadedChannels\.delete\(channelId\);\s*channelLoadFailed\[channelId\] = true;\s*channelInitialLoading\[channelId\] = false;/,
		);
		expect(pane).toContain(
			"retryFirstPage={node.activeChannelId && channelLoadFailed[node.activeChannelId] ? retryActiveRoom : null}",
		);
		expect(pane).toMatch(/function retryActiveRoom\(\) \{[^}]*loadFirstPage\(node\.activeChannelId\);/);
		const conversation = source("ConversationView.svelte");
		expect(conversation).toMatch(
			/loadMessages\(\)\.then\(\(loaded\) => \{\s*if \(gone\) return;\s*loadFailed = !loaded;/,
		);
		expect(conversation).toContain("retryFirstPage={loadFailed ? loadFirstPage : null}");
		expect(source("Chat.svelte")).toMatch(/<MessageList\b[\s\S]*?\{retryFirstPage\}[^/]*\/>/);
	});
});

// A group's call that ended before the user joined the group never rang them (#261): its notice, and a reply's quote of
// it, say who started it, without a red phone. A call after they joined, which they weren't in, they missed.
describe("a group's call notices", () => {
	const ME = "0190a3b2-0000-7000-8000-000000000001";
	const ANA = message.author_id;
	const BEA = "0190a3b2-0000-7000-8000-000000000003";
	const GROUP = "0190a3b2-0000-7000-8000-00000000c0c0";
	// Each member's membership ID, minted as they joined: the user joined between the two calls, after their account.
	const member = (id: string, memberId: string, username: string): MemberOnSidebar => ({
		id,
		member_id: memberId,
		username,
		raw_username: username,
		avatar_url: null,
		banner_url: null,
		status: "online",
		mobile_only: false,
		badges: 0,
		is_bot: false,
		is_owner: false,
		roles: [],
		bio: "",
	});
	const members = [
		member(ANA, "0190a3b0-0000-7000-8000-00000000000a", "Ana"),
		member(BEA, "0190a3b0-0000-7000-8000-00000000000b", "Bea"),
		member(ME, "0190a3c2-0000-7000-8000-0000000b0000", "me"),
	];
	const notice = (id: string, participants: string[]): Message => ({
		...message,
		id,
		content: null,
		type: MessageType.Call,
		call: { participants, started_at: "2026-11-01T10:00:00Z", ended_at: "2026-11-01T10:20:00Z" },
	});
	const before = notice("0190a3c1-0000-7000-8000-00000000ca11", [ANA, BEA]);
	const after = notice("0190a3c3-0000-7000-8000-00000000ca12", [ANA, BEA]);
	const reply: Message = {
		...message,
		id: "0190a3c4-0000-7000-8000-00000000bbbb",
		content: "Sorry I missed it",
		author_id: BEA,
		author_name: "Bea",
		referenced_message: {
			type: 0,
			message_id: before.id,
			room_id: null,
			space_id: null,
			content: null,
			author_id: ANA,
			author_name: "Ana",
			author_avatar: null,
			created_at: before.created_at,
		},
	};
	beforeEach(() =>
		currentUser.set({
			id: ME,
			username: "me",
			email_verified: true,
			alias: null,
			avatar: null,
			banner: null,
			custom: "",
			flags: 0,
			badges: 0,
			is_bot: false,
			created_at: "",
			updated_at: "",
		}),
	);
	afterEach(() => currentUser.set(null));

	// The list's text, and its phones: how many, and how many are red.
	async function reads(messages: Message[]) {
		const p = { messages, channelId: GROUP, spaceId: "", members, intro };
		const text = render(MessageList, { props: p }).body.replace(/<[^>]*>/g, "");
		const phones = (await tags(MessageList, p)).filter(
			(t) => t.name === "svg" && !!t.attributes.class?.includes("lucide-phone"),
		);
		const red = phones.filter((t) => t.attributes.class!.split(/\s+/).includes("text-duvet-danger"));
		return { text, phones: phones.length, red: red.length };
	}
	const BEFORE_SAYS = "Ana started a call that lasted 20 minutes.";

	test("one from before the user joined says who started it, without a red phone", async () => {
		expect(await reads([before])).toEqual({ text: expect.stringContaining(BEFORE_SAYS), phones: 1, red: 0 });
		expect((await reads([notice(before.id, [ANA])])).text).toContain("Ana started a call. No one answered.");
	});

	test("a reply's quote of it says the same", async () => {
		const quoted = await reads([before, reply]);
		expect(quoted.text.split(BEFORE_SAYS)).toHaveLength(3);
		expect(quoted).toMatchObject({ phones: 2, red: 0 });
	});

	test("one from after, which the user wasn't in, they missed", async () => {
		expect(await reads([after])).toEqual({
			text: expect.stringContaining("You missed a call from Ana that lasted 20 minutes."),
			phones: 1,
			red: 1,
		});
	});

	// A thread's dialog opens on a click, which a render on the server can't make: its root and its quotes read their
	// notices as the list does.
	test("a thread reads them as the list does", () => {
		for (const file of ["MessageList.svelte", "MessagePreview.svelte"]) {
			const calls = source(file).match(/callNotice\([^)]*\)/g) ?? [];
			expect(calls.length).toBeGreaterThan(0);
			for (const call of calls) expect(call).toEndWith(", joined)");
		}
	});
});

// #319: bits-ui's Portal mounts what it holds as it's created, open or not: every message row mounted its reaction
// picker's portal under <body>, with its popover's state, for a picker nobody opened. A row's mounts only while open.
test("a row's reaction picker mounts its portal only while it's open", () => {
	const list = readFileSync(join(import.meta.dir, "MessageList.svelte"), "utf8");
	// One hover bar for the user's messages and the others' (#357): one picker.
	const guarded = list.match(/\{#if reactingMessageId === message\.id\}\s*<Popover\.Portal>/g) ?? [];
	expect(guarded).toHaveLength(1);
	expect(list.match(/<Popover\.Portal>/g)).toHaveLength(1);
	// And so does its More menu's: left mounted, scrolling a long chat with the pointer over it kept 75 MB of menus (#357).
	expect(list.match(/\{#if moreMenuFor === message\.id\}\s*<DropdownMenu\.Portal>/g)).toHaveLength(1);
	expect(list.match(/<DropdownMenu\.Portal>/g)).toHaveLength(1);
});

// #322: these lists kept their messages in $state, which Svelte 5 makes deep proxies (a signal for each property read,
// a proxy for each nested object), for lists only ever replaced whole.
test("pins, a thread's messages and search results are kept as they are, not as deep proxies", () => {
	expect(source("PinnedMessages.svelte")).toContain("let pins = $state.raw<Message[]>([]);");
	const list = source("MessageList.svelte");
	expect(list).toContain("let threadMessages = $state.raw<Message[]>([]);");
	expect(list).toContain("let threadRootMessage = $state.raw<Message | null>(null);");
	expect(source("MessageSearch.svelte")).toContain("let results = $state.raw<Result[]>([]);");
});

// #324: the list's sort made two Dates per comparison, every time the list changed.
test("the list's sort reads each message's date once", () => {
	const list = readFileSync(join(import.meta.dir, "MessageList.svelte"), "utf8");
	expect(list).toContain(".map((m, i) => ({ m, i, at: Date.parse(m.created_at) }))");
	expect(list).toContain("return b.at - a.at;");
	expect(list).not.toContain("new Date(b.m.created_at)");
});

// #326: every row mounted its action toolbar, hidden until hovered: the reaction popover's state, six or seven buttons and
// their icons, for each message of the list.
describe("a row's action toolbar", () => {
	test("isn't mounted until its row is hovered", () => {
		const me = "0190a3b2-0000-7000-8000-000000000001";
		currentUser.set({
			id: me,
			username: "me",
			email_verified: true,
			alias: null,
			avatar: null,
			banner: null,
			custom: "",
			flags: 0,
			badges: 0,
			is_bot: false,
			created_at: "",
			updated_at: "",
		});
		const mine = {
			...message,
			id: "0190a3b2-0000-7000-8000-00000000bbbb",
			author_id: me,
		};
		const html = shown({ messages: [message, mine] });
		currentUser.set(null);
		expect(html).toContain("Welcome to Alpha.");
		expect(html).not.toContain('aria-label="Reply"');
		expect(html).not.toContain('aria-label="Edit message"');
		expect(html).not.toContain('aria-label="Add reaction"');
	});

	test("shows on the row the pointer is on, followed from the list by one handler, and while its picker is open", () => {
		const list = source("MessageList.svelte");
		expect(list).toContain("onmouseover={hoverRow}");
		expect(list).toContain("hoveredMessageId = row?.dataset.messageId ?? null;");
		// Also while its More menu is open, and on the row the keyboard's focus is in. One condition (barShown), which each
		// layout's row asks: bubbles and flat rows.
		expect(list).toMatch(
			/\{@const barShown =\s*\(hoveredMessageId === message\.id \|\|\s*focusedMessageId === message\.id \|\|\s*reactingMessageId === message\.id \|\|\s*moreMenuFor === message\.id\) &&\s*!isPending &&/,
		);
		expect(list.match(/\{:else if barShown\}\s*\{@render hoverBar\(/g)).toHaveLength(2);
		expect(list).not.toContain("hidden group-hover:flex");
		expect(list).not.toContain("group-hover/row:flex");
	});

	// #357: the keyboard reaches the bar too (lib/message-focus.ts), by one tab stop for the whole list.
	test("shows on the message the keyboard's focus is in, and the list has one tab stop", () => {
		const list = source("MessageList.svelte");
		for (const handler of ["onfocusin={focusRow}", "onfocusout={blurRow}", "onkeydown={rowKeys}"])
			expect(list).toContain(handler);
		// Every layout's row is the stop or is reached from it: a notice, a flat row, a bubble's row.
		expect(
			list.match(/data-message-id=\{message\.id\}\s*tabindex=\{tabStopId === message\.id \? 0 : -1\}/g),
		).toHaveLength(3);
		// A click's focus mounts nothing: only the keyboard's.
		expect(list).toContain('e.target.matches(":focus-visible")');
	});
});

// #357: bubbles on Apple's systems, flat rows elsewhere, each a setting; groups show their author once and their time
// once.
describe("the two layouts", () => {
	const ME = "0190a3b2-0000-7000-8000-000000000001";
	const ANA = message.author_id;
	const ROOM = "0190a3b2-0000-7000-8000-00000000c001";
	const DM = "0190a3b2-0000-7000-8000-00000000d001";
	const at = (minute: number) => new Date(2026, 10, 1, 10, minute).toISOString();
	const from = (id: string, author: string, name: string, minute: number, content: string): Message => ({
		...message,
		id: `0190a3b2-0000-7000-8000-0000000000${id}`,
		author_id: author,
		author_name: name,
		content,
		created_at: at(minute),
		updated_at: at(minute),
	});
	const talk = [
		from("01", ANA, "Ana", 0, "first of two"),
		from("02", ANA, "Ana", 1, "second of two"),
		from("03", ME, "me", 2, "my own words"),
		from("04", ANA, "Ana", 3, `look <@${ME}>`),
	];
	const list = (p: Record<string, unknown>) =>
		render(MessageList, { props: { messages: talk, channelId: ROOM, spaceId: "space", intro, ...p } }).body;
	const count = (html: string, text: string) => html.split(text).length - 1;

	// What these say is how each layout draws, not which one a system picks: bubbles are the default on Apple's systems
	// alone (lib/message-layout.ts), so they are chosen here and the platform's default put back after.
	beforeEach(async () => {
		currentUser.set({
			id: ME,
			username: "me",
			email_verified: true,
			alias: null,
			avatar: null,
			banner: null,
			custom: "",
			flags: 0,
			badges: 0,
			is_bot: false,
			created_at: "",
			updated_at: "",
		});
		(await import("$lib/stores/message-layout.svelte")).messageLayout.value = "bubbles";
	});
	afterEach(async () => {
		currentUser.set(null);
		const { messageLayout } = await import("$lib/stores/message-layout.svelte");
		const { defaultMessageLayout } = await import("$lib/message-layout");
		messageLayout.value = defaultMessageLayout();
	});

	test("in bubbles, the user's own is in azure and the others' on the card", () => {
		const html = list({});
		expect(html).toMatch(/class="[^"]*\bmsg-own bg-duvet-azure\b[^"]*"[^>]*>(?:(?!<\/div>)[\s\S])*my own words/);
		expect(html).toMatch(/class="[^"]*\bbg-duvet-card\b[^"]*"[^>]*>(?:(?!<\/div>)[\s\S])*first of two/);
		expect(html).not.toContain("grid-cols-[52px_minmax(0,1fr)]");
	});

	test("a group names its author once, over its first bubble, and never the user", () => {
		const html = list({});
		// Ana's two messages a minute apart are one group; her third, after the user's, is another.
		expect(count(html, ">Ana</")).toBe(2);
		expect(html).not.toContain(">me</");
	});

	test("a mention of the user lights its bubble, and nobody else's", () => {
		const html = list({});
		expect(count(html, "animate-prism-arrive")).toBe(1);
		expect(html).toMatch(/animate-prism-arrive[\s\S]*?look /);
	});

	test("a direct conversation's bubbles name nobody; a group's do", async () => {
		const { conversations } = await import("$lib/stores.svelte");
		const conversation = (type: 1 | 2) => [
			{ id: DM, type, name: null, owner_id: ANA, created_at: "", updated_at: "", deleted_at: null, members: [] },
		];
		conversations.set(conversation(1));
		expect(list({ channelId: DM, spaceId: "" })).not.toContain(">Ana</");
		conversations.set(conversation(2));
		expect(count(list({ channelId: DM, spaceId: "" }), ">Ana</")).toBe(2);
		conversations.set([]);
	});

	test("flat rows are the other choice: every author named, the user too, and a mention washes its row", async () => {
		(await import("$lib/stores/message-layout.svelte")).messageLayout.value = "flat";
		const html = list({});
		expect(count(html, "grid-cols-[52px_minmax(0,1fr)]")).toBe(4);
		expect(count(html, ">Ana</")).toBe(2);
		expect(count(html, ">me</")).toBe(1);
		expect(html).not.toContain("bg-duvet-azure");
		expect(html).not.toContain("animate-prism-arrive");
		expect(html).toContain("radial-gradient(420px_80px_at_60px_50%");
	});

	test("the list reads the saved layout and the groups from their modules", () => {
		const component = source("MessageList.svelte");
		expect(component).toContain('const flat = $derived(messageLayout.value === "flat");');
		expect(component).toContain("const shapes = $derived(groupShapes(sortedMessages, unreadDividerIdx));");
	});
});

// #381: a message's hover bar and its menu's first row react at one click with the Unicode emoji used most lately, then
// their own three and five (quickReactions in lib/recent-emoji.ts), as the mobile app's quick reactions do. Each row is
// ranked as it mounts, so it doesn't reorder under the pointer. Adding a reaction there counts as a use of its emoji,
// as a pick in the picker does; taking one back doesn't.
test("the quick reactions lead with the emoji used lately, and adding one counts as a use", () => {
	const list = source("MessageList.svelte");
	expect(list).toContain("{#each quickReactions(QUICK_REACTIONS, recentEmoji()) as emoji (emoji)}");
	expect(list).toContain("{#each quickReactions(MENU_REACTIONS, recentEmoji()) as emoji (emoji)}");
	expect(list.match(/\(\) => quickReact\(message, emoji\)/g)).toHaveLength(2);
	expect(list).toMatch(
		/function quickReact\(message: Message, emoji: string\) \{\s*if \(\$currentUser && !reactedWith\(message, \$currentUser\.id, emoji\)\) emojiUsed\(emoji\);\s*handleReactionToggle\(message, emoji\);\s*\}/,
	);
	// A chip under the message adds the user's reaction to someone else's: no use, as on the mobile app.
	const chips = /onToggle=\{\(r\) => handleReactionToggle\(message, r\.emoji_name, r\.emoji_id\)\}/g;
	expect(list.match(chips)).toHaveLength(2);
});

// A message is edited where it is (#357): its own text becomes a box, with Save and Discard, instead of the chat's
// message box taking the text away from it.
describe("editing a message", () => {
	const list = source("MessageList.svelte");
	const editor = source("InlineMessageEditor.svelte");

	test("a double click or the Edit button turns its text into a box in its row", () => {
		expect(list).toContain("e.detail === 2");
		expect(list).toContain("<InlineMessageEditor");
		expect(list).toContain("onSave={(text) => onSaveEdit?.(message.id, text)}");
		expect(list).toContain("onCancel={() => (editingMessageId = null)}");
		expect(list).toMatch(/editable\(message, mine\)[\s\S]*?<IconButton label="Edit message"/);
	});

	test("the box saves or discards, and Esc or Ctrl/⌘ Enter leave it", () => {
		expect(editor).toContain("<textarea");
		expect(editor).toContain("Save");
		expect(editor).toContain("Discard edit");
		expect(editor).toContain('event.key === "Escape"');
		expect(editor).toContain("event.metaKey || event.ctrlKey");
	});

	test("the chat saves it there, not in the message box", () => {
		const chat = source("Chat.svelte");
		expect(chat).toContain("onSaveEdit={saveEdit}");
		expect(chat).not.toContain("bind:editContent");
		expect(chat).not.toContain("Editing your message");
	});
});

test("a message's More menu copies its text above its link", () => {
	const list = source("MessageList.svelte");
	const text = list.indexOf(">Copy text<");
	const link = list.indexOf(">Copy message link<");
	expect(text).toBeGreaterThan(-1);
	expect(text).toBeLessThan(link);
	expect(list).toMatch(
		/function copyText\(message: Message\) \{\s*const text = messageText\(message\);\s*if \(text\) navigator\.clipboard\.writeText\(text\)\.catch\(console\.error\);\s*\}/,
	);
});
