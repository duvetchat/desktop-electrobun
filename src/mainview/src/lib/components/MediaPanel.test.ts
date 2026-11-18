import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { render } from "svelte/server";
import { IDLE_MEDIA, type MediaActions, type MediaState } from "$lib/media-state";
import { tags, type Tag } from "./server-render";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
mock.module("facehash-sv", () => facehash);
const { default: MediaPanel } = await import("./MediaPanel.svelte");

// The media controls' block (#357), as the server renders it for a state: the same in the sidebar and in the pop-out.
const actions: MediaActions = {
	toggleMute() {},
	toggleDeafen() {},
	toggleNoiseSuppression() {},
	toggleCamera() {},
	shareScreen() {},
	stopSharing() {},
	disconnect() {},
	listMics: () => Promise.resolve([]),
	selectMic() {},
	openPlace() {},
};
const inRoom: MediaState = {
	...IDLE_MEDIA,
	place: { kind: "room", id: "room-1", where: "Lounge · Harbour Lights" },
	phase: "connected",
	ping: 24,
	video: null,
	faces: [
		{ id: "me", name: "Tamsin", src: null, speaking: false },
		{ id: "ana", name: "Ana", src: null, speaking: true },
	],
	facesLabel: "2 people in voice, Ana speaking",
};
const inCall: MediaState = { ...inRoom, place: { kind: "call", id: "dm-1", where: "Ana" }, facesLabel: "" };

const drawn = (state: MediaState) => tags(MediaPanel, { state, actions });
const words = (state: MediaState) => render(MediaPanel, { props: { state, actions } }).body.replace(/<[^>]*>/g, " ");
const buttons = (all: Tag[]) => all.filter((tag) => tag.name === "button");
/** Each button as "Name" or "Name=pressed", in order. */
const named = (all: Tag[]) =>
	buttons(all).map((tag) =>
		"aria-pressed" in tag.attributes
			? `${tag.attributes["aria-label"]}=${tag.attributes["aria-pressed"]}`
			: tag.attributes["aria-label"],
	);
const button = (all: Tag[], name: string) => buttons(all).find((tag) => tag.attributes["aria-label"] === name);
const classes = (tag: Tag | undefined) => (tag?.attributes.class ?? "").split(/\s+/);

describe("out of voice", () => {
	test("is one row: the microphone with its picker, deafen and noise suppression", async () => {
		const all = await drawn(IDLE_MEDIA);
		expect(named(all)).toEqual(["Mute=false", "Choose a microphone", "Deafen=false", "Noise suppression=true"]);
		const row = all.find((tag) => tag.attributes.role === "group");
		expect(row?.attributes["aria-label"]).toBe("Voice controls");
		// No call panel, and nothing of it: no place, no Disconnect, no camera, no share.
		expect(all.some((tag) => tag.name === "section")).toBe(false);
	});

	test("a switch that is on says what a press does, and is sunk into ink", async () => {
		const all = await drawn({ ...IDLE_MEDIA, muted: true, deafened: true, noiseSuppression: false });
		expect(named(all)).toEqual(["Unmute=true", "Choose a microphone", "Undeafen=true", "Noise suppression=false"]);
		expect(classes(button(all, "Unmute"))).toEqual(expect.arrayContaining(["bg-duvet-ink", "text-duvet-bg"]));
		expect(classes(button(all, "Noise suppression"))).toContain("bg-duvet-secondary-fill");
	});

	test("the controls are rounded squares, never circles", async () => {
		for (const tag of buttons(await drawn({ ...inRoom, muted: true }))) {
			expect(classes(tag), tag.attributes["aria-label"]).not.toContain("rounded-full");
		}
	});
});

describe("in a voice room", () => {
	test("is the call panel: where the user is and Disconnect, over the controls with the camera and the share", async () => {
		const all = await drawn(inRoom);
		expect(all.find((tag) => tag.name === "section")?.attributes["aria-label"]).toBe("Your voice");
		expect(named(all)).toEqual([
			"Open Lounge · Harbour Lights, 2 people in voice, Ana speaking",
			"Disconnect",
			"Mute=false",
			"Choose a microphone",
			"Deafen=false",
			"Noise suppression=true",
			"Turn on camera=false",
			"Share screen=false",
		]);
		expect(words(inRoom)).toContain("Voice connected");
		expect(words(inRoom)).toContain("Lounge · Harbour Lights");
	});

	test("Disconnect is filled with the destructive colour", async () => {
		expect(classes(button(await drawn(inRoom), "Disconnect"))).toEqual(
			expect.arrayContaining(["bg-duvet-danger", "text-duvet-on-danger"]),
		);
	});

	test("the camera and a share that are on say what a press does", async () => {
		const all = await drawn({ ...inRoom, camera: true, sharing: true });
		expect(named(all)).toEqual(expect.arrayContaining(["Turn off camera=true", "Stop sharing=true"]));
		expect(button(all, "Share screen")).toBeUndefined();
	});

	test("without Speak the microphone is disabled; without Video the camera and the share are", async () => {
		const all = await drawn({ ...inRoom, muted: true, canSpeak: false, video: "no-permission" });
		for (const name of ["Unmute", "Turn on camera", "Share screen"]) {
			expect(button(all, name)?.attributes["aria-disabled"], name).toBe("true");
			expect(classes(button(all, name)), name).toContain("cursor-not-allowed");
		}
		// Deafen and noise suppression need no permission.
		expect(button(all, "Deafen")?.attributes["aria-disabled"]).toBeUndefined();
		expect(button(all, "Noise suppression")?.attributes["aria-disabled"]).toBeUndefined();
	});

	test("says how the connection is while it isn't up", () => {
		expect(words({ ...inRoom, phase: "connecting" })).toContain("Connecting…");
		expect(words({ ...inRoom, phase: "reconnecting" })).toContain("Reconnecting…");
		expect(words({ ...inRoom, phase: "failed" })).toContain("Couldn't connect");
		expect(words({ ...inRoom, phase: "closed" })).toContain("Disconnected");
	});

	test("marks a screen or a camera someone has on there, beside how the connection is", async () => {
		expect((await drawn(inRoom)).some((tag) => "data-live" in tag.attributes)).toBe(false);
		const shared = await drawn({ ...inRoom, live: "screen" });
		expect(shared.find((tag) => "data-live" in tag.attributes)?.attributes.title).toBe("Sharing their screen");
		expect(words({ ...inRoom, live: "screen" })).toContain("Sharing their screen");
		expect(words({ ...inCall, live: "camera" })).toContain("Camera on");
	});

	test("has no settings gear: Settings is the profile menu's", async () => {
		const all = await drawn(inRoom);
		expect(named(all).some((name) => /settings/i.test(name ?? ""))).toBe(false);
	});
});

describe("in a call", () => {
	test("says In a call and the chat's name, and leaving is Leave call", async () => {
		const all = await drawn(inCall);
		expect(all.find((tag) => tag.name === "section")?.attributes["aria-label"]).toBe("Your call");
		expect(words(inCall)).toContain("In a call");
		expect(named(all).slice(0, 2)).toEqual(["Open Ana", "Leave call"]);
	});

	test("a call being placed says Calling…, with Cancel call, and its video waits for the call", async () => {
		const calling: MediaState = { ...inCall, phase: "calling", video: "not-connected", faces: [] };
		const all = await drawn(calling);
		expect(words(calling)).toContain("Calling…");
		expect(named(all)).toContain("Cancel call");
		expect(button(all, "Turn on camera")?.attributes["aria-disabled"]).toBe("true");
		expect(button(all, "Share screen")?.attributes["aria-disabled"]).toBe("true");
	});
});
