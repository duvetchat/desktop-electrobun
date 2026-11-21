import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEmojiData } from "$lib/emoji";
import { emojiUsed } from "$lib/recent-emoji";
import type { GatewaySpace } from "$lib/types";
import { tags, type Tag } from "./server-render";

const { default: EmojiPicker } = await import("./EmojiPicker.svelte");

const props = { onSelect: () => {} };
const source = () => readFileSync(join(import.meta.dir, "EmojiPicker.svelte"), "utf8");
const emoji = (space_id: string, name: string) => ({
	id: `${space_id}-${name}`,
	name,
	space_id,
	attachment_id: `file-${name}`,
	created_at: "",
	updated_at: "",
});
const space = (id: string, name: string): GatewaySpace => ({
	id,
	name,
	description: null,
	banner: null,
	icon: null,
	owner_id: "",
	locale: null,
	member_roles: {},
	room_overwrites: [],
	rooms: [],
	members: [],
	roles: [],
	users: [],
	created_at: "",
	updated_at: "",
});
const groups = [
	{ space: space("s1", "Alpha"), items: [emoji("s1", "wave")] },
	{ space: space("s2", "Beta"), items: [emoji("s2", "party")] },
];

// #339: since #318 the emoji dataset loads as a picker first opens. A picker drawn before it came, with no Space
// emojis, took its first category from the empty list of categories and threw (Cannot read properties of undefined),
// in the message box's picker and in every reaction picker.
test("a picker drawn before the emoji dataset is in draws its search and no category", async () => {
	const drawn = await tags(EmojiPicker, props);
	expect(drawn.some((t) => t.attributes["aria-label"] === "Search emoji")).toBe(true);
	expect(drawn.filter((t) => t.attributes.role === "tab")).toEqual([]);
});

test("once the dataset is in, a picker without Space emojis draws its first category", async () => {
	await loadEmojiData();
	const drawn = await tags(EmojiPicker, props);
	const tabs = drawn.filter((t) => t.attributes.role === "tab");
	expect(tabs[0]!.attributes["aria-label"]).toBe("Smileys & Emotion");
	expect(tabs[0]!.attributes["aria-selected"]).toBe("true");
	expect(drawn.some((t) => t.name === "button" && t.attributes.title === "grinning")).toBe(true);
});

// The custom emojis of every Space the user is in, wherever they write: a tab for each Space with emojis, first, named
// as its Space, then the dataset's categories; the first Space's emojis show.
test("a tab for each Space with emojis comes first, named as its Space, and the first one's emojis show", async () => {
	await loadEmojiData();
	const drawn = await tags(EmojiPicker, { ...props, groups });
	const tabs = drawn.filter((t) => t.attributes.role === "tab");
	expect(tabs.slice(0, 3).map((t) => t.attributes["aria-label"])).toEqual(["Alpha", "Beta", "Smileys & Emotion"]);
	expect(tabs[0]!.attributes["aria-selected"]).toBe("true");
	const shown = drawn.filter((t) => t.name === "button").map((t) => t.attributes.title);
	expect(shown).toContain(":wave:");
	expect(shown).not.toContain(":party:");
});

// Each Space with emojis adds a tab before the dataset's nine, so the row soon passes the picker's width and scrolls
// sideways, with its scrollbar hidden: a mouse, whose wheel only turns up and down, reaches the rest with that wheel.
test("the categories' row scrolls sideways under a mouse wheel", () => {
	const picker = source();
	const start = picker.lastIndexOf("<div", picker.indexOf('aria-label="Emoji categories"'));
	const row = picker.slice(start, picker.indexOf("{#each", start));
	expect(row).toContain("onwheel={(e) => scrollSideways(e, e.currentTarget)}");
});

// #381: the emoji used lately (lib/recent-emoji.ts) lead the picker, as on the mobile app: Recently used is its first tab,
// shown as it opens, the best first. Every pick counts as a use, in the message box's picker as in a reaction's.
test("a pick counts as a use of its emoji, wherever the picker is", () => {
	expect(source()).toMatch(/function pick\(emoji: string\) \{\s*emojiUsed\(emoji\);\s*onSelect\(emoji\);\s*\}/);
});

// The uses below stay for the file's tests after them: the tests before draw a picker with nothing used yet.
const cellsOf = (drawn: Tag[]) =>
	drawn.filter((t) => t.name === "button" && t.attributes.role !== "tab").map((t) => t.attributes.title);

// A custom emoji goes only while one of the user's Spaces has it: one whose Space they left, or that was deleted, takes
// no place in Recently used.
test("a custom emoji no Space of the user's has makes no Recently used", async () => {
	await loadEmojiData();
	emojiUsed("<:01a15f8c-0000-7000-8000-00000000dead:>");
	const drawn = await tags(EmojiPicker, { ...props, groups });
	expect(drawn.filter((t) => t.attributes.role === "tab")[0]?.attributes["aria-label"]).toBe("Alpha");
	expect(cellsOf(drawn)).toEqual([":wave:"]);
});

test("Recently used is the first tab, shown as the picker opens, the best first", async () => {
	await loadEmojiData();
	const now = Date.now();
	emojiUsed("🔥", now - 2000);
	emojiUsed("🔥", now - 2000);
	emojiUsed(`<:${groups[0]!.items[0]!.id}:>`, now - 1000);
	emojiUsed("😂", now - 1000);
	const drawn = await tags(EmojiPicker, { ...props, groups });
	const tabs = drawn.filter((t) => t.attributes.role === "tab");
	expect(tabs.slice(0, 4).map((t) => t.attributes["aria-label"])).toEqual([
		"Recently used",
		"Alpha",
		"Beta",
		"Smileys & Emotion",
	]);
	expect(tabs.map((t) => t.attributes["aria-selected"] === "true")).toEqual(tabs.map((_, i) => i === 0));
	// A Unicode emoji by its dataset's name; two used once at one time by their code. The deleted one isn't there.
	expect(cellsOf(drawn)).toEqual(["fire", ":wave:", "joy"]);
});

test("a Space the user left takes its emojis out of Recently used", async () => {
	await loadEmojiData();
	const drawn = await tags(EmojiPicker, { ...props, groups: [groups[1]!] });
	expect(cellsOf(drawn)).toEqual(["fire", "joy"]);
});
