import { afterEach, describe, expect, test } from "bun:test";
import { holdWav, keepWaveform, releaseWav, waveformCache, wavUrlOf } from "$lib/audio/waveform";

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

	test("is forgotten with its analysis, so no next player gets it once revoked", async () => {
		const note = wavUrlOf(wav);
		const other = wavUrlOf(wav);
		keepWaveform("note", { bars: [0.5], duration: 1, wavUrl: note });
		keepWaveform("other", { bars: [0.5], duration: 1, wavUrl: other });
		keepWaveform("file", { bars: [0.5], duration: 1 });
		releaseWav(note);
		expect(waveformCache.has("note")).toBe(false);
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
		expect(waveformCache.has("note")).toBe(false);
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
