import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
// oxlint-disable-next-line import/no-unassigned-import -- it has Bun load .svelte files compiled for the server
import "./server-render";
import type { GatewayRoom, GatewaySpace, Guild } from "$lib/types";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
void mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules use runes, which only Svelte's compiler knows: the value itself, and no effects.
Object.assign(globalThis, {
	$state: <T>(value: T) => value,
	$effect: Object.assign(() => {}, { root: () => () => {} }),
});
const { gatewaySpaces, unreadChannels } = await import("$lib/stores.svelte");
const { default: SpaceNav } = await import("./SpaceNav.svelte");

const nav = readFileSync(join(import.meta.dir, "SpaceNav.svelte"), "utf8");

// The Now section's cards (a call to join, a friend request) sit at the column's foot, right above its bottom block, and
// never float under a short list of rows: the rows' scroller grows into the room the column has left.
test("the rows' scroller grows, so the Now section sits at the column's foot", () => {
	const scroller =
		/<div class="([^"]*\boverflow-y-auto\b[^"]*)">\s*<div class="[^"]*" bind:offsetHeight=\{rowsHeight\}>/.exec(
			nav,
		)?.[1];
	expect(scroller?.split(/\s+/)).toContain("flex-1");
});

// #382: the quiet Spaces' row sat under the quiet Space shown while they were folded, under its whole tree, so it moved
// each time another Space was picked, and its count left that Space out. It's the quiet Spaces' own head now, in one
// place, and the open one shows under it (nav.test.ts has the list's rules, folded and unfolded).
describe("the quiet Spaces' row", () => {
	const room = (spaceId: string, id: string): GatewayRoom => ({
		id,
		space_id: spaceId,
		parent_id: null,
		type: 1,
		name: id,
		description: null,
		position: 0,
		nsfw: false,
		created_at: "",
		updated_at: "",
	});
	const space = (id: string, name: string): GatewaySpace => ({
		id,
		name,
		description: null,
		banner: null,
		owner_id: "me",
		locale: null,
		member_roles: {},
		room_overwrites: [],
		rooms: [room(id, `${id}-general`)],
		members: [],
		roles: [],
		users: [],
		created_at: "",
		updated_at: "",
	});
	const spaces = [space("a", "Alpha"), space("c", "Charlie"), space("d", "Delta"), space("e", "Echo")];
	gatewaySpaces.set(spaces);
	// Alpha has news; the others are quiet.
	unreadChannels.set(new Set(["a-general"]));
	const guilds: Guild[] = spaces.map((s) => ({
		id: s.id,
		name: s.name,
		icon_url: "",
		banner_url: "",
		channels: s.rooms.map((r) => ({ id: r.id, name: r.name, type: "text" as const, position: r.position })),
	}));
	const html = (selectedSpaceId: string | null, isFriendsActive = false) =>
		render(SpaceNav, {
			props: {
				guilds,
				selectedSpaceId,
				isFriendsActive,
				onSpaceSelect: () => {},
				onRoomSelect: () => {},
				onFriendsSelect: () => {},
				onConversationSelect: () => {},
				onNewGroup: () => {},
				onOpenSwitcher: () => {},
				onFriend: () => {},
			},
		}).body;
	const at = (body: string, text: string) => body.indexOf(text);

	test("sits after the Spaces with news, and folds the quiet ones away", () => {
		const body = html(null, true);
		expect(at(body, "Quiet · 3")).toBeGreaterThan(at(body, "Alpha"));
		for (const quiet of ["Charlie", "Delta", "Echo"]) expect(body).not.toContain(quiet);
		expect(body).toMatch(/<button[^>]*aria-expanded="false"[^>]*>\s*<span[^>]*>Quiet · 3<\/span>/);
	});

	test("shows the quiet Space picked while they're folded under it, and still counts them all", () => {
		const body = html("d");
		expect(at(body, "Quiet · 3")).toBeGreaterThan(at(body, "Alpha"));
		expect(at(body, "Delta")).toBeGreaterThan(at(body, "Quiet · 3"));
		expect(body).toContain("d-general");
		expect(body).not.toContain("Charlie");
		expect(body).not.toContain("Echo");
	});

	test("reads the same whichever Space is open", () => {
		for (const open of [null, "a", "c", "d"]) expect(html(open)).toContain("Quiet · 3");
	});
});
