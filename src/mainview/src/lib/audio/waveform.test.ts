import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	analyzeWaveform,
	holdWav,
	keepWaveform,
	makeWav,
	releaseWav,
	waveformCache,
	wavUrlOf,
} from "$lib/audio/waveform";

const wav = new TextEncoder().encode("RIFF....WAVE").buffer;

/** Whether the WAV behind a URL can still be read: a revoked one can't. */
async function readable(url: string): Promise<boolean> {
	try {
		return (await (await fetch(url)).text()) === "RIFF....WAVE";
	} catch {
		return false;
	}
}

// A WAV holds every sample of its audio, megabytes for a long note. It's held by the players that show it and by the
// voice note player while it plays from it: the last of them to let go of it revokes it, and nothing keeps it for a
// next player (#167).
describe("a WAV of an analysis", () => {
	afterEach(() => waveformCache.clear());

	test("is revoked once the player it was made for lets go of it", async () => {
		const url = wavUrlOf(wav);
		expect(await readable(url)).toBe(true);
		releaseWav(url);
		expect(await readable(url)).toBe(false);
	});

	test("stays while another player of it, or the voice note player, still holds it", async () => {
		const url = wavUrlOf(wav);
		holdWav(url); // the note shown in a second place
		holdWav(url); // and playing
		releaseWav(url);
		releaseWav(url);
		expect(await readable(url)).toBe(true);
		releaseWav(url);
		expect(await readable(url)).toBe(false);
	});

	// The bars stay for the next player, which makes a WAV of its own if it plays (#316).
	test("is forgotten by its analysis, so no next player gets it once revoked", async () => {
		const note = wavUrlOf(wav);
		const other = wavUrlOf(wav);
		keepWaveform("note", { bars: [0.5], duration: 1, wavUrl: note });
		keepWaveform("other", { bars: [0.5], duration: 1, wavUrl: other });
		keepWaveform("file", { bars: [0.5], duration: 1 });
		releaseWav(note);
		expect(waveformCache.get("note")).toEqual({ bars: [0.5], duration: 1 });
		// Another note's WAV, and a file this browser plays as it is, which has none, stay.
		expect(waveformCache.get("other")?.wavUrl).toBe(other);
		expect(waveformCache.get("file")).toEqual({ bars: [0.5], duration: 1 });
		expect(await readable(other)).toBe(true);
		releaseWav(other);
	});

	test("that a newer analysis replaced is revoked only once its own players let go of it", async () => {
		const first = wavUrlOf(wav);
		keepWaveform("note", { bars: [0.5], duration: 1, wavUrl: first });
		// The note shown in a second place before the first player's analysis ended: it made a WAV of its own.
		const second = wavUrlOf(wav);
		keepWaveform("note", { bars: [0.5], duration: 1, wavUrl: second });
		expect(await readable(first)).toBe(true);
		releaseWav(first);
		expect(await readable(first)).toBe(false);
		expect(waveformCache.get("note")?.wavUrl).toBe(second);
		releaseWav(second);
		expect(await readable(second)).toBe(false);
		expect(waveformCache.get("note")?.wavUrl).toBeUndefined();
	});

	test("leaves alone what isn't a WAV it holds: a file's own URL, none, or one let go of already", async () => {
		const file = URL.createObjectURL(new Blob([wav], { type: "audio/ogg" }));
		holdWav(file);
		releaseWav(file);
		releaseWav(null);
		releaseWav(undefined);
		expect(await readable(file)).toBe(true);
		URL.revokeObjectURL(file);

		// Let go of twice, or held again once it went, a WAV changes nothing for another one.
		const gone = wavUrlOf(wav);
		const other = wavUrlOf(wav);
		releaseWav(gone);
		releaseWav(gone);
		holdWav(gone);
		releaseWav(gone);
		expect(await readable(gone)).toBe(false);
		expect(await readable(other)).toBe(true);
		releaseWav(other);
	});
});

// #316: every player decoded its whole audio as it mounted, in an AudioContext of its own (an audio device), all at once
// as a chat opened, and a voice note kept a 16-bit WAV of every sample (96 KB a second at 48 kHz) while it showed. Now
// the bars come from a decode at a low rate, two at a time, and the WAV is made when the note plays.
describe("an analysis and a WAV", () => {
	const rates: number[] = [];
	const pending: (() => void)[] = [];
	let decoding = 0;
	let most = 0;
	// Web Audio's decoder as these use it: the rate each context is made at, and how many decodes run at once, each
	// ending when the test lets it with 2 s of audio at its context's rate.
	class FakeOfflineContext {
		constructor(
			_channels: number,
			_length: number,
			readonly sampleRate: number,
		) {
			rates.push(sampleRate);
		}
		decodeAudioData(_data: ArrayBuffer): Promise<AudioBuffer> {
			decoding++;
			most = Math.max(most, decoding);
			const rate = this.sampleRate;
			return new Promise((resolve) =>
				pending.push(() => {
					decoding--;
					const samples = new Float32Array(2 * rate).fill(0.25);
					resolve({
						duration: 2,
						length: 2 * rate,
						sampleRate: rate,
						numberOfChannels: 1,
						getChannelData: () => samples,
					} as unknown as AudioBuffer);
				}),
			);
		}
	}
	const realFetch = globalThis.fetch;
	const settle = () => Bun.sleep(0);

	beforeEach(() => {
		rates.length = 0;
		pending.length = 0;
		decoding = most = 0;
		Object.assign(globalThis, {
			OfflineAudioContext: FakeOfflineContext,
			AudioContext: class {
				constructor() {
					throw new Error("an audio device opened");
				}
			},
		});
		spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) =>
			String(input).startsWith("blob:")
				? realFetch(input, init)
				: Promise.resolve(new Response(new Uint8Array(32)))) as typeof fetch);
	});
	afterEach(() => {
		(globalThis.fetch as unknown as { mockRestore(): void }).mockRestore();
		Reflect.deleteProperty(globalThis, "OfflineAudioContext");
		Reflect.deleteProperty(globalThis, "AudioContext");
		waveformCache.clear();
	});

	test("decodes at 8 kHz, with no audio device, and makes no WAV", async () => {
		const analysis = analyzeWaveform("https://files.test/note.ogg", 10);
		await settle();
		pending.shift()?.();
		const result = await analysis;
		expect(rates).toEqual([8000]);
		expect(result.duration).toBe(2);
		expect(result.bars).toHaveLength(10);
		expect(result.repaired).toBe(false);
		expect(Object.keys(result).sort()).toEqual(["bars", "duration", "repaired"]);
	});

	test("decodes two at a time at most, and the others in their turn", async () => {
		const analyses = Array.from({ length: 5 }, (_, i) => analyzeWaveform(`https://files.test/${i}.ogg`, 10));
		for (let done = 0; done < 5; done++) {
			await settle();
			expect(decoding).toBeLessThanOrEqual(2);
			pending.shift()?.();
		}
		expect((await Promise.all(analyses)).map((r) => r.duration)).toEqual([2, 2, 2, 2, 2]);
		expect(most).toBe(2);
	});

	test("a WAV is made when asked for, at 48 kHz, and held for whoever asked", async () => {
		const made = makeWav("https://files.test/note.ogg");
		await settle();
		pending.shift()?.();
		const url = await made;
		expect(rates).toEqual([48000]);
		expect(await (await fetch(url)).text()).toStartWith("RIFF");
		releaseWav(url);
		expect(await readable(url)).toBe(false);
	});
});
