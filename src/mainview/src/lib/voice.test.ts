import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";

const { toggleDeafen, toggleMute } = await import("$lib/voice");
const { activeVoiceRoomId, isDeafened, isMuted } = await import("$lib/stores.svelte");

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

test("the voice room's controls go through the same functions as the user panel's", () => {
	const view = readFileSync(join(import.meta.dir, "components/VoiceChannelView.svelte"), "utf8");
	expect(view).toContain('import { toggleDeafen, toggleMute as toggleMic } from "$lib/voice";');
	expect(view).not.toContain("isMuted.update");
	expect(view).not.toContain("isDeafened.update");
	const panel = readFileSync(join(import.meta.dir, "components/UserStatusBar.svelte"), "utf8");
	expect(panel).toContain("toggleDeafen, toggleMute as toggleMic");
});
