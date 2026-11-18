import { describe, expect, test } from "bun:test";
import { bySpace, emojiSuggestions, pickerGroups } from "$lib/space-emojis";
import type { GatewaySpace, SpaceEmoji } from "$lib/types";

const A = "01a15f8c-0000-7000-8000-0000000000a1";
const B = "01a15f8c-0000-7000-8000-0000000000b1";
const C = "01a15f8c-0000-7000-8000-0000000000c1";
const D = "01a15f8c-0000-7000-8000-0000000000d1";
const item = (space_id: string, id: string) => ({ id, space_id, name: id });
const space = (id: string, name = `Space ${id.slice(-2)}`): GatewaySpace => ({
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
const emoji = (space_id: string, name: string, id = `${space_id}-${name}`): SpaceEmoji => ({
	id,
	name,
	space_id,
	attachment_id: `file-${name}`,
	created_at: "",
	updated_at: "",
});

// The pickers group the user's emojis and stickers by Space: the one they write in first, then the column's pinned
// Spaces, then the rest in the gateway's order. A message coming in doesn't move a Space in a picker that's open, as the
// column's With news section would.
describe("pickerGroups", () => {
	const all = bySpace([item(A, "a"), item(B, "b"), item(C, "c"), item(D, "d")]);
	const spaces = [space(A), space(B), space(C), space(D)];
	const order = (current: string | null) => pickerGroups(all, spaces, [D, B], current).map((g) => g.space.id);

	test("the current Space first, then the pinned ones in their order, then the rest in the gateway's order", () => {
		expect(order(C)).toEqual([C, D, B, A]);
	});

	test("a DM has no current Space", () => {
		expect(order(null)).toEqual([D, B, A, C]);
	});

	test("a Space without items, or one the user is no longer in, is left out", () => {
		const groups = pickerGroups(bySpace([item(A, "a"), item(C, "gone")]), [space(A), space(B)], [], A);
		expect(groups.map((g) => g.space.id)).toEqual([A]);
	});

	test("each group by name, then ID, and two Spaces' items of one name both stay", () => {
		const groups = pickerGroups(
			bySpace([emoji(A, "wave", "2"), emoji(A, "party"), emoji(A, "wave", "1"), emoji(B, "wave")]),
			[space(A), space(B)],
			[],
			null,
		);
		expect(groups.map((g) => g.items.map((e) => `${e.name}:${e.id}`))).toEqual([
			[`party:${A}-party`, "wave:1", "wave:2"],
			[`wave:${B}-wave`],
		]);
	});
});

// What `:` suggests as the user types: every emoji of their Spaces, the current Space's first.
describe("emojiSuggestions", () => {
	const emojis = [emoji(C, "partyparrot"), emoji(A, "party"), emoji(A, "par"), emoji(A, "parrot")];
	const names = (query: string, current: string | null) => emojiSuggestions(query, emojis, current).map((e) => e.name);

	test("the current Space's matches first, then by how well they match, then the shorter name", () => {
		expect(names("par", C)).toEqual(["partyparrot", "par", "party", "parrot"]);
	});

	test("a name that only holds the query comes after those that start with it, in any case", () => {
		expect(names("ROT", null)).toEqual(["parrot", "partyparrot"]);
		expect(names("Party", null)).toEqual(["party", "partyparrot"]);
	});

	test("no match, nothing", () => {
		expect(names("zzz", C)).toEqual([]);
	});
});

// The user's emojis and stickers come in one list, of every Space they're in: the app keeps them by Space.
describe("bySpace", () => {
	test("keeps each Space's items in their order", () => {
		expect(bySpace([item(A, "x"), item(B, "y"), item(A, "z")])).toEqual({
			[A]: [item(A, "x"), item(A, "z")],
			[B]: [item(B, "y")],
		});
	});

	test("an empty list has no Space", () => {
		expect(bySpace([])).toEqual({});
	});
});
