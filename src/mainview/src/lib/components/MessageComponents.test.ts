import { expect, mock, test } from "bun:test";
import { join } from "node:path";
import { getHostURL } from "$lib/common/common";
import { ComponentType, type Component } from "$lib/types";
import { tags } from "./server-render";

// The stores' module keeps the session token in a $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
// A select's UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which
// Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
mock.module("facehash-sv", () => facehash);
const { default: MessageComponents } = await import("./MessageComponents.svelte");
const X = "0190a3b2-0000-7000-8000-0000000000e1";

// A bot's button may name a custom emoji of any Space: one the user's Spaces don't have shows from the API's /emojis,
// named as the bot named it.
test("a button's custom emoji the map doesn't have shows from /emojis, named as the bot named it", async () => {
	const button: Component = {
		type: ComponentType.Button,
		style: 1,
		custom_id: "a",
		label: "A",
		emoji: { id: X, name: "party" },
	};
	const components: Component[] = [{ type: ComponentType.ActionRow, components: [button] }];
	const [img] = (await tags(MessageComponents, { components, onPreview: () => {} })).filter((t) => t.name === "img");
	expect(img?.attributes.src).toBe(`${getHostURL()}/emojis/${X}`);
	expect(img?.attributes.title).toBe(":party:");
	expect(img?.attributes.class?.split(" ")).toContain("custom-emoji");
});
