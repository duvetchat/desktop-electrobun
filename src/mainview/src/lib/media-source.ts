import { derived, get, readable, type Readable } from "svelte/store";
import { cancelCall } from "$lib/api/ws/connection";
import { getAvatarURL, getHostURL } from "$lib/common/common";
import { mediaStateOf, type MediaActions, type MediaState, type MicChoice } from "$lib/media-state";
import { callName } from "$lib/now";
import { hasPermission, Permission } from "$lib/permissions";
import {
	activeCall,
	activeVoiceRoomId,
	cameraRequested,
	conversations,
	currentUser,
	gatewaySpaces,
	isCameraOn,
	isDeafened,
	isMuted,
	isScreenSharing,
	noiseSuppression,
	screenShareRequested,
	selectedMicId,
	speakingUsers,
	voiceConnectionState,
} from "$lib/stores.svelte";
import { disconnectVoice, stopScreenShare, toggleDeafen, toggleMute } from "$lib/voice";
import { currentVoicePlace, type VoicePlace } from "$lib/voice-place";

// The media controls in the main window (#357): their state, read from the stores, and what they do there. The
// sidebar's block (MediaControls.svelte) draws this state; the pop-out window mirrors it and sends its commands back
// (lib/media-window.svelte.ts). Only the main window's page imports this: it reaches the gateway connection.

/** How often the ping is measured while in voice. */
export const PING_EVERY_MS = 3000;

/**
 * A ping measured at once and then every `everyMs` while `inVoice` says so and someone reads it; null out of voice,
 * and until the first one. It measures only while it has a subscriber, and its timer ends with the last one: a panel
 * that is gone (a READY remounts the app's UI while voice stays) leaves nothing fetching (#315).
 */
export function pingWhile(
	inVoice: Readable<boolean>,
	measure: () => Promise<number | null>,
	everyMs = PING_EVERY_MS,
): Readable<number | null> {
	return readable<number | null>(null, (set) => {
		let timer: ReturnType<typeof setInterval> | null = null;
		// Each stretch in voice has its number: a measure that answers after it ended says nothing.
		let stretch = 0;
		const once = (mine: number) =>
			void measure().then(
				(ms) => {
					if (mine === stretch && timer !== null) set(ms);
				},
				() => {
					if (mine === stretch && timer !== null) set(null);
				},
			);
		const stop = () => {
			stretch++;
			if (timer !== null) clearInterval(timer);
			timer = null;
		};
		const unsubscribe = inVoice.subscribe((voice) => {
			stop();
			set(null);
			if (!voice) return;
			const mine = stretch;
			timer = setInterval(() => once(mine), everyMs);
			once(mine);
		});
		return () => {
			unsubscribe();
			stop();
		};
	});
}

/** The round trip to the API's health check, in ms. */
async function measureApiPing(): Promise<number | null> {
	const start = performance.now();
	await fetch(`${getHostURL()}/health`, { method: "GET", cache: "no-store" });
	return Math.round(performance.now() - start);
}

/** The ping to the API while the user is in voice. */
export const voicePing: Readable<number | null> = pingWhile(
	derived(activeVoiceRoomId, ($id) => $id !== null),
	measureApiPing,
);

// The Space room the user's voice is in; a call has none, and asks for no permission.
const voiceRoom = derived([activeVoiceRoomId, gatewaySpaces], ([$id, $spaces]) => {
	if (!$id) return null;
	const space = $spaces.find((s) => s.rooms.some((r) => r.id === $id));
	const room = space?.rooms.find((r) => r.id === $id);
	return space && room ? { space, room } : null;
});

/** Whether the user may speak where they are: without SpeakInVoice in a voice room the mic stays muted. */
export const canSpeakInVoice: Readable<boolean> = derived(voiceRoom, ($room) =>
	$room ? hasPermission($room.space, $room.room, Permission.SpeakInVoice) : true,
);

// Video is the camera and the screen; a call needs no permission for it.
const canVideoInVoice = derived(voiceRoom, ($room) =>
	$room ? hasPermission($room.space, $room.room, Permission.Video) : true,
);

const flags = derived(
	[isMuted, isDeafened, noiseSuppression, isCameraOn, isScreenSharing, canSpeakInVoice, canVideoInVoice, selectedMicId],
	([$muted, $deafened, $noise, $camera, $sharing, $canSpeak, $canVideo, $micId]) => ({
		muted: $muted,
		deafened: $deafened,
		noiseSuppression: $noise,
		camera: $camera,
		sharing: $sharing,
		canSpeak: $canSpeak,
		canVideo: $canVideo,
		micId: $micId,
	}),
);

// The call the user places from here, which still rings the others.
const calling = derived([activeCall, conversations, currentUser], ([$call, $conversations, $me]) =>
	$call?.state === "calling"
		? {
				id: $call.conversationId,
				name: callName(
					$conversations.find((c) => c.id === $call.conversationId),
					$me?.id,
				),
			}
		: null,
);

/** The media controls' state, as the stores have it now. */
export const liveMedia: Readable<MediaState> = derived(
	[currentVoicePlace, calling, currentUser, voiceConnectionState, voicePing, flags, speakingUsers],
	([$place, $calling, $me, $connection, $ping, $flags, $speaking]) =>
		mediaStateOf({
			...$flags,
			place: $place && {
				kind: $place.kind,
				id: $place.id,
				name: $place.name,
				space: $place.kind === "room" ? $place.place : null,
				people: $place.states.map((vs) => ({ ...$place.person(vs.user_id), muted: vs.muted })),
			},
			calling: $calling,
			me: $me
				? {
						id: $me.id,
						name: $me.alias || $me.username,
						src: getAvatarURL($me.id, $me.avatar),
						muted: $flags.muted,
					}
				: null,
			connection: $connection,
			ping: $ping,
			speaking: $speaking,
		}),
);

// How the app opens the view of a voice room or a call's chat: the app page's own, which the stream window is given
// (StreamWindow.svelte's onOpen) and hands on here, for the call panel's first line and the pop-out's.
let openPlaceWith: ((place: VoicePlace) => void) | null = null;

/** Sets how a voice place is opened; null once whoever knew is gone. */
export function openVoicePlaceWith(open: ((place: VoicePlace) => void) | null) {
	openPlaceWith = open;
}

// How the app opens a chat that isn't a voice place yet: a call still being placed. The call card is given it
// (CallCard.svelte's onOpen).
let openChatWith: ((conversationId: string) => void) | null = null;

/** Sets how a call's chat is opened while the call still rings; null once whoever knew is gone. */
export function openCallChatWith(open: ((conversationId: string) => void) | null) {
	openChatWith = open;
}

/** The microphones, with their names: before the microphone was ever allowed they have none, so it's asked for first. */
async function listMics(): Promise<MicChoice[]> {
	try {
		const mics = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
		let found = await mics();
		if (found.length > 0 && !found[0]?.label) {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			stream.getTracks().forEach((t) => t.stop());
			found = await mics();
		}
		return found.map((mic) => ({ id: mic.deviceId, label: mic.label }));
	} catch (err) {
		console.error("Failed to fetch media devices:", err);
		return [];
	}
}

/** What the media controls do in the main window, on the stores and the gateway. */
export const liveMediaActions: MediaActions = {
	toggleMute() {
		// Without Speak the mic stays muted: nothing to toggle.
		if (get(canSpeakInVoice)) toggleMute();
	},
	toggleDeafen,
	toggleNoiseSuppression() {
		noiseSuppression.update((on) => !on);
	},
	toggleCamera() {
		const place = get(currentVoicePlace);
		if (place && get(canVideoInVoice)) cameraRequested.set({ roomId: place.id, on: !get(isCameraOn) });
	},
	// The request toggles the share (VoiceChat's toggleScreenShare): made while sharing, it would stop it.
	shareScreen(withAudio) {
		const place = get(currentVoicePlace);
		if (place && get(canVideoInVoice) && !get(isScreenSharing))
			screenShareRequested.set({ roomId: place.id, withAudio });
	},
	stopSharing() {
		const place = get(currentVoicePlace);
		if (place) stopScreenShare(place.id);
	},
	disconnect() {
		const call = get(activeCall);
		// A call still being placed is cancelled, as its card's Cancel does: the gateway decides the rest.
		if (call?.state === "calling") {
			cancelCall(call.conversationId);
			activeCall.set(null);
			return;
		}
		disconnectVoice();
	},
	listMics,
	selectMic(id) {
		selectedMicId.set(id);
	},
	openPlace() {
		const place = get(currentVoicePlace);
		if (place) {
			openPlaceWith?.(place);
			return;
		}
		const call = get(activeCall);
		if (call?.state === "calling") openChatWith?.(call.conversationId);
	},
};
