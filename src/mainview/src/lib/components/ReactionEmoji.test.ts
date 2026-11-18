import { describe, expect, test } from "bun:test";
import { getHostURL } from "$lib/common/common";
import { tags } from "./server-render";

const { default: ReactionEmoji } = await import("./ReactionEmoji.svelte");
const X = "0190a3b2-0000-7000-8000-0000000000e1";

// A reaction's custom emoji, whatever Space it's of: one of the user's Spaces by its name, any other from the API's
// /emojis, which anyone may load.
describe("a reaction's custom emoji", () => {
	test("one the map has shows its image", async () => {
		const [img] = await tags(ReactionEmoji, {
			reaction: { emoji_name: "blob", emoji_id: X },
			customEmojiMap: { [X]: { name: "blob", attachment_id: "file" } },
		});
		expect(img?.attributes.src).toBe(`${getHostURL()}/attachments/file`);
	});

	test("one it doesn't have shows from /emojis, named as the reaction names it, and is tried again if it fails", async () => {
		const [img] = await tags(ReactionEmoji, { reaction: { emoji_name: "blob", emoji_id: X } });
		expect(img?.attributes.src).toBe(`${getHostURL()}/emojis/${X}`);
		expect(img?.attributes.title).toBe(":blob:");
		expect(img?.attributes.class?.split(" ")).toContain("custom-emoji");
	});

	test("one named by its ID, as an app that didn't know its name sent it, reads :emoji:", async () => {
		const [img] = await tags(ReactionEmoji, { reaction: { emoji_name: X, emoji_id: X } });
		expect(img?.attributes.alt).toBe(":emoji:");
	});
});
