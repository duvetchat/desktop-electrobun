import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { get } from "svelte/store";

// The store reaches the API client (to sign a note's URL again), which reads SvelteKit's environment and the API's
// address.
mock.module("$app/environment", () => ({ browser: false }));
Object.assign(globalThis, { VITE_API_URL: "https://api.test", VITE_WS_URL: "", VITE_DOMAIN_TARGET_ENV: "duvet" });
const { playVoiceNote, seekVoiceNote, stopVoiceNote, voiceNote } = await import("$lib/stores/voiceNotePlayer.svelte");
const { releaseWav, wavUrlOf } = await import("$lib/audio/waveform");

/** An <audio> as far as the voice note player uses one; end() plays it to its end. */
class FakeAudio {
	static all: FakeAudio[] = [];
	static last: FakeAudio | null = null;
	// Whether play() waits, as a browser's does while it loads the audio, until pause() aborts it.
	static slowStart = false;
	src: string;
	preload = "";
	volume = 1;
	playbackRate = 1;
	paused = true;
	currentTime = 0;
	duration = NaN;
	private ended: (() => void)[] = [];
	private abortStart: ((error: Error) => void) | null = null;
	constructor(src: string) {
		this.src = src;
		FakeAudio.all.push(this);
		FakeAudio.last = this;
	}
	addEventListener(type: string, listener: () => void) {
		if (type === "ended") this.ended.push(listener);
	}
	play() {
		this.paused = false;
		if (!FakeAudio.slowStart) return Promise.resolve();
		return new Promise<void>((_, reject) => (this.abortStart = reject));
	}
	pause() {
		this.paused = true;
		this.abortStart?.(new DOMException("The play() request was interrupted by a call to pause().", "AbortError"));
		this.abortStart = null;
	}
	removeAttribute(name: string) {
		if (name === "src") this.src = "";
	}
	load() {}
	end() {
		for (const listener of this.ended) listener();
	}
}

// Only while this file's tests run: the test files share one global object (#166). The API client reads the session
// from the browser's storage, which tests don't have.
const saved = Object.fromEntries(
	["Audio", "requestAnimationFrame", "cancelAnimationFrame", "localStorage"].map((name) => [
		name,
		Reflect.get(globalThis, name),
	]),
);
beforeAll(() => {
	Object.assign(globalThis, {
		Audio: FakeAudio,
		requestAnimationFrame: () => 0,
		cancelAnimationFrame: () => {},
		localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
	});
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

/** A note's URL as a message has it once it expires within 30 minutes: the player has it signed again first. */
const expiring = (id: string) => `https://api.test/attachments/${id}?sig=old&exp=${Math.floor(Date.now() / 1000) + 60}`;
const resigned = (id: string) => `https://api.test/attachments/${id}?sig=again&exp=4102444800`;
const playing = () => FakeAudio.all.filter((audio) => !audio.paused).map((audio) => audio.src);

/** The API, answering the requests to sign a note's URL again only when the test says so. */
function slowApi() {
	const pending: { url: string; answer: (res: Response) => void }[] = [];
	const sent: string[] = [];
	const realFetch = globalThis.fetch;
	const fetched = spyOn(globalThis, "fetch").mockImplementation(((
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const url = input instanceof Request ? input.url : input.toString();
		if (!url.endsWith("/resign")) return realFetch(input, init);
		sent.push(url);
		return new Promise<Response>((answer) => pending.push({ url, answer }));
	}) as typeof fetch);
	return {
		sent,
		answer() {
			for (const { url, answer } of pending.splice(0)) {
				const id = url.match(/attachments\/([^/]+)\/resign$/)?.[1] ?? "";
				answer(Response.json({ url: resigned(id).replace("https://api.test", "") }));
			}
		},
		restore: () => fetched.mockRestore(),
	};
}

// While the API signs a note's URL again, the note asked for last is the one that plays, alone; a stop stops it, and a
// seek holds (#175).
describe("a note whose URL is signed again before it plays", () => {
	let api: ReturnType<typeof slowApi>;
	beforeEach(() => {
		FakeAudio.all = [];
		api = slowApi();
	});
	afterEach(() => {
		stopVoiceNote();
		api.restore();
	});

	test("plays once the API answers, and the note asked for next takes its place", async () => {
		const first = playVoiceNote(expiring("note-a"), "note-a", "Ana", "general");
		expect(playing()).toEqual([]);
		api.answer();
		await first;
		expect(playing()).toEqual([resigned("note-a")]);

		const b = wavUrlOf(wav);
		await playVoiceNote(b, "note-b", "Bea", "general");
		expect(playing()).toEqual([b]);
		stopVoiceNote();
		releaseWav(b); // its player is gone
		expect(await readable(b)).toBe(false);
	});

	test("gives way to a note asked for meanwhile, which plays alone", async () => {
		const first = playVoiceNote(expiring("note-a"), "note-a", "Ana", "general");
		const b = wavUrlOf(wav);
		await playVoiceNote(b, "note-b", "Bea", "general");
		api.answer();
		await first;
		expect(playing()).toEqual([b]);
		expect(get(voiceNote)?.attachmentId).toBe("note-b");
		releaseWav(b);
	});

	test("leaves the WAV of the note asked for meanwhile to go once that one stops", async () => {
		const first = playVoiceNote(expiring("note-a"), "note-a", "Ana", "general");
		const b = wavUrlOf(wav);
		await playVoiceNote(b, "note-b", "Bea", "general");
		api.answer();
		await first;
		stopVoiceNote();
		releaseWav(b); // its player is gone
		expect(await readable(b)).toBe(false);
	});

	test("plays once when it's asked for again meanwhile, as by a double click", async () => {
		const first = playVoiceNote(expiring("note-a"), "note-a", "Ana", "general");
		const second = playVoiceNote(expiring("note-a"), "note-a", "Ana", "general");
		api.answer();
		await Promise.all([first, second]);
		expect(api.sent).toEqual(["https://api.test/attachments/note-a/resign"]);
		expect(playing()).toEqual([resigned("note-a")]);
	});

	test("doesn't play once stopped meanwhile", async () => {
		const first = playVoiceNote(expiring("note-a"), "note-a", "Ana", "general");
		stopVoiceNote();
		api.answer();
		await first;
		expect(playing()).toEqual([]);
		expect(get(voiceNote)).toBeNull();
	});

	test("starts where a seek made meanwhile asks", async () => {
		const first = playVoiceNote(expiring("note-a"), "note-a", "Ana", "general");
		seekVoiceNote(3);
		api.answer();
		await first;
		expect(FakeAudio.last?.currentTime).toBe(3);
		expect(get(voiceNote)?.currentTime).toBe(3);
	});
});

// A note stopped, or that another took the place of, can still fire an event: its end, or its start failing. It
// concerns that note alone (#175).
describe("a note that another took the place of", () => {
	afterEach(() => {
		FakeAudio.slowStart = false;
		stopVoiceNote();
	});

	test("ending late leaves the other playing", async () => {
		FakeAudio.all = [];
		const b = wavUrlOf(wav);
		await playVoiceNote(b, "note-b", "Bea", "general");
		const replaced = FakeAudio.last!;
		const d = wavUrlOf(wav);
		await playVoiceNote(d, "note-d", "Dan", "general");
		replaced.end();
		expect(playing()).toEqual([d]);
		expect(get(voiceNote)?.attachmentId).toBe("note-d");
		releaseWav(b);
		releaseWav(d);
	});

	test("failing to start late leaves the other shown as playing", async () => {
		const b = wavUrlOf(wav);
		FakeAudio.slowStart = true;
		await playVoiceNote(b, "note-b", "Bea", "general"); // still loading
		FakeAudio.slowStart = false;
		const d = wavUrlOf(wav);
		await playVoiceNote(d, "note-d", "Dan", "general"); // note-b's start is aborted
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(get(voiceNote)).toMatchObject({ attachmentId: "note-d", playing: true });
		releaseWav(b);
		releaseWav(d);
	});
});
