import { expect, mock, test } from "bun:test";
import { join } from "node:path";
import { tags } from "./server-render";
import type { Guild } from "$lib/types";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
void mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules use runes, which only Svelte's compiler knows: the value itself, and no effects.
Object.assign(globalThis, {
	$state: <T>(value: T) => value,
	$effect: Object.assign(() => {}, { root: () => () => {} }),
});
const { default: SpaceEdge } = await import("./SpaceEdge.svelte");

// A Space's button on the folded sidebar set its icon on a line of text, as a button does by default, and the line's
// descent made a picture's button 6 px taller than the icon: the selected Space's outline, and the focus one, had an
// empty band under the picture (#434). A flex container is the icon's size.
test("a Space's button on the folded sidebar is a flex container, the size of its icon", async () => {
	const guild: Guild = {
		id: "space-1",
		name: "Harbour",
		icon_url: "https://cdn.example/h.png",
		banner_url: "",
		channels: [],
	};
	const elements = await tags(SpaceEdge, {
		guilds: [guild],
		selectedSpaceId: guild.id,
		openChats: { tabs: [], activeChannelId: null, onActivate: () => {}, onClose: () => {}, onReorder: () => {} },
		onSpaceSelect: () => {},
		onFriendsSelect: () => {},
	});
	const button = elements.find((t) => t.name === "button" && t.attributes["aria-label"] === guild.name);
	expect(button?.attributes["aria-current"]).toBe("true");
	expect(button?.attributes.class?.split(/\s+/)).toContain("flex");
});
