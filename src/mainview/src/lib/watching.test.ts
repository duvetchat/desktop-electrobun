import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";
import type { GatewaySpace } from "$lib/types";

// What this client watches, kept through reconnects, and who watches each stream (desktop#299, gateway#152).
const { WATCH_GRACE_MS, keepWatchedStreams, nextWatched, startWatching, stopWatching, streamToShow, viewersOf } =
	await import("$lib/watching");
const { activeVoiceRoomId, gatewaySpaces, watchedStreams } = await import("$lib/stores.svelte");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const ANA = "01920000-0000-7000-8000-00000000a11c";
const BO = "01920000-0000-7000-8000-00000000b011";
const SPACE = "01920000-0000-7000-8000-0000000005d1";
const ROOM = "01920000-0000-7000-8000-0000000005d3";
const OTHER_ROOM = "01920000-0000-7000-8000-0000000005d4";

describe("nextWatched", () => {
	const sharing = (...ids: string[]) => new Set(ids);

	test("keeps a sharer who stopped for under 60 s, and drops one after", () => {
		const first = nextWatched([ANA, BO], {}, sharing(BO), 1000);
		expect(first).toEqual({ watched: [ANA, BO], absentSince: { [ANA]: 1000 }, nextCheck: 1000 + WATCH_GRACE_MS });
		expect(nextWatched([ANA, BO], first.absentSince, sharing(BO), 1000 + WATCH_GRACE_MS - 1).watched).toEqual([
			ANA,
			BO,
		]);
		expect(nextWatched([ANA, BO], first.absentSince, sharing(BO), 1000 + WATCH_GRACE_MS)).toEqual({
			watched: [BO],
			absentSince: {},
			nextCheck: null,
		});
	});

	test("a sharer back within 60 s is no longer away", () => {
		const away = nextWatched([ANA], {}, sharing(), 1000).absentSince;
		expect(nextWatched([ANA], away, sharing(ANA), 30_000)).toEqual({
			watched: [ANA],
			absentSince: {},
			nextCheck: null,
		});
	});

	test("nextCheck is the earliest end of a grace", () => {
		expect(nextWatched([ANA, BO], { [BO]: 500 }, sharing(), 2000).nextCheck).toBe(500 + WATCH_GRACE_MS);
	});
});

describe("streamToShow", () => {
	test("your own share first", () => {
		expect(streamToShow(true, [ANA], new Set([ANA]))).toEqual({ own: true });
	});

	test("else the last watched whose stream is here", () => {
		expect(streamToShow(false, [ANA, BO], new Set([ANA, BO]))).toEqual({ own: false, userId: BO });
		expect(streamToShow(false, [ANA, BO], new Set([ANA]))).toEqual({ own: false, userId: ANA });
	});

	test("nothing when there's none", () => {
		expect(streamToShow(false, [ANA], new Set())).toBeNull();
		expect(streamToShow(false, [], new Set([ANA]))).toBeNull();
	});
});

describe("viewersOf", () => {
	const states = [
		{ user_id: ANA, watching: [BO] },
		{ user_id: BO, watching: [ANA] },
		{ user_id: ME, watching: [] },
	];

	test("those whose watching names the sharer, never the sharer", () => {
		expect(viewersOf(BO, [...states, { user_id: BO, watching: [BO] }], null)).toEqual([ANA]);
		expect(viewersOf(ANA, [{ user_id: ANA }], null)).toEqual([]);
	});

	test("your own entry follows what you watch here", () => {
		expect(viewersOf(BO, states, { id: ME, watching: [BO] })).toEqual([ANA, ME]);
		expect(viewersOf(BO, [{ user_id: ANA, watching: [BO] }], { id: ME, watching: [BO] })).toEqual([ANA, ME]);
		expect(viewersOf(ANA, [{ user_id: ME, watching: [ANA] }], { id: ME, watching: [] })).toEqual([]);
	});
});

describe("watching and stopping", () => {
	let gateway: TestGateway;
	const told = () => gateway.sent("VOICE_SYNC");

	beforeEach(async () => {
		watchedStreams.set([]);
		activeVoiceRoomId.set(ROOM);
		gateway = await openGateway();
	});
	afterEach(() => {
		gateway.close();
		watchedStreams.set([]);
		activeVoiceRoomId.set(null);
	});

	test("watching and stopping send VOICE_SYNC with the list", () => {
		startWatching(ROOM, ANA);
		expect(get(watchedStreams)).toEqual([ANA]);
		expect(told().at(-1)).toMatchObject({ room_id: ROOM, watching: [ANA] });
		stopWatching(ANA);
		expect(get(watchedStreams)).toEqual([]);
		expect(told().at(-1)).toMatchObject({ room_id: ROOM, watching: [] });
	});

	test("a second Watch keeps one entry", () => {
		startWatching(ROOM, ANA);
		startWatching(ROOM, ANA);
		expect(get(watchedStreams)).toEqual([ANA]);
		expect(told()).toHaveLength(1);
	});

	// A room's view shows its tiles to anyone who can view it, in voice there or not.
	test("watching in a room you aren't in voice in does nothing, and sends nothing", () => {
		startWatching(OTHER_ROOM, ANA);
		expect(get(watchedStreams)).toEqual([]);
		expect(told()).toHaveLength(0);
	});
});

describe("keepWatchedStreams", () => {
	let gateway: TestGateway;
	let clock = 0;
	let stop: (() => void) | null = null;
	const now = () => clock;
	const space = (states: { user_id: string; screen_sharing: boolean }[]): GatewaySpace => ({
		id: SPACE,
		name: "Alpha",
		description: null,
		banner: null,
		owner_id: ANA,
		locale: null,
		member_roles: {},
		room_overwrites: [],
		rooms: [
			{
				id: ROOM,
				space_id: SPACE,
				parent_id: null,
				type: 2,
				name: "lounge",
				description: null,
				position: 0,
				nsfw: false,
				created_at: "",
				updated_at: "",
			},
		],
		members: [],
		roles: [],
		users: [],
		voice_states: states.map((s, i) => ({
			room_id: ROOM,
			user_id: s.user_id,
			muted: false,
			deafened: false,
			screen_sharing: s.screen_sharing,
			camera: false,
			version: i + 1,
		})),
		created_at: "",
		updated_at: "",
	});

	beforeEach(async () => {
		clock = 1000;
		gatewaySpaces.set([space([{ user_id: ANA, screen_sharing: true }])]);
		activeVoiceRoomId.set(ROOM);
		watchedStreams.set([ANA]);
		gateway = await openGateway();
		stop = keepWatchedStreams(now);
	});
	afterEach(() => {
		stop?.();
		stop = null;
		gateway.close();
		watchedStreams.set([]);
		activeVoiceRoomId.set(null);
		gatewaySpaces.set([]);
	});

	test("switching rooms or leaving voice empties the list", () => {
		activeVoiceRoomId.set(OTHER_ROOM);
		expect(get(watchedStreams)).toEqual([]);
		watchedStreams.set([ANA]);
		activeVoiceRoomId.set(null);
		expect(get(watchedStreams)).toEqual([]);
	});

	test("starting it again keeps the list, as the app page's remount on a READY does", () => {
		stop?.();
		stop = keepWatchedStreams(now);
		expect(get(watchedStreams)).toEqual([ANA]);
	});

	test("a READY with no voice states, then the sharer back without a screen and then sharing, keeps the list", () => {
		gatewaySpaces.set([]);
		clock += 5000;
		gatewaySpaces.set([space([{ user_id: ANA, screen_sharing: false }])]);
		clock += 5000;
		gatewaySpaces.set([space([{ user_id: ANA, screen_sharing: true }])]);
		expect(get(watchedStreams)).toEqual([ANA]);
		expect(gateway.sent("VOICE_SYNC")).toHaveLength(0);
	});

	test("a sharer gone for 60 s leaves the list, and the gateway is told", () => {
		gatewaySpaces.set([space([])]);
		clock += WATCH_GRACE_MS;
		gatewaySpaces.set([space([{ user_id: BO, screen_sharing: false }])]);
		expect(get(watchedStreams)).toEqual([]);
		expect(gateway.sent("VOICE_SYNC").at(-1)).toMatchObject({ room_id: ROOM, watching: [] });
	});
});
