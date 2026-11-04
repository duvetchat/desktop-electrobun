import { writable, get } from "svelte/store";
import api from "$lib/api/api";
import { holdWav, releaseWav } from "$lib/audio/waveform";
import { getHostURL } from "$lib/common/common";

export interface VoiceNoteState {
	src: string;
	attachmentId: string;
	authorName: string;
	channelName: string;
	filename?: string;
	playing: boolean;
	currentTime: number;
	duration: number;
}

const EMPTY: VoiceNoteState | null = null;

export const voiceNote = writable<VoiceNoteState | null>(EMPTY);

let audio: HTMLAudioElement | null = null;
// What the note plays from: a WAV of it is held until it stops, so the note goes on once its player is gone (#167).
let playingSrc: string | null = null;
let animFrame = 0;
// The note asked to play last while it waits for its URL to be signed again, and where a seek made meanwhile starts it.
// It plays once it has its URL, unless another note was asked for or a stop came meanwhile (#175).
let waiting: { attachmentId: string; seekTo: number | null } | null = null;

const VOLUME_KEY = "duvet_audio_volume";
let currentVolume = typeof window !== "undefined" ? parseFloat(localStorage.getItem(VOLUME_KEY) ?? "1") : 1;

export const audioVolume = writable<number>(currentVolume);
audioVolume.subscribe((v) => {
	currentVolume = v;
	if (typeof window !== "undefined") localStorage.setItem(VOLUME_KEY, String(v));
	if (audio) audio.volume = v;
});

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const rateByAttachment = new Map<string, (typeof PLAYBACK_RATES)[number]>();
export function getAttachmentRate(attachmentId: string): number {
	return rateByAttachment.get(attachmentId) ?? 1;
}

export function cyclePlaybackRate(attachmentId: string) {
	const curRate = rateByAttachment.get(attachmentId) ?? 1;
	const idx = PLAYBACK_RATES.indexOf(curRate);
	const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
	rateByAttachment.set(attachmentId, next);
	if (audio) {
		const current = get(voiceNote);
		if (current && current.attachmentId === attachmentId) {
			audio.playbackRate = next;
		}
	}
}

function tick() {
	if (!audio) return;
	voiceNote.update((s) => {
		if (!s) return s;
		return { ...s, currentTime: audio!.currentTime };
	});
	if (audio && !audio.paused) animFrame = requestAnimationFrame(tick);
}

function cleanup() {
	// A note still waiting for its URL won't play either.
	waiting = null;
	if (animFrame) {
		cancelAnimationFrame(animFrame);
		animFrame = 0;
	}
	if (audio) {
		audio.pause();
		audio.removeAttribute("src");
		audio.load();
		audio = null;
	}
	releaseWav(playingSrc);
	playingSrc = null;
}

const RESIGN_THRESHOLD_MS = 30 * 60 * 1000; // Re-sign if less than 30 minutes remaining

function isUrlExpiringSoon(url: string): boolean {
	try {
		const match = url.match(/[?&]exp=(\d+)/);
		if (!match) return false;
		const exp = parseInt(match[1], 10) * 1000;
		return exp - Date.now() < RESIGN_THRESHOLD_MS;
	} catch {
		return false;
	}
}

async function refreshSignedUrl(attachmentId: string, currentSrc: string): Promise<string> {
	try {
		// Through the API client: it sends the current access token and refreshes it if needed.
		const res = await api.post<{ url: string }>(`/attachments/${attachmentId}/resign`);
		return `${getHostURL()}${res.data.url}`;
	} catch {
		return currentSrc;
	}
}

// How many times a note was asked to play: a note that waits before it plays (a player, for its analysis; the note itself,
// for its URL) can tell whether another note was asked for meanwhile. Asking again for the note that waits for its URL
// doesn't count: it's on its way already.
let playRequests = 0;
export function voiceNotePlayRequests(): number {
	return playRequests;
}

export async function playVoiceNote(
	src: string,
	attachmentId: string,
	authorName: string,
	channelName: string,
	filename?: string,
) {
	// Asked for again while its URL is signed again (a double click): it plays once, when it has its URL (#175).
	if (waiting?.attachmentId === attachmentId) return;
	const request = ++playRequests;
	const current = get(voiceNote);

	// Same note — toggle play/pause
	if (current && current.attachmentId === attachmentId) {
		toggleVoiceNote();
		return;
	}

	cleanup();

	// Re-sign URL if expiring soon. Nothing plays meanwhile, and the bar shows nothing. If another note is asked for, or a
	// stop comes, before the API answers, that one plays and this one doesn't (#175). It holds nothing while it waits: only
	// a WAV is held, and a WAV's URL is never signed.
	let startAt = 0;
	if (isUrlExpiringSoon(src)) {
		const wait = { attachmentId, seekTo: null as number | null };
		waiting = wait;
		voiceNote.set(null);
		src = await refreshSignedUrl(attachmentId, src);
		if (waiting !== wait || playRequests !== request) return;
		waiting = null;
		startAt = wait.seekTo ?? 0;
	}

	const element = new Audio(src);
	audio = element;
	holdWav(src);
	playingSrc = src;
	element.preload = "auto";
	element.volume = currentVolume;
	element.playbackRate = rateByAttachment.get(attachmentId) ?? 1;
	if (startAt) element.currentTime = startAt;

	// Each handler acts only while its element is the one playing: a note stopped or replaced was cleaned up then, and an
	// event it fires late must not stop or change the note that took its place (#175).
	element.addEventListener("loadedmetadata", () => {
		if (audio === element && isFinite(element.duration)) {
			voiceNote.update((s) => (s ? { ...s, duration: element.duration } : s));
		}
	});

	element.addEventListener("ended", () => {
		if (audio === element) stopVoiceNote();
	});

	voiceNote.set({
		src,
		attachmentId,
		authorName,
		channelName,
		filename,
		playing: true,
		currentTime: startAt,
		duration: 0,
	});

	element.play().catch(() => {
		if (audio === element) voiceNote.update((s) => (s ? { ...s, playing: false } : s));
	});
	animFrame = requestAnimationFrame(tick);
}

export function toggleVoiceNote() {
	if (!audio) return;
	const current = get(voiceNote);
	if (!current) return;
	const element = audio;

	if (current.playing) {
		element.pause();
		voiceNote.update((s) => (s ? { ...s, playing: false } : s));
		if (animFrame) {
			cancelAnimationFrame(animFrame);
			animFrame = 0;
		}
	} else {
		element.play().catch(() => {
			if (audio === element) voiceNote.update((s) => (s ? { ...s, playing: false } : s));
		});
		voiceNote.update((s) => (s ? { ...s, playing: true } : s));
		animFrame = requestAnimationFrame(tick);
	}
}

export function seekVoiceNote(time: number) {
	// A note still waiting for its URL starts there once it has it (#175).
	if (waiting) {
		waiting.seekTo = time;
		return;
	}
	if (!audio) return;
	audio.currentTime = time;
	voiceNote.update((s) => (s ? { ...s, currentTime: time } : s));
}

export function stopVoiceNote() {
	cleanup();
	voiceNote.set(null);
}
