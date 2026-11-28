// The media controls' state and what they can be asked to do (#357): one shape for the sidebar's block
// (MediaControls.svelte, from the stores) and for the pop-out window (routes/voice-controls, mirrored from the main
// window through lib/window-link.ts). Nothing here reads a store or the gateway: the pop-out's page imports it, and
// that page must never reach lib/api/ws/connection.ts (module-graph.test.ts).
//
// The words are the app's language's (#464), asked for when they're drawn: the state carries what they say (who
// speaks, not "Ana speaking"), so a language change redraws them in both windows. place.where crosses as it is: a
// room's and its Space's names, or a chat's.
import { t } from "$lib/i18n";
import { formatList } from "$lib/i18n/format";

/** Someone in the voice the user is in, as the call panel's faces show them. */
export interface MediaFace {
	id: string;
	name: string;
	src: string | null;
	speaking: boolean;
}

/** Where the user is connected, or whom they call. */
export interface MediaPlace {
	kind: "room" | "call";
	/** activeVoiceRoomId: the room's ID, or the conversation's. */
	id: string;
	/** "Lounge · Harbour Lights", or the chat's name. */
	where: string;
}

/** The voice connection, as the panel's first line says it. */
export type MediaPhase = "calling" | "connecting" | "connected" | "reconnecting" | "failed" | "closed";

/** Why the camera and the screen share can't be used, or null when they can. */
export type VideoBlock = "not-connected" | "no-permission" | null;

export interface MediaState {
	/** null out of voice: the controls are then the one row. */
	place: MediaPlace | null;
	phase: MediaPhase;
	/** The round trip to the API in ms, measured while in voice; null until the first one. */
	ping: number | null;
	muted: boolean;
	deafened: boolean;
	noiseSuppression: boolean;
	camera: boolean;
	sharing: boolean;
	/** Without Speak in the voice room the mic stays muted. */
	canSpeak: boolean;
	video: VideoBlock;
	/** The microphone picked; empty is the system's default. */
	micId: string;
	faces: MediaFace[];
	/** How many more people are there than the faces show. */
	more: number;
	/** The names of whoever speaks now, unmuted, for a screen reader (facesLabel). */
	speakers: string[];
	/** What the voice shows live: someone's screen, else someone's camera (the user's own count). */
	live: MediaLive;
}

/** What a voice room or a call shows live. */
export type MediaLive = "screen" | "camera" | null;

/** The controls before anything is known: out of voice, nothing on. */
export const IDLE_MEDIA: MediaState = {
	place: null,
	phase: "closed",
	ping: null,
	muted: false,
	deafened: false,
	noiseSuppression: true,
	camera: false,
	sharing: false,
	canSpeak: true,
	video: "not-connected",
	micId: "",
	faces: [],
	more: 0,
	speakers: [],
	live: null,
};

/** A microphone of the picker's list. */
export interface MicChoice {
	id: string;
	label: string;
}

/** A camera of the picker's list. */
export interface CameraChoice {
	id: string;
	label: string;
}

/** What the controls do. In the main window they act on the stores; in the pop-out they ask the main window. */
export interface MediaActions {
	toggleMute(): void;
	toggleDeafen(): void;
	toggleNoiseSuppression(): void;
	toggleCamera(): void;
	/** Opens the system's screen picker, in the main window. */
	shareScreen(withAudio: boolean): void;
	stopSharing(): void;
	/** Leaves the voice room, hangs up the call, or cancels the one being placed. */
	disconnect(): void;
	/** The microphones to pick from, with their names (asking for the microphone first when they have none yet). */
	listMics(): Promise<MicChoice[]>;
	selectMic(id: string): void;
	/** Opens the voice room's view, or the call's chat, in the main window. */
	openPlace(): void;
}

/** The connection as RTCPeerConnection says it, as the panel's phase. */
export function phaseOf(connection: RTCPeerConnectionState): MediaPhase {
	switch (connection) {
		case "connected":
			return "connected";
		case "disconnected":
			return "reconnecting";
		case "failed":
			return "failed";
		case "closed":
			return "closed";
		default:
			return "connecting";
	}
}

/** The panel's first line (COPY.md §4.2). A call that is up says "In a call" whatever its room; a voice room says how
 * its connection is. */
export function mediaTitle(state: Pick<MediaState, "place" | "phase">): string {
	switch (state.phase) {
		case "calling":
			return t("call_calling");
		case "connected":
			return state.place?.kind === "call" ? t("call_status_in_call") : t("call_status_voice_connected");
		case "reconnecting":
			return t("call_status_reconnecting");
		case "failed":
			return t("call_status_failed");
		case "closed":
			return t("call_status_disconnected");
		default:
			return t("call_status_connecting");
	}
}

/** Whether the first line reads as live (the green of a connection that is up, or a call that rings). */
export function isLive(state: Pick<MediaState, "phase">): boolean {
	return state.phase === "connected" || state.phase === "calling";
}

/** How the ping reads: fine under 100 ms, slow under 250 ms, poor beyond. Unmeasured counts as fine. */
export type PingLevel = "fine" | "slow" | "poor";

export function pingLevel(ms: number | null): PingLevel {
	if (ms === null || ms < 100) return "fine";
	if (ms < 250) return "slow";
	return "poor";
}

/** The signal tile's tooltip: the ping in words, or that the user is in a call. */
export function pingLabel(state: Pick<MediaState, "place" | "phase" | "ping">): string {
	if (state.phase === "calling") return t("call_calling");
	if (state.place?.kind === "call") return t("call_status_in_call");
	return state.ping === null ? t("call_ping_measuring") : t("call_ping", { ping: state.ping });
}

/** What Disconnect is called where the user is: a call is left, a voice room disconnected from. */
export function leaveLabel(state: Pick<MediaState, "place" | "phase">): string {
	if (state.phase === "calling") return t("call_cancel_call");
	return state.place?.kind === "call" ? t("call_leave_call") : t("call_disconnect");
}

/** The faces, for a screen reader: "3 people in voice, Ana speaking"; nothing when nobody is there (a call being
 * placed, or out of voice). */
export function facesLabel(state: Pick<MediaState, "faces" | "more" | "speakers">): string {
	const count = state.faces.length + state.more;
	if (count === 0) return "";
	if (state.speakers.length === 0) return t("call_people_in_voice", { count });
	return t("call_people_in_voice_speaking", {
		count,
		speakerCount: state.speakers.length,
		// Commas alone, as the label already has its own: "3 people in voice, Ana, Ben speaking".
		speakers: formatList(state.speakers, { type: "unit", style: "short" }),
	});
}

/** What the control that opens the voice the user is in is called: where it goes, and who is there. */
export function openPlaceLabel(state: Pick<MediaState, "place" | "faces" | "more" | "speakers">): string {
	const place = state.place?.where ?? "";
	const people = facesLabel(state);
	return people ? t("call_open_place_with_people", { place, people }) : t("call_open_place", { place });
}

/** The folded edge's one line for the voice the user is in, as a tooltip: how the connection is, where, and what is
 * live there. The edge has no room for the call panel's first row. */
export function placeTip(state: Pick<MediaState, "place" | "phase" | "live">): string {
	const parts = [mediaTitle(state), state.place?.where ?? ""];
	if (state.live) parts.push(liveLabel(state.live));
	return parts.filter(Boolean).join(" · ");
}

/** The live mark's words, its tooltip and what a screen reader hears. */
export function liveLabel(live: "screen" | "camera"): string {
	return live === "screen" ? t("call_live_screen") : t("call_live_camera");
}

/** The camera's and the screen share's tooltip when they can't be used. */
export function videoBlockLabel(block: VideoBlock, kind: "room" | "call" | undefined): string | null {
	if (block === "not-connected") return t("call_video_not_connected");
	if (block === "no-permission") return t("call_video_not_allowed", { place: kind === "call" ? "call" : "room" });
	return null;
}

/** The picker's name for a microphone: its own, or its place in the list. */
export function micName(mic: MicChoice, index: number): string {
	return mic.label || t("call_microphone_numbered", { number: index + 1 });
}

/** The picker's name for a camera: its own, or its place in the list. */
export function cameraName(camera: CameraChoice, index: number): string {
	return camera.label || t("call_camera_numbered", { number: index + 1 });
}

/** Whether a microphone is the one in use: the one picked, or the system's default when none was. */
export function isMicInUse(mic: MicChoice, pickedId: string): boolean {
	return pickedId === mic.id || (pickedId === "" && mic.id === "default");
}

/** The faces the call panel's one row has room for; the rest are a "+N". */
export const MEDIA_FACES = 3;

/** Someone in the voice, as the stores have them. */
export interface MediaPerson {
	id: string;
	name: string;
	src: string | null;
	muted: boolean;
}

/** What the main window knows, from its stores, that the controls show. */
export interface MediaInputs {
	/** The voice room or the call the user is in: its name, its Space's (a room's), and who is there. */
	place: {
		kind: "room" | "call";
		id: string;
		name: string;
		space: string | null;
		people: MediaPerson[];
		/** Someone's screen or camera is on there (lib/now.ts: liveIn). */
		live: MediaLive;
	} | null;
	/** The call the user places from here, which rings the others: its chat's ID and name. */
	calling: { id: string; name: string } | null;
	/** The user, whom the gateway may not list in the place yet, having just joined. */
	me: MediaPerson | null;
	connection: RTCPeerConnectionState;
	ping: number | null;
	muted: boolean;
	deafened: boolean;
	noiseSuppression: boolean;
	camera: boolean;
	sharing: boolean;
	canSpeak: boolean;
	canVideo: boolean;
	micId: string;
	/** Who is speaking now, by ID. */
	speaking: ReadonlySet<string>;
}

/** The controls' state, from what the main window knows. A call being placed shows as its chat, "Calling…"; the voice
 * the user is in comes first, though the app lets no call be placed from one. */
export function mediaStateOf(inputs: MediaInputs): MediaState {
	const { place, calling, me } = inputs;
	const flags = {
		ping: place ? inputs.ping : null,
		muted: inputs.muted,
		deafened: inputs.deafened,
		noiseSuppression: inputs.noiseSuppression,
		camera: inputs.camera,
		sharing: inputs.sharing,
		canSpeak: inputs.canSpeak,
		micId: inputs.micId,
	};
	if (!place) {
		return {
			...flags,
			place: calling ? { kind: "call", id: calling.id, where: calling.name } : null,
			phase: calling ? "calling" : "closed",
			video: "not-connected",
			faces: [],
			more: 0,
			speakers: [],
			live: null,
		};
	}
	// The user's own mute is theirs at once, before the gateway echoes it.
	const listed = place.people.map((person) => (person.id === me?.id ? { ...person, muted: inputs.muted } : person));
	const people = me && !listed.some((person) => person.id === me.id) ? [...listed, me] : listed;
	const speaks = (person: MediaPerson) => inputs.speaking.has(person.id) && !person.muted;
	const shown = people.slice(0, MEDIA_FACES);
	return {
		...flags,
		place: {
			kind: place.kind,
			id: place.id,
			where: place.kind === "room" && place.space ? `${place.name} · ${place.space}` : place.name,
		},
		phase: phaseOf(inputs.connection),
		video: inputs.canVideo ? null : "no-permission",
		faces: shown.map((person) => ({ id: person.id, name: person.name, src: person.src, speaking: speaks(person) })),
		more: people.length - shown.length,
		speakers: people.filter(speaks).map((person) => person.name),
		live: place.live,
	};
}

// ── Between the windows ────────────────────────────────────────────────────────────────────────────────────────────

/** The state channel and the commands' channel of the media controls (lib/window-link.ts). */
export const MEDIA_CHANNEL = "media";

/** The commands the pop-out sends, by name: MediaActions' own. */
export const MEDIA_COMMANDS = [
	"toggleMute",
	"toggleDeafen",
	"toggleNoiseSuppression",
	"toggleCamera",
	"shareScreen",
	"stopSharing",
	"disconnect",
	"listMics",
	"selectMic",
	"openPlace",
] as const satisfies readonly (keyof MediaActions)[];

export type MediaCommandName = (typeof MEDIA_COMMANDS)[number];

/** The main window's answers to the pop-out's commands: each runs the action of its name. What crossed the RPC is
 * untyped, so each argument is checked: a command with a wrong one throws, which the pop-out gets as its answer. */
export function mediaCommandHandlers(actions: MediaActions): Record<MediaCommandName, (args: unknown) => unknown> {
	return {
		toggleMute: () => actions.toggleMute(),
		toggleDeafen: () => actions.toggleDeafen(),
		toggleNoiseSuppression: () => actions.toggleNoiseSuppression(),
		toggleCamera: () => actions.toggleCamera(),
		shareScreen: (args) => {
			if (typeof args !== "boolean") throw new Error("shareScreen takes whether to share the sound");
			actions.shareScreen(args);
		},
		stopSharing: () => actions.stopSharing(),
		disconnect: () => actions.disconnect(),
		listMics: () => actions.listMics(),
		selectMic: (args) => {
			if (typeof args !== "string") throw new Error("selectMic takes a microphone's ID");
			actions.selectMic(args);
		},
		openPlace: () => actions.openPlace(),
	};
}

/** The pop-out's actions: each sends its command to the main window. `send` resolves with the command's result, and
 * rejects when the main window didn't take it. A failed command changes nothing here: the mirrored state is the truth. */
export function remoteMediaActions(
	send: (name: MediaCommandName, args?: unknown) => Promise<unknown>,
	failed: (name: MediaCommandName, error: unknown) => void = () => {},
): MediaActions {
	const fire = (name: MediaCommandName, args?: unknown) => {
		send(name, args).catch((error: unknown) => failed(name, error));
	};
	return {
		toggleMute: () => fire("toggleMute"),
		toggleDeafen: () => fire("toggleDeafen"),
		toggleNoiseSuppression: () => fire("toggleNoiseSuppression"),
		toggleCamera: () => fire("toggleCamera"),
		shareScreen: (withAudio) => fire("shareScreen", withAudio),
		stopSharing: () => fire("stopSharing"),
		disconnect: () => fire("disconnect"),
		listMics: async () => {
			try {
				return micChoices(await send("listMics"));
			} catch (error) {
				failed("listMics", error);
				return [];
			}
		},
		selectMic: (id) => fire("selectMic", id),
		openPlace: () => fire("openPlace"),
	};
}

/** A list of microphones as it crossed the RPC: what isn't one is left out. */
export function micChoices(value: unknown): MicChoice[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item: unknown): MicChoice[] => {
		if (typeof item !== "object" || item === null || !("id" in item) || !("label" in item)) return [];
		return typeof item.id === "string" && typeof item.label === "string" ? [{ id: item.id, label: item.label }] : [];
	});
}

const PHASES: readonly MediaPhase[] = ["calling", "connecting", "connected", "reconnecting", "failed", "closed"];
const FLAGS = ["muted", "deafened", "noiseSuppression", "camera", "sharing", "canSpeak"] as const;

/** A mirrored state as it crossed the RPC, or null for anything else: the pop-out draws nothing it can't read. */
export function parseMediaState(value: unknown): MediaState | null {
	if (typeof value !== "object" || value === null) return null;
	const v: Record<string, unknown> = { ...value };
	if (FLAGS.some((flag) => typeof v[flag] !== "boolean")) return null;
	const phase = PHASES.find((known) => known === v.phase);
	if (!phase) return null;
	if (v.ping !== null && typeof v.ping !== "number") return null;
	if (v.video !== null && v.video !== "not-connected" && v.video !== "no-permission") return null;
	if (typeof v.micId !== "string" || typeof v.more !== "number" || !Array.isArray(v.speakers)) return null;
	if (v.live !== null && v.live !== "screen" && v.live !== "camera") return null;
	const place = parsePlace(v.place);
	if (place === undefined || !Array.isArray(v.faces)) return null;
	const faces = v.faces.flatMap((face: unknown): MediaFace[] => {
		if (typeof face !== "object" || face === null) return [];
		const f: Record<string, unknown> = { ...face };
		if (typeof f.id !== "string" || typeof f.name !== "string" || typeof f.speaking !== "boolean") return [];
		return [{ id: f.id, name: f.name, src: typeof f.src === "string" ? f.src : null, speaking: f.speaking }];
	});
	return {
		place,
		phase,
		ping: v.ping,
		muted: v.muted === true,
		deafened: v.deafened === true,
		noiseSuppression: v.noiseSuppression === true,
		camera: v.camera === true,
		sharing: v.sharing === true,
		canSpeak: v.canSpeak === true,
		video: v.video,
		micId: v.micId,
		faces,
		more: v.more,
		speakers: v.speakers.filter((name: unknown): name is string => typeof name === "string"),
		live: v.live,
	};
}

function parsePlace(value: unknown): MediaPlace | null | undefined {
	if (value === null) return null;
	if (typeof value !== "object") return undefined;
	const p: Record<string, unknown> = { ...value };
	if ((p.kind !== "room" && p.kind !== "call") || typeof p.id !== "string" || typeof p.where !== "string")
		return undefined;
	return { kind: p.kind, id: p.id, where: p.where };
}
