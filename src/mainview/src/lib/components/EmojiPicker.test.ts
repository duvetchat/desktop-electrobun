import { expect, test } from "bun:test";
import { loadEmojiData } from "$lib/emoji";
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
	expect(tabs[0].attributes["aria-label"]).toBe("Smileys & Emotion");
	expect(tabs[0].attributes["aria-selected"]).toBe("true");
	expect(drawn.some((t) => t.name === "button" && t.attributes.title === "grinning")).toBe(true);
});
