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
/** Each button as "Name" or "Name=pressed", in order. A button whose name changes with its state ("Mute" then
 * "Unmute") says it once: it has no aria-pressed. One whose name stays ("Noise suppression") has. */
const named = (all: Tag[]) =>
	buttons(all).map((tag) =>
		"aria-pressed" in tag.attributes
			? `${tag.attributes["aria-label"]}=${tag.attributes["aria-pressed"]}`
			: tag.attributes["aria-label"],
	);
const button = (all: Tag[], name: string) => buttons(all).find((tag) => tag.attributes["aria-label"] === name);
const classes = (tag: Tag | undefined) => (tag?.attributes.class ?? "").split(/\s+/);

describe("out of voice", () => {
	// The sidebar's row of controls is the user's own bar's now (ProfileControls, under the profile row): the panel has
	// nothing to say until there is a voice to show.
	test("draws nothing", async () => {
		expect(await drawn(IDLE_MEDIA)).toEqual([]);
	});
});

describe("in a voice room", () => {
	test("the controls are rounded squares, never circles", async () => {
		for (const tag of buttons(await drawn({ ...inRoom, muted: true }))) {
			expect(classes(tag), tag.attributes["aria-label"]).not.toContain("rounded-full");
		}
	});

	test("is the call panel: where the user is and Disconnect, over the controls with the camera and the share", async () => {
		const all = await drawn(inRoom);
		expect(all.find((tag) => tag.name === "section")?.attributes["aria-label"]).toBe("Your voice");
		expect(named(all)).toEqual([
			"Open Lounge · Harbour Lights, 2 people in voice, Ana speaking",
			"Disconnect",
			"Mute",
			"Choose a microphone",
			"Deafen",
			"Noise suppression=true",
			"Turn on camera",
			"Share screen",
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
		expect(named(all)).toEqual(expect.arrayContaining(["Turn off camera", "Stop sharing"]));
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

	test("mute and deafen turn red when on; the camera and noise suppression keep the ink", async () => {
		const off = await drawn({ ...inRoom, muted: true, deafened: true });
		for (const name of ["Unmute", "Undeafen"]) {
			expect(classes(button(off, name)), name).toEqual(
				expect.arrayContaining(["bg-duvet-call-red", "text-fixed-white"]),
			);
		}
		const on = await drawn({ ...inRoom, camera: true, noiseSuppression: true });
		for (const name of ["Turn off camera", "Noise suppression"]) {
			expect(classes(button(on, name)), name).toEqual(expect.arrayContaining(["bg-duvet-ink"]));
			expect(classes(button(on, name)), name).not.toContain("bg-duvet-call-red");
		}
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
