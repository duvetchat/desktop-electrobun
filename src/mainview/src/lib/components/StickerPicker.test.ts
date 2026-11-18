import { expect, test } from "bun:test";
import { render } from "svelte/server";
import type { GatewaySpace } from "$lib/types";
import { tags } from "./server-render";

const { default: StickerPicker } = await import("./StickerPicker.svelte");
const sticker = (space_id: string, name: string) => ({
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
	{ space: space("s1", "Alpha"), items: [sticker("s1", "cat")] },
	{ space: space("s2", "Beta"), items: [sticker("s2", "dog")] },
];
const props = { groups, onSelect: () => {} };

// The stickers of every Space the user is in, wherever they write: a section for each Space, named as its Space, in the
// order pickerGroups gives.
test("a section for each Space, named as its Space, with its stickers", async () => {
	const html = render(StickerPicker, { props }).body;
	expect(html.indexOf("Alpha")).toBeGreaterThan(-1);
	expect(html.indexOf("Alpha")).toBeLessThan(html.indexOf("Beta"));
	const stickers = (await tags(StickerPicker, props)).filter((t) => t.name === "button" && t.attributes.title);
	expect(stickers.map((t) => t.attributes.title)).toEqual(["cat", "dog"]);
});

test("with no stickers in any Space, says so", () => {
	expect(render(StickerPicker, { props: { groups: [], onSelect: () => {} } }).body).toContain("No stickers available");
});
