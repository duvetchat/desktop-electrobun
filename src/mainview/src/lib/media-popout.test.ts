import { expect, mock, test } from "bun:test";
import { writable } from "svelte/store";
import { IDLE_MEDIA, type MediaState } from "$lib/media-state";
import type { WindowAnswer, WindowCommand, WindowStateMessage } from "$lib/window-link";

// The main window's side of the media controls' pop-out (#357), against a fake of the app's RPC and of the page's
// media: what it tells Bun and the pop-out's window, in which order, and what it does with what they say back.
// The stores' .svelte.ts modules use $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value, window: new EventTarget() });

type Answerer = (command: WindowCommand) => Promise<WindowAnswer>;
const rpc = {
	answerers: [] as Answerer[],
	sent: [] as WindowStateMessage[],
	on: { windowCommand: (answerer: Answerer) => void rpc.answerers.push(answerer) },
	send: { windowState: (message: WindowStateMessage) => void rpc.sent.push(message) },
};
const shell = { window: "main", popOut: true, os: "mac" };
const ran: string[] = [];
const liveMedia = writable<MediaState>(IDLE_MEDIA);
mock.module("$lib/electrobun-rpc", () => ({ getElectrobunRpc: () => Promise.resolve(rpc) }));
mock.module("$lib/platform", () => ({ currentShell: () => shell }));
mock.module("$lib/media-source", () => ({
	liveMedia,
	liveMediaActions: {
		toggleMute: () => void ran.push("toggleMute"),
		toggleDeafen: () => void ran.push("toggleDeafen"),
		toggleNoiseSuppression: () => void ran.push("toggleNoiseSuppression"),
		disconnect: () => void ran.push("disconnect"),
	},
}));
const { mediaPopOut, popOutMedia, putBackMedia, showMediaWindow, startMediaBridge } =
	await import("./media-popout.svelte");

const settled = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};
/** What went out since `from`, as "channel: value". */
const sentSince = (from: number) => rpc.sent.slice(from).map((m) => [m.channel, m.value]);
const fromBun = (channel: string, name: string, args?: unknown) => rpc.answerers.at(-1)!({ channel, name, args });
function press(key: string, modifiers: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) {
	const event = Object.assign(new Event("keydown", { cancelable: true }), {
		key,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		...modifiers,
	});
	window.dispatchEvent(event);
	return event;
}
const muted: MediaState = { ...IDLE_MEDIA, muted: true };

test("in a browser, and in a window that isn't the main one, there is no bridge", async () => {
	shell.popOut = false;
	startMediaBridge()();
	shell.popOut = true;
	shell.window = "voice-controls";
	startMediaBridge()();
	shell.window = "main";
	await settled();
	expect(mediaPopOut.available).toBe(false);
	expect(rpc.answerers).toEqual([]);
	expect(rpc.sent).toEqual([]);
});

let stop = () => {};

test("as it starts it says the window isn't wanted, and the controls can pop out", async () => {
	stop = startMediaBridge();
	expect(mediaPopOut.available).toBe(false);
	await settled();
	expect(mediaPopOut).toEqual({ available: true, out: false });
	expect(rpc.answerers).toHaveLength(1);
	// The wish alone: the controls' state isn't mirrored while they are in the sidebar.
	expect(sentSince(0)).toEqual([["media-window", { open: false, shown: 0 }]]);
	liveMedia.set(muted);
	expect(rpc.sent).toHaveLength(1);
});

test("popping out publishes the controls' state before the wish Bun opens the window on", () => {
	const from = rpc.sent.length;
	popOutMedia();
	expect(mediaPopOut.out).toBe(true);
	expect(sentSince(from)).toEqual([
		["media", muted],
		["media-window", { open: true, shown: 0 }],
	]);
});

test("while it is out every change of the controls goes to the window, and the slim row brings it to the front", () => {
	const from = rpc.sent.length;
	liveMedia.set(IDLE_MEDIA);
	showMediaWindow();
	expect(sentSince(from)).toEqual([
		["media", IDLE_MEDIA],
		["media-window", { open: true, shown: 1 }],
	]);
});

test("the window's commands run the sidebar's own actions", async () => {
	expect(await fromBun("media", "toggleMute")).toEqual({ ok: true, result: null });
	expect(await fromBun("media", "disconnect")).toEqual({ ok: true, result: null });
	expect(ran).toEqual(["toggleMute", "disconnect"]);
	ran.length = 0;
});

test("closed, from Bun, docks the controls again and stops mirroring them", async () => {
	const from = rpc.sent.length;
	expect(await fromBun("media-window", "closed")).toEqual({ ok: true, result: null });
	expect(mediaPopOut.out).toBe(false);
	expect(sentSince(from)).toEqual([["media-window", { open: false, shown: 1 }]]);
	liveMedia.set(muted);
	expect(rpc.sent).toHaveLength(from + 1);
	// Closed twice (its own button, then Bun's word of it): nothing more.
	await fromBun("media-window", "closed");
	putBackMedia();
	expect(rpc.sent).toHaveLength(from + 1);
});

test("the mute and deafen keys are taken while the bridge is up, and nothing else is", () => {
	const mute = press("M", { metaKey: true, shiftKey: true });
	const deafen = press("d", { metaKey: true, shiftKey: true });
	const other = press("m", { metaKey: true });
	const windows = press("m", { ctrlKey: true, shiftKey: true });
	expect(ran).toEqual(["toggleMute", "toggleDeafen"]);
	expect([mute, deafen, other, windows].map((e) => e.defaultPrevented)).toEqual([true, true, false, false]);
	ran.length = 0;
});

test("the window stays out through the app page's remount", async () => {
	popOutMedia();
	stop();
	expect(mediaPopOut).toEqual({ available: false, out: true });
	const from = rpc.sent.length;
	liveMedia.set(IDLE_MEDIA);
	expect(rpc.sent).toHaveLength(from);

	stop = startMediaBridge();
	await settled();
	expect(mediaPopOut).toEqual({ available: true, out: true });
	// The state again, then the wish as it was: the window isn't asked to the front.
	expect(sentSince(from)).toEqual([
		["media", IDLE_MEDIA],
		["media-window", { open: true, shown: 1 }],
	]);
});

test("stopping removes the key listener and the commands, and publishes nothing more", async () => {
	putBackMedia();
	stop();
	const from = rpc.sent.length;
	const mute = press("m", { metaKey: true, shiftKey: true });
	expect(mute.defaultPrevented).toBe(false);
	expect(ran).toEqual([]);
	expect((await fromBun("media", "toggleMute")).ok).toBe(false);
	expect((await fromBun("media-window", "closed")).ok).toBe(false);
	popOutMedia();
	liveMedia.set(muted);
	expect(rpc.sent).toHaveLength(from);
	expect(mediaPopOut.available).toBe(false);
});
