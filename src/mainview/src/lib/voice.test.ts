import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";

const { askForMicWith, toggleDeafen, toggleMute } = await import("$lib/voice");
const { activeVoiceRoomId, isDeafened, isMuted } = await import("$lib/stores.svelte");
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

test("the voice room's controls go through the same functions as the user panel's", () => {
	const view = readFileSync(join(import.meta.dir, "components/VoiceChannelView.svelte"), "utf8");
	expect(view).toContain('import { toggleDeafen, toggleMute as toggleMic } from "$lib/voice";');
	expect(view).not.toContain("isMuted.update");
	expect(view).not.toContain("isDeafened.update");
	const panel = readFileSync(join(import.meta.dir, "components/UserStatusBar.svelte"), "utf8");
	expect(panel).toContain("toggleDeafen, toggleMute as toggleMic");
});
