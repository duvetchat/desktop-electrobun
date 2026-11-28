import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import { readable, writable } from "svelte/store";
import { tags, type Tag } from "./server-render";
import { MessageType, type MemberOnSidebar, type Message } from "$lib/types";

const ME = "0190a3b2-0000-7000-8000-000000000001";
const ANA = "0190a3b2-0000-7000-8000-000000000002";
const SPACE = "0190a3b2-0000-7000-8000-0000000005a0";
const ROOM = "0190a3b2-0000-7000-8000-0000000005a1";
const QUOTED = "0190a3b2-0000-7000-8000-00000000a0a0";

// The page Duvet's own links are read against (window.location), and the app's host, which no embed frames.
Object.assign(globalThis, { window: globalThis, location: new URL("http://localhost:5173/app") });

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
mock.module("facehash-sv", () => facehash);
mock.module("$lib/stores.svelte", () => ({
	currentUser: readable({ id: ME, username: "me" }),
	roomNames: readable({ [ROOM]: "general" }),
	gatewaySpaces: readable([
		{ id: SPACE, name: "Alpha", rooms: [{ id: ROOM, name: "general" }], users: [], members: [] },
	]),
	conversations: readable([]),
	jumpToMessageRequest: writable(null),
	botInviteRequest: writable(null),
	spaceInviteRequest: writable(null),
	reactorsRequest: writable(null),
	userSession: { token: null },
	openRoomMention: () => {},
}));
const { default: MessagePreview } = await import("./MessagePreview.svelte");

const message = (fields: Partial<Message>): Message => ({
	id: "0190a3b2-0000-7000-8000-00000000aaaa",
	content: "",
	type: 0,
	author_id: ANA,
	author_name: "Ana",
	author_avatar_url: null,
	author_is_bot: false,
	created_at: "2026-11-01T10:00:00Z",
	updated_at: "2026-11-01T10:00:00Z",
	...fields,
});

// Ana, whose role has a colour.
const members = [
	{
		id: ANA,
		member_id: "m",
		username: "Ana",
		raw_username: "ana",
		avatar_url: null,
		banner_url: null,
		status: "online",
		mobile_only: false,
		badges: 0,
		is_bot: false,
		is_owner: false,
		roles: [
			{
				id: "r",
				name: "Red",
				color_from: 0xe5484d,
				color_via: null,
				color_to: null,
				permissions: 0,
				hoisted: false,
				position: 1,
			},
		],
		bio: "",
	},
] satisfies MemberOnSidebar[];

const props = (m: Message) => ({ message: m, spaceId: SPACE, channelId: ROOM, members, onPreview: () => {} });
const html = (m: Message) => render(MessagePreview, { props: props(m) }).body;
const drawn = (m: Message) => tags(MessagePreview, props(m));
const named = (found: Tag[], name: string) => found.filter((tag) => tag.name === name);

const MESSAGE_LINK = `https://duvet.chat/channels/${SPACE}/${ROOM}/${QUOTED}`;
const rich = message({
	content: `Read https://example.org/page or this one ${MESSAGE_LINK} and join https://duvet.chat/invite/abc123\n\`\`\`js\nconst a = 1;\n\`\`\``,
	updated_at: "2026-11-01T10:05:00Z",
	embeds: [
		{ type: "rich", title: "Example page", description: "An example", url: "https://example.org/page" },
		{ type: "image", image: { url: "https://media.test/big.png", width: 1200, height: 800 } },
	],
	reactions: [
		{ emoji_name: "👍", emoji_id: null, count: 2, users: [ANA, ME] },
		{ emoji_name: "🎉", emoji_id: null, count: 1, users: [ANA] },
	],
	referenced_message: {
		type: 0,
		message_id: QUOTED,
		room_id: ROOM,
		space_id: SPACE,
		content: "The quoted one",
		author_id: ME,
		author_name: "me",
		author_avatar: null,
		created_at: "2026-11-01T09:00:00Z",
	},
});

// What the message list draws next to a message's text, the previews (pins, search results, a thread) draw too, through
// the same pieces (desktop#87).
describe("a message's preview", () => {
	test("links its bare links, each opening apart from the app", async () => {
		const links = named(await drawn(rich), "a").filter((a) => a.attributes.href === "https://example.org/page");
		// The text's, the link preview's title, and the open action floating on it.
		expect(links).toHaveLength(3);
		for (const link of links) expect(link.attributes).toMatchObject({ target: "_blank", rel: "noopener noreferrer" });
	});

	test("shows a message link as its room's chip and its card, and an invite's link as a button and its card", async () => {
		const buttons = named(await drawn(rich), "button");
		expect(buttons.some((b) => b.attributes.title === "Alpha › #general")).toBe(true);
		const shown = html(rich);
		expect(shown).toContain(">https://duvet.chat/invite/abc123</button>");
		// The cards as they load: the message's, and the invite's skeleton.
		expect(shown).toContain("Loading message…");
		expect(shown).toMatch(
			/rounded-card mt-2 max-w-xs border p-4"><div class="bg-duvet-ink\/10 mb-3 h-3 w-44 animate-pulse rounded"/,
		);
	});

	// #250: each piece of a text between its bare links rendered on its own, so one that started with " - " was a list,
	// and a link in a list item went out of the list.
	test("reads the text around its links as one: what follows a link goes on its line, and a list stays one", () => {
		const after = html(message({ content: "see https://example.org/x - and more" }));
		expect(after).not.toContain("<ul");
		expect(after).toMatch(/>https:\/\/example\.org\/x<\/a> - and more/);
		expect(html(message({ content: "- one https://example.org/x\n- two" }))).toMatch(
			/<ul class="msg-ul"><li>one <a [^>]*>https:\/\/example\.org\/x<\/a><\/li><li>two<\/li><\/ul>/,
		);
	});

	test("shows its link previews, at a preview's size", async () => {
		expect(html(rich)).toContain("Example page");
		const images = named(await drawn(rich), "img").filter((i) => i.attributes.src === "https://media.test/big.png");
		expect(images).toHaveLength(1);
		expect(images[0]!.attributes.class!.split(/\s+/)).toEqual(expect.arrayContaining(["max-h-60", "max-w-80"]));
	});

	test("shows its reactions, the user's own picked out, as buttons", async () => {
		const reactions = named(await drawn(rich), "button").filter(
			(b) => b.attributes.title === "👍" || b.attributes.title === "🎉",
		);
		expect(reactions.map((b) => b.attributes.title)).toEqual(["👍", "🎉"]);
		expect(reactions[0]!.attributes.class).toContain("bg-duvet-chosen");
		expect(reactions[1]!.attributes.class).not.toContain("bg-duvet-chosen");
	});

	test("shows the reply's quote, that it was edited, and its code block's copy button", () => {
		const shown = html(rich);
		expect(shown).toContain("The quoted one");
		expect(shown).toContain("(edited)");
		expect(shown).toMatch(/<button class="msg-code-copy" data-code="const a = 1;"/);
	});

	test("colours its author's name as their role does", async () => {
		const name = named(await drawn(rich), "span").find((s) => s.attributes.style === "color: #e5484d");
		expect(name).toBeDefined();
	});

	test("shows a message of only emojis large", async () => {
		const emojis = named(await drawn(message({ content: "😀😀😀" })), "img");
		expect(emojis).toHaveLength(3);
		for (const emoji of emojis) expect(emoji.attributes.class!.split(/\s+/)).toContain("emoji-large");
	});

	test("says who used a bot's command, and tags a bot's and a webhook's messages", () => {
		const used = html(
			message({
				content: "Pong!",
				author_name: "botty",
				author_is_bot: true,
				interaction_metadata: {
					id: "i",
					type: 2,
					user: { id: ME, username: "me", alias: null, avatar: null },
					name: "ping",
				},
			}),
		);
		// One sentence (chat_interaction_used), drawn by Rich: its pieces come with the server render's markers.
		expect(used.replace(/<!--[^>]*-->/g, "")).toMatch(/>me<\/span> used <span[^>]*>\/ping<\/span>/);
		expect(used).toContain(">BOT</span>");
		expect(html(message({ content: "Hi", webhook_id: "w" }))).toContain(">WEBHOOK</span>");
	});

	test("says a bot is thinking on its deferred response", () => {
		const now = new Date().toISOString();
		const thinking = message({
			content: "",
			author_name: "botty",
			author_is_bot: true,
			flags: 1 << 7,
			created_at: now,
		});
		expect(html(thinking)).toContain("botty is thinking");
	});

	// What someone else wrote stays text: the text's markdown keeps renderMarkdown's rules, and an embed's URLs
	// webEmbed's (http(s) only).
	test("takes no markup and no other scheme from the message", async () => {
		const hostile = message({
			content: "[x](javascript:alert(1)) javascript:alert(2) <img src=x onerror=alert(3)> <script>alert(4)</script>",
			embeds: [{ type: "rich", title: "Bad", url: "javascript:alert(5)", image: { url: "javascript:alert(6)" } }],
		});
		const found = await drawn(hostile);
		for (const tag of found) {
			for (const [name, value] of Object.entries(tag.attributes)) {
				expect(name.startsWith("on")).toBe(false);
				expect(value).not.toMatch(/^\s*javascript:/i);
			}
		}
		expect(named(found, "script")).toEqual([]);
		expect(html(hostile)).toContain("&lt;img src=x onerror=alert(3)&gt;");
	});
});

// A thread can start at a call notice. A group's call that ended before the user joined the group never rang them
// (#261).
describe("a call notice's preview", () => {
	const GROUP = "0190a3b2-0000-7000-8000-00000000c0c0";
	const BEA = "0190a3b2-0000-7000-8000-000000000003";
	// The user's membership of the group, minted as they joined it, after their account: one call ended before it, the
	// other after.
	const JOINED = "0190a3c2-0000-7000-8000-0000000b0000";
	const BEFORE = "0190a3c1-0000-7000-8000-00000000ca11";
	const AFTER = "0190a3c3-0000-7000-8000-00000000ca12";
	const inGroup = [
		...members,
		{ ...members[0]!, id: ME, member_id: JOINED, username: "me", raw_username: "me", roles: [] },
	];
	const notice = (id: string, participants: string[]) =>
		message({
			id,
			type: MessageType.Call,
			call: { participants, started_at: "2026-11-01T10:00:00Z", ended_at: "2026-11-01T10:20:00Z" },
		});
	const groupProps = (m: Message) => ({
		message: m,
		spaceId: "",
		channelId: GROUP,
		members: inGroup,
		onPreview: () => {},
	});
	// The notice's sentence, and whether its phone is red.
	async function reads(m: Message) {
		const text = render(MessagePreview, { props: groupProps(m) }).body.replace(/<[^>]*>/g, "");
		const phone = named(await tags(MessagePreview, groupProps(m)), "svg").find((svg) =>
			svg.attributes.class?.includes("lucide-phone"),
		);
		return { text, red: phone?.attributes.class?.split(/\s+/).includes("text-duvet-danger") };
	}

	test("of a call from before the user joined says who started it, without a red phone", async () => {
		const answered = await reads(notice(BEFORE, [ANA, BEA]));
		expect(answered.text).toContain("Ana started a call that lasted 20 minutes.");
		expect(answered.red).toBe(false);
		const unanswered = await reads(notice(BEFORE, [ANA]));
		expect(unanswered.text).toContain("Ana started a call. No one answered.");
		expect(unanswered.red).toBe(false);
	});

	test("of a call from after, which the user wasn't in, says they missed it", async () => {
		const missed = await reads(notice(AFTER, [ANA, BEA]));
		expect(missed.text).toContain("You missed a call from Ana that lasted 20 minutes.");
		expect(missed.red).toBe(true);
	});
});

// A code block's copy button carries its code and no handler: what shows the text hears its click (lib/code-copy.ts).
test("a preview hears its code blocks' copy buttons", () => {
	const preview = readFileSync(join(import.meta.dir, "MessagePreview.svelte"), "utf8");
	expect(preview).toMatch(/<div class="flex flex-col" onclickcapture=\{openRoomMention\} onclick=\{copyCode\}>/);
});
