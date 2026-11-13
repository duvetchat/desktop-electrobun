import { describe, expect, test } from "bun:test";
import type { Conversation } from "$lib/api/conversations";
import { getAvatarURL } from "$lib/common/common";
import { callName } from "$lib/now";
import type { ActiveCallInfo, CallVoiceState } from "$lib/stores.svelte";
import type { GatewaySpace, GatewayUser } from "$lib/types";

// The stores' .svelte.ts modules use $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { voicePlace } = await import("$lib/voice-place");

// The voice the user is in, a Space's voice room or a call, as the dock and the stream window read it.
const ME = "01920000-0000-7000-8000-00000000b0b0";
const ANA = "01920000-0000-7000-8000-00000000a11c";
const SPACE = "01920000-0000-7000-8000-0000000005c1";
const LOUNGE = "01920000-0000-7000-8000-0000000005c3";
const GROUP = "01920000-0000-7000-8000-0000000000c1";

const user = (id: string, username: string, alias: string | null, avatar: string | null): GatewayUser => ({
	id,
	username,
	email_verified: true,
	alias,
	avatar,
	banner: null,
	custom: "",
	flags: 0,
	badges: 0,
	is_bot: false,
	created_at: "",
	updated_at: "",
});

const space: GatewaySpace = {
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
			id: LOUNGE,
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
	users: [user(ANA, "ana", "Ana", "ana-avatar"), user(ME, "me", null, null)],
	voice_states: [
		{
			room_id: LOUNGE,
			user_id: ANA,
			muted: true,
			deafened: false,
			screen_sharing: true,
			camera: false,
			version: 1,
			watching: [ME],
		},
		{ room_id: LOUNGE, user_id: ME, muted: false, deafened: false, screen_sharing: false, camera: true, version: 2 },
	],
	created_at: "",
	updated_at: "",
};

const group: Conversation = {
	id: GROUP,
	type: 2,
	name: "A group",
	owner_id: ME,
	created_at: "",
	updated_at: "",
	deleted_at: null,
	members: [ME, ANA].map((user_id) => ({
		id: `${GROUP}-${user_id}`,
		conversation_id: GROUP,
		user_id,
		created_at: "",
		updated_at: "",
		user: {
			id: user_id,
			username: user_id === ANA ? "ana" : "me",
			alias: user_id === ANA ? "Ana" : null,
			avatar: null,
			banner: null,
		},
	})),
};

const call: ActiveCallInfo = {
	conversationId: GROUP,
	initiatorId: ANA,
	initiatorName: "Ana",
	initiatorAvatar: null,
	state: "connected",
	memberIds: [ME, ANA],
};

describe("voicePlace", () => {
	test("a Space's voice room: its states, and its people's names and avatars", () => {
		const place = voicePlace(LOUNGE, [space], null, [], [], ME);
		expect(place).toMatchObject({ kind: "room", id: LOUNGE, spaceId: SPACE, name: "lounge", place: "Alpha" });
		expect(place?.states).toEqual([
			{ user_id: ANA, muted: true, screen_sharing: true, camera: false, watching: [ME] },
			{ user_id: ME, muted: false, screen_sharing: false, camera: true, watching: [] },
		]);
		expect(place?.person(ANA)).toEqual({ id: ANA, name: "Ana", src: getAvatarURL(ANA, "ana-avatar") });
		expect(place?.person("01920000-0000-7000-8000-0000000000ff")).toMatchObject({ name: "Unknown", src: null });
	});

	test("a connected call: its states, and its members' names", () => {
		const states: CallVoiceState[] = [
			{ room_id: GROUP, user_id: ANA, muted: false, screen_sharing: true, watching: [ME] },
			{ room_id: "01920000-0000-7000-8000-0000000000c9", user_id: ME, muted: true },
		];
		const place = voicePlace(GROUP, [space], call, [group], states, ME);
		expect(place).toMatchObject({
			kind: "call",
			id: GROUP,
			spaceId: null,
			name: callName(group, ME),
			place: "Group call",
		});
		expect(place?.states).toEqual([
			{ user_id: ANA, muted: false, screen_sharing: true, camera: false, watching: [ME] },
		]);
		expect(place?.person(ANA).name).toBe("Ana");
	});

	test("nothing outside voice, or for a call that isn't connected", () => {
		expect(voicePlace(null, [space], call, [group], [], ME)).toBeNull();
		expect(voicePlace(GROUP, [space], { ...call, state: "ringing" }, [group], [], ME)).toBeNull();
	});
});
