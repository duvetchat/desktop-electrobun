import { writable, get } from "svelte/store";

export interface VoiceNoteState {
	src: string;
	attachmentId: string;
	authorName: string;
	channelName: string;
	playing: boolean;
	currentTime: number;
	duration: number;
}

const EMPTY: VoiceNoteState | null = null;

export const voiceNote = writable<VoiceNoteState | null>(EMPTY);

let audio: HTMLAudioElement | null = null;
let animFrame = 0;

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

export function playVoiceNote(src: string, attachmentId: string, authorName: string, channelName: string) {
	const current = get(voiceNote);

	// Same note — toggle play/pause
	if (current && current.attachmentId === attachmentId) {
		toggleVoiceNote();
		return;
	}

	cleanup();

	audio = new Audio(src);
	audio.preload = "auto";

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
		audio.play().catch(() => {});
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
