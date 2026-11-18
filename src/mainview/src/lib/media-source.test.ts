import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { get, writable } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";
import type { VoicePlace } from "$lib/voice-place";

// The stores' .svelte.ts modules use $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { liveMedia, liveMediaActions, openCallChatWith, openVoicePlaceWith, pingWhile } =
	await import("$lib/media-source");
const {
	activeCall,
	activeVoiceRoomId,
	cameraRequested,
	conversations,
	currentUser,
	isCameraOn,
	isDeafened,
	isMuted,
	isScreenSharing,
	noiseSuppression,
	screenShareRequested,
	selectedMicId,
} = await import("$lib/stores.svelte");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const ANA = "01920000-0000-7000-8000-00000000a11c";
const DM = "01920000-0000-7000-8000-0000000000c1";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// #315: the ping's interval was a panel's state, started by an effect with no cleanup, so a panel destroyed during a
// call (every READY remounts the app's UI, voice staying) left it fetching /health every 3 s for the session. The ping
// is now a store that measures only while someone reads it, and its timer ends with its last reader.
describe("the ping", () => {
	test("is measured at once and then on its interval, while in voice and read", async () => {
		const inVoice = writable(true);
		let measures = 0;
		const ping = pingWhile(inVoice, () => Promise.resolve(20 + measures++), 15);
		const seen: (number | null)[] = [];
		const stop = ping.subscribe((ms) => void seen.push(ms));
		await tick();
		expect(seen).toEqual([null, 20]);
		await wait(40);
		expect(measures).toBeGreaterThanOrEqual(2);
		expect(seen.at(-1)).toBe(20 + measures - 1);
		stop();
	});

	test("stops with its last reader: nothing measures once the panel is gone", async () => {
		let measures = 0;
		const ping = pingWhile(writable(true), () => Promise.resolve(measures++), 10);
		const stop = ping.subscribe(() => {});
		await tick();
		stop();
		const after = measures;
		await wait(45);
		expect(measures).toBe(after);
	});

	test("isn't measured out of voice, and is forgotten on leaving it", async () => {
		const inVoice = writable(false);
		let measures = 0;
		const ping = pingWhile(inVoice, () => Promise.resolve(30 + measures++), 10);
		const stop = ping.subscribe(() => {});
		await wait(30);
		expect(measures).toBe(0);
		inVoice.set(true);
		await tick();
		expect(get(ping)).toBe(30);
		inVoice.set(false);
		expect(get(ping)).toBeNull();
		const after = measures;
		await wait(30);
		expect(measures).toBe(after);
		stop();
	});

	test("a measure that fails reads as none, and one that answers after voice was left says nothing", async () => {
		const inVoice = writable(true);
		let answer: (ms: number) => void = () => {};
		let fail = true;
		const ping = pingWhile(
			inVoice,
			() => (fail ? Promise.reject(new Error("offline")) : new Promise<number>((resolve) => (answer = resolve))),
			1000,
		);
		const stop = ping.subscribe(() => {});
		await tick();
		expect(get(ping)).toBeNull();
		fail = false;
		inVoice.set(false);
		inVoice.set(true);
		const late = answer;
		inVoice.set(false);
		late(12);
		await tick();
		expect(get(ping)).toBeNull();
		stop();
	});
});

describe("the media controls in the main window", () => {
	let gateway: TestGateway;
	const place: VoicePlace = {
		kind: "call",
		id: DM,
		spaceId: null,
		name: "Ana",
		place: "Call",
		states: [],
		person: (id) => ({ id, name: id, src: null }),
	};

	beforeEach(async () => {
		isMuted.set(false);
		isDeafened.set(false);
		isCameraOn.set(false);
		isScreenSharing.set(false);
		cameraRequested.set(null);
		screenShareRequested.set(null);
		currentUser.set({
			id: ME,
			username: "me",
			email_verified: true,
			alias: "Tamsin",
			avatar: null,
			banner: null,
			custom: "",
			flags: 0,
			badges: 0,
			is_bot: false,
			created_at: "",
			updated_at: "",
		});
		const member = (user_id: string, alias: string) => ({
			id: `m-${user_id}`,
			conversation_id: DM,
			user_id,
			created_at: "",
			updated_at: "",
			user: { id: user_id, username: alias.toLowerCase(), alias, avatar: null, banner: null },
		});
		conversations.set([
			{
				id: DM,
				type: 1,
				name: null,
				owner_id: ME,
				created_at: "",
				updated_at: "",
				deleted_at: null,
				members: [member(ME, "Tamsin"), member(ANA, "Ana")],
			},
		]);
		activeCall.set({
			conversationId: DM,
			initiatorId: ME,
			initiatorName: "Tamsin",
			initiatorAvatar: null,
			state: "connected",
			memberIds: [ME, ANA],
		});
		activeVoiceRoomId.set(DM);
		gateway = await openGateway();
	});

	afterEach(() => {
		activeVoiceRoomId.set(null);
		activeCall.set(null);
		openVoicePlaceWith(null);
		openCallChatWith(null);
		gateway.close();
	});

	test("their state is the stores': the call, with the user in it", () => {
		const state = get(liveMedia);
		expect(state.place).toEqual({ kind: "call", id: DM, where: "Ana" });
		expect(state.faces.map((face) => face.name)).toEqual(["Tamsin"]);
		expect(state.video).toBeNull();
		expect(state.canSpeak).toBe(true);
	});

	test("mute, deafen, noise suppression and the microphone act on the stores", () => {
		liveMediaActions.toggleMute();
		expect(get(isMuted)).toBe(true);
		expect(get(liveMedia).muted).toBe(true);
		liveMediaActions.toggleDeafen();
		expect(get(liveMedia)).toMatchObject({ muted: true, deafened: true });
		const before = get(noiseSuppression);
		liveMediaActions.toggleNoiseSuppression();
		expect(get(liveMedia).noiseSuppression).toBe(!before);
		liveMediaActions.toggleNoiseSuppression();
		liveMediaActions.selectMic("usb");
		expect(get(selectedMicId)).toBe("usb");
		expect(get(liveMedia).micId).toBe("usb");
	});

	test("the camera asks the voice it is in to turn it on, then off", () => {
		liveMediaActions.toggleCamera();
		expect(get(cameraRequested)).toEqual({ roomId: DM, on: true });
		isCameraOn.set(true);
		liveMediaActions.toggleCamera();
		expect(get(cameraRequested)).toEqual({ roomId: DM, on: false });
	});

	test("a share asks for the screen, with or without its sound; while sharing it asks for nothing more", () => {
		liveMediaActions.shareScreen(true);
		expect(get(screenShareRequested)).toEqual({ roomId: DM, withAudio: true });
		// The request toggles the share: one made while sharing would stop it.
		screenShareRequested.set(null);
		isScreenSharing.set(true);
		liveMediaActions.shareScreen(false);
		expect(get(screenShareRequested)).toBeNull();
		liveMediaActions.stopSharing();
		expect(get(screenShareRequested)).toEqual({ roomId: DM, withAudio: false });
	});

	test("out of voice the camera and the share ask for nothing", () => {
		activeVoiceRoomId.set(null);
		liveMediaActions.toggleCamera();
		liveMediaActions.shareScreen(false);
		liveMediaActions.stopSharing();
		expect(get(cameraRequested)).toBeNull();
		expect(get(screenShareRequested)).toBeNull();
	});

	test("Disconnect leaves the call, which goes on for the others", () => {
		liveMediaActions.disconnect();
		expect(gateway.sent("CALL_LEAVE")).toHaveLength(1);
		expect(get(activeVoiceRoomId)).toBeNull();
		expect(get(activeCall)).toBeNull();
	});

	test("while the call is still being placed, it cancels it", () => {
		activeVoiceRoomId.set(null);
		activeCall.update((call) => call && { ...call, state: "calling" });
		expect(get(liveMedia)).toMatchObject({ phase: "calling", place: { kind: "call", id: DM, where: "Ana" } });
		liveMediaActions.disconnect();
		expect(gateway.sent("CALL_CANCEL")).toHaveLength(1);
		expect(gateway.sent("CALL_LEAVE")).toHaveLength(0);
		expect(get(activeCall)).toBeNull();
	});

	test("where the user is opens that place, as the app page opens it", () => {
		const opened: string[] = [];
		openVoicePlaceWith((where) => void opened.push(`place ${where.id}`));
		openCallChatWith((id) => void opened.push(`chat ${id}`));
		liveMediaActions.openPlace();
		expect(opened).toEqual([`place ${place.id}`]);
		// A call still being placed is no voice place yet: its chat opens.
		activeVoiceRoomId.set(null);
		activeCall.update((call) => call && { ...call, state: "calling" });
		liveMediaActions.openPlace();
		expect(opened).toEqual([`place ${DM}`, `chat ${DM}`]);
	});
});
