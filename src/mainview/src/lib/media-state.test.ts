import { describe, expect, test } from "bun:test";
import {
	IDLE_MEDIA,
	isLive,
	isMicInUse,
	leaveLabel,
	MEDIA_COMMANDS,
	mediaCommandHandlers,
	mediaStateOf,
	mediaTitle,
	micChoices,
	micName,
	parseMediaState,
	phaseOf,
	pingLabel,
	pingLevel,
	remoteMediaActions,
	videoBlockLabel,
	type MediaActions,
	type MediaInputs,
	type MediaPerson,
	type MediaState,
} from "$lib/media-state";

// The media controls' state (#357): what the sidebar's block and the pop-out window both draw.
const ME: MediaPerson = { id: "me", name: "Tamsin", src: null, muted: false };
const ANA: MediaPerson = { id: "ana", name: "Ana", src: "ana.png", muted: false };
const LEO: MediaPerson = { id: "leo", name: "Leo", src: null, muted: true };

const inputs = (over: Partial<MediaInputs> = {}): MediaInputs => ({
	place: null,
	calling: null,
	me: ME,
	connection: "connected",
	ping: 24,
	muted: false,
	deafened: false,
	noiseSuppression: true,
	camera: false,
	sharing: false,
	canSpeak: true,
	canVideo: true,
	micId: "",
	speaking: new Set(),
	...over,
});
const lounge = (people: MediaPerson[] = [ME]) => ({
	kind: "room" as const,
	id: "room-1",
	name: "Lounge",
	space: "Harbour Lights",
	people,
});
const dm = (people: MediaPerson[] = [ME, ANA]) => ({
	kind: "call" as const,
	id: "dm-1",
	name: "Ana",
	space: null,
	people,
});

describe("out of voice", () => {
	test("the controls are the one row: no place, no ping, no faces, and the video can't be used", () => {
		const state = mediaStateOf(inputs({ muted: true, micId: "usb" }));
		expect(state.place).toBeNull();
		expect(state.phase).toBe("closed");
		expect(state.ping).toBeNull();
		expect(state.video).toBe("not-connected");
		expect(state.faces).toEqual([]);
		// Mute, deafen, noise suppression and the microphone are remembered out of voice too.
		expect(state).toMatchObject({ muted: true, deafened: false, noiseSuppression: true, micId: "usb" });
	});

	test("a call being placed shows as its chat, calling", () => {
		const state = mediaStateOf(inputs({ calling: { id: "dm-1", name: "Ana" } }));
		expect(state.place).toEqual({ kind: "call", id: "dm-1", where: "Ana" });
		expect(state.phase).toBe("calling");
		expect(mediaTitle(state)).toBe("Calling…");
		expect(leaveLabel(state)).toBe("Cancel call");
		expect(pingLabel(state)).toBe("Calling…");
		expect(isLive(state)).toBe(true);
	});
});

describe("in a voice room", () => {
	test("says where: the room, then its Space", () => {
		const state = mediaStateOf(inputs({ place: lounge() }));
		expect(state.place).toEqual({ kind: "room", id: "room-1", where: "Lounge · Harbour Lights" });
		expect(mediaTitle(state)).toBe("Voice connected");
		expect(leaveLabel(state)).toBe("Disconnect");
		expect(state.video).toBeNull();
	});

	test("says how the connection is, in the app's words", () => {
		const title = (connection: RTCPeerConnectionState) =>
			mediaTitle(mediaStateOf(inputs({ place: lounge(), connection })));
		expect(title("new")).toBe("Connecting…");
		expect(title("connecting")).toBe("Connecting…");
		expect(title("connected")).toBe("Voice connected");
		expect(title("disconnected")).toBe("Reconnecting…");
		expect(title("failed")).toBe("Couldn't connect");
		expect(title("closed")).toBe("Disconnected");
		expect(phaseOf("disconnected")).toBe("reconnecting");
		expect(isLive({ phase: "reconnecting" })).toBe(false);
	});

	test("without Video the camera and the screen share say why", () => {
		const state = mediaStateOf(inputs({ place: lounge(), canVideo: false }));
		expect(state.video).toBe("no-permission");
		expect(videoBlockLabel(state.video, "room")).toBe("You can't use video in this room");
		expect(videoBlockLabel(state.video, "call")).toBe("You can't use video in this call");
		expect(videoBlockLabel("not-connected", undefined)).toBe("You're not connected to voice");
		expect(videoBlockLabel(null, "room")).toBeNull();
	});

	test("the user is among the faces even before the gateway lists them", () => {
		const state = mediaStateOf(inputs({ place: lounge([ANA]) }));
		expect(state.faces.map((face) => face.id)).toEqual(["ana", "me"]);
		expect(state.facesLabel).toBe("2 people in voice");
	});

	test("three faces show, and the rest are counted", () => {
		const crowd = ["a", "b", "c", "d", "e"].map((id) => ({ ...ANA, id, name: id.toUpperCase() }));
		const state = mediaStateOf(inputs({ place: lounge([...crowd, ME]) }));
		expect(state.faces.map((face) => face.id)).toEqual(["a", "b", "c"]);
		expect(state.more).toBe(3);
		expect(state.facesLabel).toBe("6 people in voice");
	});

	test("whoever speaks, and isn't muted, is ringed and named", () => {
		const state = mediaStateOf(inputs({ place: lounge([ME, ANA, LEO]), speaking: new Set(["ana", "leo"]) }));
		expect(state.faces.filter((face) => face.speaking).map((face) => face.id)).toEqual(["ana"]);
		expect(state.facesLabel).toBe("3 people in voice, Ana speaking");
	});

	test("the user's own mute counts at once, before the gateway echoes it", () => {
		const state = mediaStateOf(inputs({ place: lounge([ME, ANA]), muted: true, speaking: new Set(["me"]) }));
		expect(state.faces.find((face) => face.id === "me")?.speaking).toBe(false);
		expect(state.facesLabel).toBe("2 people in voice");
	});

	test("alone, it's one person", () => {
		expect(mediaStateOf(inputs({ place: lounge() })).facesLabel).toBe("1 person in voice");
	});
});

describe("in a call", () => {
	test("says In a call and the chat's name, and leaving is Leave call", () => {
		const state = mediaStateOf(inputs({ place: dm() }));
		expect(state.place).toEqual({ kind: "call", id: "dm-1", where: "Ana" });
		expect(mediaTitle(state)).toBe("In a call");
		expect(leaveLabel(state)).toBe("Leave call");
		// The mark says the call, not a ping.
		expect(pingLabel(state)).toBe("In a call");
	});
});

describe("the ping", () => {
	test("reads fine under 100 ms, slow under 250 ms, poor beyond", () => {
		expect(pingLevel(null)).toBe("fine");
		expect(pingLevel(99)).toBe("fine");
		expect(pingLevel(100)).toBe("slow");
		expect(pingLevel(249)).toBe("slow");
		expect(pingLevel(250)).toBe("poor");
	});

	test("is said in words, or that it's being measured", () => {
		const room = { kind: "room" as const, id: "r", where: "Lounge · Harbour Lights" };
		expect(pingLabel({ place: room, phase: "connected", ping: 24 })).toBe("Ping: 24 ms");
		expect(pingLabel({ place: room, phase: "connected", ping: null })).toBe("Measuring the ping…");
	});
});

describe("the microphone picker", () => {
	test("names a microphone without a name by its place in the list", () => {
		expect(micName({ id: "a", label: "USB mic" }, 0)).toBe("USB mic");
		expect(micName({ id: "b", label: "" }, 1)).toBe("Microphone 2");
	});

	test("marks the one in use: the one picked, or the system's default when none was", () => {
		expect(isMicInUse({ id: "usb", label: "" }, "usb")).toBe(true);
		expect(isMicInUse({ id: "default", label: "" }, "")).toBe(true);
		expect(isMicInUse({ id: "default", label: "" }, "usb")).toBe(false);
		expect(isMicInUse({ id: "usb", label: "" }, "")).toBe(false);
	});
});

// ── Between the windows ────────────────────────────────────────────────────────────────────────────────────────────

/** Actions that note what they're asked. */
function noted() {
	const asked: string[] = [];
	const actions: MediaActions = {
		toggleMute: () => void asked.push("toggleMute"),
		toggleDeafen: () => void asked.push("toggleDeafen"),
		toggleNoiseSuppression: () => void asked.push("toggleNoiseSuppression"),
		toggleCamera: () => void asked.push("toggleCamera"),
		shareScreen: (withAudio) => void asked.push(`shareScreen ${withAudio}`),
		stopSharing: () => void asked.push("stopSharing"),
		disconnect: () => void asked.push("disconnect"),
		listMics: () => {
			asked.push("listMics");
			return Promise.resolve([{ id: "usb", label: "USB mic" }]);
		},
		selectMic: (id) => void asked.push(`selectMic ${id}`),
		openPlace: () => void asked.push("openPlace"),
	};
	return { asked, actions };
}

describe("the pop-out's commands", () => {
	test("every action has its command, and each command runs its action in the main window", async () => {
		const main = noted();
		const handlers = mediaCommandHandlers(main.actions);
		expect(Object.keys(handlers).sort((a, b) => a.localeCompare(b))).toEqual(
			[...MEDIA_COMMANDS].sort((a, b) => a.localeCompare(b)),
		);
		// The pop-out's side, wired straight to the main window's handlers, as the relay does.
		const popOut = remoteMediaActions((name, args) => Promise.resolve(handlers[name](args)));
		popOut.toggleMute();
		popOut.toggleDeafen();
		popOut.toggleNoiseSuppression();
		popOut.toggleCamera();
		popOut.shareScreen(true);
		popOut.stopSharing();
		popOut.selectMic("usb");
		popOut.openPlace();
		popOut.disconnect();
		expect(await popOut.listMics()).toEqual([{ id: "usb", label: "USB mic" }]);
		expect(main.asked).toEqual([
			"toggleMute",
			"toggleDeafen",
			"toggleNoiseSuppression",
			"toggleCamera",
			"shareScreen true",
			"stopSharing",
			"selectMic usb",
			"openPlace",
			"disconnect",
			"listMics",
		]);
	});

	test("a command with a wrong argument is refused, and runs nothing", () => {
		const main = noted();
		const handlers = mediaCommandHandlers(main.actions);
		expect(() => handlers.shareScreen("yes")).toThrow("shareScreen takes whether to share the sound");
		expect(() => handlers.selectMic(undefined)).toThrow("selectMic takes a microphone's ID");
		expect(main.asked).toEqual([]);
	});

	test("a command the main window didn't take is reported, and changes nothing here", async () => {
		const failures: string[] = [];
		const popOut = remoteMediaActions(
			() => Promise.reject(new Error("The main window is closed")),
			(name, error) => void failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`),
		);
		popOut.toggleMute();
		expect(await popOut.listMics()).toEqual([]);
		await Promise.resolve();
		expect(failures.sort((a, b) => a.localeCompare(b))).toEqual([
			"listMics: The main window is closed",
			"toggleMute: The main window is closed",
		]);
	});

	test("a list of microphones that crossed the RPC keeps only microphones", () => {
		expect(micChoices([{ id: "a", label: "A" }, { id: 3, label: "B" }, null, "c", { id: "d" }])).toEqual([
			{ id: "a", label: "A" },
		]);
		expect(micChoices("nothing")).toEqual([]);
	});
});

describe("a mirrored state", () => {
	const state: MediaState = mediaStateOf(
		inputs({ place: lounge([ME, ANA]), muted: true, camera: true, speaking: new Set(["ana"]), micId: "usb" }),
	);

	test("comes back as it was sent, through JSON", () => {
		expect(parseMediaState(JSON.parse(JSON.stringify(state)))).toEqual(state);
		expect(parseMediaState(JSON.parse(JSON.stringify(IDLE_MEDIA)))).toEqual(IDLE_MEDIA);
	});

	test("anything else isn't a state: the pop-out draws nothing it can't read", () => {
		expect(parseMediaState(null)).toBeNull();
		expect(parseMediaState("muted")).toBeNull();
		expect(parseMediaState({ ...state, muted: "yes" })).toBeNull();
		expect(parseMediaState({ ...state, phase: "ringing" })).toBeNull();
		expect(parseMediaState({ ...state, place: { kind: "space", id: "x", where: "y" } })).toBeNull();
		expect(parseMediaState({ ...state, video: "off" })).toBeNull();
		expect(parseMediaState({ ...state, ping: "24" })).toBeNull();
		expect(parseMediaState({ ...state, faces: "ana" })).toBeNull();
	});

	test("a face that isn't one is left out, and the rest stays", () => {
		const parsed = parseMediaState({ ...state, faces: [...state.faces, { id: 4 }, null] });
		expect(parsed?.faces).toEqual(state.faces);
	});
});
