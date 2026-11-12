import { beforeEach, describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import type { GatewayRoom, GatewaySpace } from "$lib/types";

// The stores' .svelte.ts module uses $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const stores = await import("$lib/stores.svelte");
const { notificationLevels } = await import("$lib/notification-levels");
const { quietPlaces, shownMentionCounts, shownUnreadConversations, shownUnreadRooms } =
	await import("$lib/notification-marks");

const SPACE = "01920000-0000-7000-8000-0000000000a1";
const ROOM = "01920000-0000-7000-8000-0000000000b1";
const OTHER_ROOM = "01920000-0000-7000-8000-0000000000b2";
const CONV = "01920000-0000-7000-8000-0000000000c1";

const room = (id: string): GatewayRoom => ({
	id,
	space_id: SPACE,
	parent_id: null,
	type: 1,
	name: id,
	description: null,
	position: 0,
	nsfw: false,
	created_at: "",
	updated_at: "",
});

function aSpace(defaultLevel: 0 | 1 | undefined) {
	const space: GatewaySpace = {
		id: SPACE,
		name: "S",
		description: null,
		banner: null,
		owner_id: CONV,
		locale: null,
		member_roles: {},
		room_overwrites: [],
		rooms: [room(ROOM), room(OTHER_ROOM)],
		members: [],
		roles: [],
		users: [],
		created_at: "",
		updated_at: "",
		...(defaultLevel === undefined ? {} : { default_notifications: defaultLevel }),
	};
	stores.gatewaySpaces.set([space]);
}

beforeEach(() => {
	aSpace(1);
	notificationLevels.set({});
	stores.unreadChannels.set(new Set([ROOM, OTHER_ROOM]));
	stores.unreadConversations.set(new Set([CONV]));
	stores.mentionCounts.set({ [ROOM]: 2, [CONV]: 1 });
});

describe("what a level of nothing hides", () => {
	test("without levels nothing is hidden", () => {
		expect(get(quietPlaces).size).toBe(0);
		expect(get(shownUnreadRooms)).toEqual(new Set([ROOM, OTHER_ROOM]));
		expect(get(shownMentionCounts)).toEqual({ [ROOM]: 2, [CONV]: 1 });
	});

	test("a Space in nothing hides its rooms' marks and counts, and a room of it on every message keeps its own", () => {
		notificationLevels.set({ [SPACE]: 2 });
		expect(get(shownUnreadRooms)).toEqual(new Set());
		expect(get(shownMentionCounts)).toEqual({ [CONV]: 1 });
		notificationLevels.set({ [SPACE]: 2, [ROOM]: 0 });
		expect(get(shownUnreadRooms)).toEqual(new Set([ROOM]));
		expect(get(shownMentionCounts)).toEqual({ [ROOM]: 2, [CONV]: 1 });
	});

	test("a room in nothing hides only itself", () => {
		notificationLevels.set({ [OTHER_ROOM]: 2 });
		expect(get(shownUnreadRooms)).toEqual(new Set([ROOM]));
	});

	test("a conversation in nothing loses its mark and its mentions", () => {
		notificationLevels.set({ [CONV]: 2 });
		expect(get(shownUnreadConversations)).toEqual(new Set());
		expect(get(shownMentionCounts)).toEqual({ [ROOM]: 2 });
	});

	test("the marks and counts there were come back as soon as the level changes, with nothing fetched", () => {
		notificationLevels.set({ [SPACE]: 2, [CONV]: 2 });
		notificationLevels.set({ [SPACE]: 1 });
		expect(get(shownUnreadRooms)).toEqual(new Set([ROOM, OTHER_ROOM]));
		expect(get(shownUnreadConversations)).toEqual(new Set([CONV]));
		expect(get(shownMentionCounts)).toEqual({ [ROOM]: 2, [CONV]: 1 });
	});

	test("a Space's default isn't a level of nothing, whatever it is", () => {
		aSpace(0);
		expect(get(quietPlaces).size).toBe(0);
		aSpace(undefined);
		expect(get(quietPlaces).size).toBe(0);
	});
});
