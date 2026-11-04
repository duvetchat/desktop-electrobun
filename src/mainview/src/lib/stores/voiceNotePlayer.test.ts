import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

// The store reaches the API client (to sign a note's URL again), which reads SvelteKit's environment and the API's
// address.
mock.module("$app/environment", () => ({ browser: false }));
Object.assign(globalThis, { VITE_API_URL: "https://api.test", VITE_WS_URL: "", VITE_DOMAIN_TARGET_ENV: "duvet" });
const { playVoiceNote, stopVoiceNote } = await import("$lib/stores/voiceNotePlayer.svelte");
const { releaseWav, wavUrlOf } = await import("$lib/audio/waveform");

/** An <audio> as far as the voice note player uses one; end() plays it to its end. */
class FakeAudio {
	static last: FakeAudio | null = null;
	src: string;
	preload = "";
	volume = 1;
	playbackRate = 1;
	paused = true;
	currentTime = 0;
	duration = NaN;
	private ended: (() => void)[] = [];
	constructor(src: string) {
		this.src = src;
		FakeAudio.last = this;
	}
	addEventListener(type: string, listener: () => void) {
		if (type === "ended") this.ended.push(listener);
	}
	play() {
		this.paused = false;
		return Promise.resolve();
	}
	pause() {
		this.paused = true;
	}
	removeAttribute(name: string) {
		if (name === "src") this.src = "";
	}
	load() {}
	end() {
		for (const listener of this.ended) listener();
	}
}

// Only while this file's tests run: the test files share one global object (#166).
const saved = Object.fromEntries(
	["Audio", "requestAnimationFrame", "cancelAnimationFrame"].map((name) => [name, Reflect.get(globalThis, name)]),
);
beforeAll(() => {
	Object.assign(globalThis, { Audio: FakeAudio, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
});
afterAll(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) Reflect.deleteProperty(globalThis, name);
		else Reflect.set(globalThis, name, value);
	}
});

const wav = new TextEncoder().encode("RIFF....WAVE").buffer;

async function readable(url: string): Promise<boolean> {
	try {
		return (await (await fetch(url)).text()) === "RIFF....WAVE";
	} catch {
		return false;
	}
}

// A note goes on playing once its player is gone (another room, the pins closed): the voice note player holds the WAV
// it plays from until the note stops, ends or another takes its place, and then lets go of it (#167).
describe("the voice note player", () => {
	test("holds the WAV it plays from until another note takes its place, or it's stopped", async () => {
		const a = wavUrlOf(wav);
		await playVoiceNote(a, "note-a", "Ana", "general");
		releaseWav(a); // its player is gone
		expect(await readable(a)).toBe(true);
		// Paused and played again, it's the same note: nothing more to hold.
		await playVoiceNote(a, "note-a", "Ana", "general");
		await playVoiceNote(a, "note-a", "Ana", "general");
		expect(await readable(a)).toBe(true);

		const b = wavUrlOf(wav);
		await playVoiceNote(b, "note-b", "Ana", "general");
		expect(await readable(a)).toBe(false);
		releaseWav(b);
		expect(await readable(b)).toBe(true);
		stopVoiceNote();
		expect(await readable(b)).toBe(false);
	});

	test("lets go of it as the note ends, and it goes once its player lets go of it too", async () => {
		const url = wavUrlOf(wav);
		await playVoiceNote(url, "note-c", "Ana", "general");
		FakeAudio.last?.end();
		expect(await readable(url)).toBe(true); // its player still shows it
		releaseWav(url);
		expect(await readable(url)).toBe(false);
	});

	test("plays a file as it is without holding anything of it", async () => {
		const file = URL.createObjectURL(new Blob([wav], { type: "audio/ogg" }));
		await playVoiceNote(file, "file-d", "Ana", "general", "voice.ogg");
		stopVoiceNote();
		expect(await readable(file)).toBe(true);
		URL.revokeObjectURL(file);
	});
});
