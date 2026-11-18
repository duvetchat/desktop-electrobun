import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEmojiData } from "$lib/emoji";
import type { GatewaySpace } from "$lib/types";
import { tags } from "./server-render";

const { default: EmojiPicker } = await import("./EmojiPicker.svelte");

const props = { onSelect: () => {} };

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
	const source = readFileSync(join(import.meta.dir, "EmojiPicker.svelte"), "utf8");
	const start = source.lastIndexOf("<div", source.indexOf('aria-label="Emoji categories"'));
	const row = source.slice(start, source.indexOf("{#each", start));
	expect(row).toContain("onwheel={(e) => scrollSideways(e, e.currentTarget)}");
});
