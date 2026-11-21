import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";

const {
	askForMicWith,
	sendVoiceSync,
	startConversationCall,
	stopScreenShare,
	takeVideoCall,
	toggleDeafen,
	toggleMute,
} = await import("$lib/voice");
const {
	activeCall,
	activeVoiceRoomId,
	conversationsWithCalls,
	currentUser,
	incomingVideo,
	isDeafened,
	isMuted,
	isScreenSharing,
	ownCallsRinging,
	screenShareRequested,
	watchedStreams,
} = await import("$lib/stores.svelte");
const { toastStore } = await import("$lib/stores/toast.svelte");

const ROOM = "01920000-0000-7000-8000-0000000000c1";

let gateway: TestGateway;

beforeEach(async () => {
	isMuted.set(false);
	isDeafened.set(false);
	activeVoiceRoomId.set(ROOM);
	gateway = await openGateway();
});

afterEach(() => gateway.close());

const state = () => ({ muted: get(isMuted), deafened: get(isDeafened) });
// What the others see: the state the last VOICE_SYNC gave the gateway, whole.
const told = () => gateway.sent("VOICE_SYNC").at(-1);

test("unmuting while deafened undeafens too, and the others see both", () => {
	toggleDeafen();
	expect(state()).toEqual({ muted: true, deafened: true });
	toggleMute();
	expect(state()).toEqual({ muted: false, deafened: false });
	expect(told()).toMatchObject({ room_id: ROOM, muted: false, deafened: false });
});

// gateway#152: VOICE_SYNC carries the whole state, the screen shares this client shows included.
test("VOICE_SYNC says which streams this client watches", () => {
	const A = "01920000-0000-7000-8000-0000000000a1";
	const B = "01920000-0000-7000-8000-0000000000a2";
	watchedStreams.set([A, B]);
	sendVoiceSync();
	expect(told()).toMatchObject({ room_id: ROOM, watching: [A, B] });
	watchedStreams.set([]);
	sendVoiceSync();
	expect(told()).toMatchObject({ watching: [] });
});

// With incoming video off the gateway sends this client no screen, so it watches none; the list stays for when video
// comes back on.
test("VOICE_SYNC says this client watches nothing while incoming video is off, and keeps the list", () => {
	const A = "01920000-0000-7000-8000-0000000000a1";
	watchedStreams.set([A]);
	incomingVideo.set(false);
	sendVoiceSync();
	expect(told()).toMatchObject({ video_off: true, watching: [] });
	expect(get(watchedStreams)).toEqual([A]);
	incomingVideo.set(true);
	sendVoiceSync();
	expect(told()).toMatchObject({ video_off: false, watching: [A] });
	watchedStreams.set([]);
});

// The request toggles the share: one made while nothing is shared would open the screen picker.
test("stopping a share asks for nothing when there's none", () => {
	isScreenSharing.set(false);
	screenShareRequested.set(null);
	stopScreenShare(ROOM);
	expect(get(screenShareRequested)).toBeNull();
	isScreenSharing.set(true);
	stopScreenShare(ROOM);
	expect(get(screenShareRequested)).toEqual({ roomId: ROOM, withAudio: false });
	isScreenSharing.set(false);
	screenShareRequested.set(null);
});

test("muting only mutes", () => {
	toggleMute();
	expect(state()).toEqual({ muted: true, deafened: false });
	expect(told()).toMatchObject({ muted: true, deafened: false });
});

test("unmuting someone who only muted changes only that", () => {
	isMuted.set(true);
	toggleMute();
	expect(state()).toEqual({ muted: false, deafened: false });
});

test("deafening mutes too, and undeafening leaves the mic muted, as both apps have it", () => {
	toggleDeafen();
	expect(state()).toEqual({ muted: true, deafened: true });
	toggleDeafen();
	expect(state()).toEqual({ muted: true, deafened: false });
	expect(told()).toMatchObject({ muted: true, deafened: false });
});

test("out of voice the choice is kept, and nothing is sent", () => {
	activeVoiceRoomId.set(null);
	isMuted.set(true);
	isDeafened.set(true);
	toggleMute();
	expect(state()).toEqual({ muted: false, deafened: false });
	expect(gateway.sent("VOICE_SYNC")).toEqual([]);
});

// #207: a microphone the browser refused as voice joined left the user muted, and unmuting never asked for it again. As on
// the mobile app, unmuting asks for it first (VoiceChat's ask), and the user stays muted until it's open.
describe("unmuting without a microphone", () => {
	let asks = 0;
	let answer: (open: boolean) => void = () => {};
	const ask = () => {
		asks++;
		return new Promise<boolean>((resolve) => (answer = resolve));
	};
	const notices = () => toastStore.items.map((t) => [t.message, t.type]);

	beforeEach(() => {
		asks = 0;
		toastStore.items = [];
		isMuted.set(true);
		askForMicWith(ask);
	});
	afterEach(() => askForMicWith(null));

	test("asks for it first: the user stays muted, and the others are told nothing, until it's open", async () => {
		isDeafened.set(true);
		toggleMute();
		expect(asks).toBe(1);
		expect(state()).toEqual({ muted: true, deafened: true });
		expect(gateway.sent("VOICE_SYNC")).toEqual([]);
		answer(true);
		await Bun.sleep(0);
		expect(state()).toEqual({ muted: false, deafened: false });
		expect(told()).toMatchObject({ room_id: ROOM, muted: false, deafened: false });
		expect(notices()).toEqual([]);
	});

	test("one still refused leaves the user muted, and says how to talk", async () => {
		toggleMute();
		answer(false);
		await Bun.sleep(0);
		expect(state()).toEqual({ muted: true, deafened: false });
		expect(gateway.sent("VOICE_SYNC")).toEqual([]);
		expect(notices()).toEqual([["Allow Duvet to use the microphone to talk", "error"]]);
	});

	test("a second press while it asks asks no more", async () => {
		toggleMute();
		toggleMute();
		expect(asks).toBe(1);
		answer(true);
		await Bun.sleep(0);
		expect(gateway.sent("VOICE_SYNC")).toHaveLength(1);
		toggleMute();
		toggleMute();
		expect(asks).toBe(2);
	});

	test("voice left while it asks: nothing changes, and nothing is said", async () => {
		toggleMute();
		activeVoiceRoomId.set(null);
		answer(true);
		await Bun.sleep(0);
		expect(state()).toEqual({ muted: true, deafened: false });
		expect(gateway.sent("VOICE_SYNC")).toEqual([]);
		expect(notices()).toEqual([]);
	});

	test("muting asks nothing", () => {
		isMuted.set(false);
		toggleMute();
		expect(asks).toBe(0);
		expect(told()).toMatchObject({ muted: true });
	});
});

// The conversation's call button and the call history's (#196) both call through it.
describe("calling a conversation", () => {
	const ME = "01920000-0000-7000-8000-00000000b0b0";
	const ALICE = "01920000-0000-7000-8000-00000000a11c";
	const DM = "01a15f8c-0000-7000-8000-0000000000d1";
	const member = (user_id: string, username: string) => ({
		id: `${DM}-${user_id}`,
		conversation_id: DM,
		user_id,
		created_at: "",
		updated_at: "",
		user: { id: user_id, username, alias: null, avatar: null, banner: null },
	});
	const dm = { id: DM, members: [member(ME, "me"), member(ALICE, "alice")] };

	beforeEach(() => {
		currentUser.set({
			id: ME,
			username: "me",
			email_verified: true,
			alias: null,
			avatar: null,
			banner: null,
			custom: "",
			flags: 0,
			badges: 0,
			is_bot: false,
			created_at: "",
			updated_at: "",
		});
		activeCall.set(null);
		ownCallsRinging.set(new Set());
		conversationsWithCalls.set(new Set());
	});

	test("places the call: CALL_INITIATE with its members, and the user is calling", () => {
		startConversationCall(dm);
		expect(gateway.sent("CALL_INITIATE")).toEqual([{ conversation_id: DM, member_ids: [ME, ALICE] }]);
		expect(get(activeCall)).toMatchObject({
			conversationId: DM,
			initiatorId: ME,
			initiatorName: "me",
			state: "calling",
		});
		expect(get(conversationsWithCalls).has(DM)).toBe(true);
	});

	test("does nothing while a call shows, or while the user's own call there rings from another device", () => {
		const other = {
			conversationId: ALICE,
			initiatorId: ALICE,
			initiatorName: "alice",
			initiatorAvatar: null,
			memberIds: [],
		};
		activeCall.set({ ...other, state: "ringing" });
		startConversationCall(dm);
		activeCall.set(null);
		ownCallsRinging.set(new Set([DM]));
		startConversationCall(dm);
		expect(gateway.sent("CALL_INITIATE")).toEqual([]);
		expect(get(activeCall)).toBeNull();
	});

	// #370: the gateway has no video calls. A video call rings as a call does, and the camera turns on as the call's
	// voice joins, once: what the user does with it after is theirs.
	test("a video call is placed as any call, and the camera is the call's voice's to turn on, once", () => {
		startConversationCall(dm, { video: true });
		expect(gateway.sent("CALL_INITIATE")).toEqual([{ conversation_id: DM, member_ids: [ME, ALICE] }]);
		expect(get(activeCall)).toMatchObject({ conversationId: DM, state: "calling", video: true });
		// Not another room's or call's voice.
		expect(takeVideoCall(ROOM)).toBe(false);
		expect(takeVideoCall(DM)).toBe(true);
		expect(takeVideoCall(DM)).toBe(false);
		expect(get(activeCall)).toMatchObject({ conversationId: DM, state: "calling" });
	});

	test("a voice call leaves the camera off", () => {
		startConversationCall(dm);
		expect(get(activeCall)?.video).toBeFalsy();
		expect(takeVideoCall(DM)).toBe(false);
	});
});

test("the voice room's controls go through the same functions as the user panel's", () => {
	const view = readFileSync(join(import.meta.dir, "components/VoiceChannelView.svelte"), "utf8");
	expect(view).toContain('import { stopScreenShare, toggleDeafen, toggleMute as toggleMic } from "$lib/voice";');
	expect(view).not.toContain("isMuted.update");
	expect(view).not.toContain("isDeafened.update");
	// The user panel's controls: MediaControls, split from UserStatusBar (#357), whose actions are media-source.ts's,
	// the pop-out's too. They change neither store themselves.
	const panel = readFileSync(join(import.meta.dir, "media-source.ts"), "utf8");
	expect(panel).toContain('import { disconnectVoice, stopScreenShare, toggleDeafen, toggleMute } from "$lib/voice";');
	expect(panel).not.toContain("isMuted.update");
	expect(panel).not.toContain("isDeafened.update");
	for (const name of ["MediaPanel", "VoiceStatus", "MediaButton"]) {
		const part = readFileSync(join(import.meta.dir, `components/${name}.svelte`), "utf8");
		expect(part, name).not.toMatch(/isMuted|isDeafened/);
	}
});
