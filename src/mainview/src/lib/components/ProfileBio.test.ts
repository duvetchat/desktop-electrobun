import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import { readable } from "svelte/store";
import { tags } from "./server-render";

const ANA = "0190a3b2-0000-7000-8000-000000000001";
const BOB = "0190a3b2-0000-7000-8000-000000000002";
const CARL = "0190a3b2-0000-7000-8000-000000000003";
const ME = "0190a3b2-0000-7000-8000-000000000004";
const GONE = "0190a3b2-0000-7000-8000-00000000dead";

mock.module("$lib/stores.svelte", () => ({
	gatewaySpaces: readable([{ users: [{ id: ANA, username: "ana", alias: "Ana" }] }]),
	conversations: readable([{ members: [{ user: { id: BOB, username: "bob", alias: null } }, { user: undefined }] }]),
	friends: readable([{ sender_id: CARL, recipient_id: ME, user: { id: CARL, username: "carl", alias: null } }]),
	currentUser: readable({ id: ME, username: "me", alias: "Myself" }),
}));
const { default: ProfileBio } = await import("./ProfileBio.svelte");

const html = (bio: string) => render(ProfileBio, { props: { bio } }).body;
// What the bio draws, under the element that holds it.
const inside = async (bio: string) => (await tags(ProfileBio, { bio })).slice(1);

const component = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

describe("a bio", () => {
	test("renders the messages' markdown", () => {
		const shown = html("# Hi\n**bold** *it* __under__ ~~gone~~ `code` ||secret||\n- one\n- two\n> quote");
		for (const piece of [
			'<h1 class="msg-h1">Hi</h1>',
			"<strong>bold</strong>",
			"<em>it</em>",
			"<u>under</u>",
			"<del>gone</del>",
			'<code class="msg-inline-code">code</code>',
			'<span class="msg-spoiler" tabindex="0">secret</span>',
			'<ul class="msg-ul"><li>one</li><li>two</li></ul>',
			'<blockquote class="msg-blockquote">quote</blockquote>',
		])
			expect(shown).toContain(piece);
	});

	test("keeps its line breaks", () => {
		expect(html("one\ntwo\n\nthree")).toContain("one<br>two<br><br>three");
		expect(html("one\nhttps://a.example/\ntwo")).toMatch(/one<br>[^]*<a [^>]*>https:\/\/a\.example\/<\/a>[^]*<br>two/);
	});

	test("takes raw HTML as text, whatever it is", async () => {
		for (const bio of [
			"<img src=x onerror=alert(1)>",
			"<script>alert(1)</script>",
			'<a href="javascript:alert(1)">x</a>',
			"<svg onload=alert(1)>",
			'"><iframe src=https://a.example/>',
			"<style>*{display:none}</style>",
		])
			expect(
				(await inside(bio)).filter((tag) => tag.name !== "a" || tag.attributes.href?.startsWith("javascript")),
			).toEqual([]);
		expect(html("<b>x</b>")).toContain("&lt;b&gt;x&lt;/b&gt;");
	});

	test("takes no mark of the renderer's own", async () => {
		const shown = html("`a` \x00I0\x01 \x00B0\x01 \x00L0\x00 \x01");
		expect(shown).not.toMatch(/[\x00\x01]/);
		expect(shown).not.toContain("undefined");
		expect(await inside("\x00B0\x01 \x00L0\x01")).toEqual([]);
	});

	test("links only to http(s), each opening apart from the app, as a message's do", async () => {
		const links = async (bio: string) => (await inside(bio)).filter((tag) => tag.name === "a");
		for (const bio of ["[md](https://a.example/x)", "bare https://a.example/x and more"]) {
			const [link, ...others] = await links(bio);
			expect(others).toEqual([]);
			expect(link!.attributes).toMatchObject({
				href: "https://a.example/x",
				target: "_blank",
				rel: "noopener noreferrer",
			});
		}
		for (const bio of [
			"[x](javascript:alert(1))",
			"[x](data:text/html,x)",
			"javascript:alert(1)",
			"duvet://channels/a/b/c",
			"[x](duvet://channels/a/b/c)",
		])
			expect(await links(bio)).toEqual([]);
	});

	test("can't end a link's href with a quote of its own", async () => {
		const [link] = (await inside('[x](https://a.example/"onmouseover="alert(1))')).filter((tag) => tag.name === "a");
		expect(link!.attributes.href).toBe('https://a.example/"onmouseover="alert(1');
		expect(Object.keys(link!.attributes)).not.toContain("onmouseover");
	});

	test("names who it mentions as the app knows them, from a space, a conversation, a friend or the user", () => {
		const shown = html(`<@${ANA}> <@${BOB}> <@${CARL}> <@${ME}>`);
		for (const name of ["Ana", "bob", "carl", "Myself"]) expect(shown).toContain(`>@${name}<`);
	});

	test("shows the start of the ID of someone the app doesn't know", () => {
		expect(html(`<@${GONE}>`)).toContain(`>@${GONE.slice(0, 8)}<`);
	});

	test("has no room or custom emoji of anyone's: a room reads #unknown, and a custom emoji draws no image", async () => {
		const room = html(`<#${ANA}>`);
		expect(room).toContain("#unknown");
		expect(room).not.toContain("data-room-id");
		expect((await inside(`<:${ANA}:>`)).filter((tag) => tag.name === "img")).toEqual([]);
	});

	test("of emojis alone is large, as such a message is", () => {
		expect(html("😀😀")).toContain("emoji-large");
		expect(html("😀 hi")).not.toContain("emoji-large");
		expect(html("😀😀😀😀😀😀")).not.toContain("emoji-large");
	});

	// Scrolling one way makes the other auto too, and a heading's line height of 1.2 is less than some fonts need: a bio
	// ending in one, in the font the app falls back to, got a scrollbar 10 px wide for the 1 px it could scroll.
	test("scrolls sideways alone, however its last line sits in its font", async () => {
		const [root] = await tags(ProfileBio, { bio: "# Hi" });
		expect(root!.attributes.class!.split(/\s+/)).toEqual(
			expect.arrayContaining(["overflow-x-auto", "overflow-y-hidden"]),
		);
	});

	test("takes no click on a mention, and hears its copy button's", () => {
		const source = component("ProfileBio.svelte");
		expect(source).toContain("[&_.msg-mention]:pointer-events-none");
		expect(source).toContain("onclick={copyCode}");
	});
});

test("the profile card and the popover show the bio through it", () => {
	for (const file of ["MemberProfileCard.svelte", "MemberProfilePopover.svelte"]) {
		const source = component(file);
		expect(source).toContain("<ProfileBio bio={member.bio} />");
		expect(source).not.toContain("{member.bio}<");
	}
});
