import { writable, get } from "svelte/store";
import api from "$lib/api/api";
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
let animFrame = 0;

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

export async function playVoiceNote(
	src: string,
	attachmentId: string,
	authorName: string,
	channelName: string,
	filename?: string,
) {
	const current = get(voiceNote);

	// Same note — toggle play/pause
	if (current && current.attachmentId === attachmentId) {
		toggleVoiceNote();
		return;
	}

	cleanup();

	// Re-sign URL if expiring soon
	if (isUrlExpiringSoon(src)) {
		src = await refreshSignedUrl(attachmentId, src);
	}

	audio = new Audio(src);
	audio.preload = "auto";
	audio.volume = currentVolume;
	audio.playbackRate = rateByAttachment.get(attachmentId) ?? 1;

	audio.addEventListener("loadedmetadata", () => {
		if (audio && isFinite(audio.duration)) {
			voiceNote.update((s) => (s ? { ...s, duration: audio!.duration } : s));
		}
	});

	audio.addEventListener("ended", () => {
		cleanup();
		voiceNote.set(null);
	});

	voiceNote.set({
		src,
		attachmentId,
		authorName,
		channelName,
		filename,
		playing: true,
		currentTime: 0,
		duration: 0,
	});

	audio.play().catch(() => {
		voiceNote.update((s) => (s ? { ...s, playing: false } : s));
	});
	animFrame = requestAnimationFrame(tick);
}

export function toggleVoiceNote() {
	if (!audio) return;
	const current = get(voiceNote);
	if (!current) return;

	if (current.playing) {
		audio.pause();
		voiceNote.update((s) => (s ? { ...s, playing: false } : s));
		if (animFrame) {
			cancelAnimationFrame(animFrame);
			animFrame = 0;
		}
	} else {
		audio.play().catch(() => {
			voiceNote.update((s) => (s ? { ...s, playing: false } : s));
		});
		voiceNote.update((s) => (s ? { ...s, playing: true } : s));
		animFrame = requestAnimationFrame(tick);
	}
}

export function seekVoiceNote(time: number) {
	if (!audio) return;
	audio.currentTime = time;
	voiceNote.update((s) => (s ? { ...s, currentTime: time } : s));
}

export function stopVoiceNote() {
	cleanup();
	voiceNote.set(null);
}
