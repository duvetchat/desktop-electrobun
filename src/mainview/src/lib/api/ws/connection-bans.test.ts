import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";
import { loadBans, spaceBans } from "$lib/bans";
import { moderationRank } from "$lib/permissions";
import type { SpaceBan } from "$lib/types";

const stores = await import("$lib/stores.svelte");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const ANA = "01920000-0000-7000-8000-00000000a11c";
const CAROL = "01920000-0000-7000-8000-00000000ca01";
const SPACE = "01920000-0000-7000-8000-0000000005a0";
const OTHER_SPACE = "01920000-0000-7000-8000-0000000005b0";
const MODS = "01920000-0000-7000-8000-0000000005a9";
const T = "2026-11-09T12:00:00Z";
const banned = (n: number) => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const ban = (n: number, spaceId = SPACE): SpaceBan => ({
	space_id: spaceId,
	user_id: banned(n),
	user: {
		id: banned(n),
		username: `banned${n}`,
		email_verified: true,
		alias: null,
		avatar: null,
		banner: null,
		custom: "",
		flags: 0,
		badges: 0,
		is_bot: false,
		created_at: T,
		updated_at: T,
	},
	reason: n % 2 ? `reason ${n}` : null,
	banned_by: ME,
	created_at: T,
});

// The bans the API lists of each space, by space ID.
const apiBans: Record<string, SpaceBan[]> = {
	[SPACE]: [ban(1), ban(3)],
	[OTHER_SPACE]: [ban(5, OTHER_SPACE)],
};
const fetchSpy = spyOn(globalThis, "fetch");

let gateway: TestGateway;
const deliver = (type: string, data: unknown) => gateway.receive(type, data);
const listed = (spaceId = SPACE) => get(spaceBans)[spaceId]?.bans.map((b) => b.user_id) ?? null;

function spaceCreate(spaceId: string) {
	deliver("SPACE_CREATE", {
		space: { id: spaceId, name: spaceId === SPACE ? "Alpha" : "Beta", owner_id: ME, created_at: T, updated_at: T },
		rooms: {},
		roles_permissions: {
			[spaceId]: { id: spaceId, space_id: spaceId, name: "@everyone", permissions: 2, position: 0 },
			[MODS]: { id: MODS, space_id: spaceId, name: "Moderators", permissions: (1 << 19) | (1 << 20), position: 1 },
		},
		member_roles: { [ME]: [spaceId], [ANA]: [spaceId], [CAROL]: [spaceId, MODS] },
		overwrites: {},
		voice_states: [],
	});
}

function ready() {
	deliver("READY", {
		user: { id: ME, username: "me", status: 1 },
		sessionToken: "session",
		guild_ids: [SPACE, OTHER_SPACE],
	});
	spaceCreate(SPACE);
	spaceCreate(OTHER_SPACE);
}

beforeAll(async () => {
	fetchSpy.mockImplementation((async (input: string | URL | Request) => {
		const url = new URL(input instanceof Request ? input.url : input.toString());
		const bans = /^\/api\/spaces\/([^/]+)\/bans$/.exec(url.pathname);
		if (bans) return Response.json(apiBans[bans[1]!] ?? []);
		return Response.json([]);
	}) as typeof fetch);
	localStorage.setItem("duvet_session_token", "access");
	gateway = await openGateway();
	ready();
});

afterAll(() => {
	gateway.close();
	fetchSpy.mockRestore();
});

// SPACE_BAN_ADD and SPACE_BAN_REMOVE reach whoever may list a space's bans, and keep the list the Bans section shows.
describe("a space's bans", () => {
	test("SPACE_BAN_ADD puts a ban in a loaded list, in its place, and SPACE_BAN_REMOVE takes one out", async () => {
		await loadBans(SPACE, true);
		expect(listed()).toEqual([banned(1), banned(3)]);
		deliver("SPACE_BAN_ADD", ban(2));
		expect(listed()).toEqual([banned(1), banned(2), banned(3)]);
		expect(get(spaceBans)[SPACE]!.bans[1]).toEqual(ban(2));
		deliver("SPACE_BAN_REMOVE", { space_id: SPACE, user_id: banned(1) });
		expect(listed()).toEqual([banned(2), banned(3)]);
	});

	test("change nothing of a space whose list isn't loaded, which loads anew when it's shown", async () => {
		deliver("SPACE_BAN_ADD", ban(7, OTHER_SPACE));
		deliver("SPACE_BAN_REMOVE", { space_id: OTHER_SPACE, user_id: banned(5) });
		expect(listed(OTHER_SPACE)).toBeNull();
		await loadBans(OTHER_SPACE, true);
		expect(listed(OTHER_SPACE)).toEqual([banned(5)]);
	});

	test("SPACE_DELETE forgets that space's, the user being out of it", async () => {
		await loadBans(SPACE, true);
		deliver("SPACE_DELETE", { id: OTHER_SPACE });
		expect(listed(OTHER_SPACE)).toBeNull();
		expect(listed()).toEqual([banned(1), banned(3)]);
	});

	test("a READY forgets every space's: the events of the time away never came", async () => {
		await loadBans(SPACE, true);
		ready();
		expect(get(spaceBans)).toEqual({});
	});
});

describe("a member out of the space", () => {
	test("loses their roles with SPACE_MEMBER_REMOVE: one who joins again ranks below every role", () => {
		const alpha = () => get(stores.gatewaySpaces).find((s) => s.id === SPACE)!;
		expect(moderationRank(alpha(), CAROL)).toBe(1);
		deliver("SPACE_MEMBER_REMOVE", {
			space_id: SPACE,
			user_id: CAROL,
			member_id: "01920000-0000-7000-8000-00000000c0c0",
		});
		expect(alpha().member_roles[CAROL]).toBeUndefined();
		expect(moderationRank(alpha(), CAROL)).toBe(-1);
		expect(alpha().member_roles[ANA]).toEqual([SPACE]);
	});
});
