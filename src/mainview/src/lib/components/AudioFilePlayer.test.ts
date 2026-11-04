import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// An audio file plays from the WAV its analysis made when the browser can't play it as it is (fileWavUrl), once that
// analysis is done, as a voice note does; and what it keeps for the next player of it (a voice note's, in Settings →
// Attachments) holds a WAV under wavUrl or nothing, never the file's own URL (#118).
test("an audio file's player plays from the WAV there is, and keeps nothing else as one", () => {
	const player = source("AudioFilePlayer.svelte");
	expect(player).toContain("wavSrc = fileWavUrl(result) ?? null;");
	expect(player).toContain(
		"keepWaveform(attachmentId, { bars, duration: localDuration, wavUrl: wavSrc ?? undefined });",
	);
	expect(player).toContain("wavSrc = cached.wavUrl ?? null;");
	expect(player).toContain("await analysis;");
	expect(player.match(/playVoiceNote\(wavSrc \?\? src,/g)).toHaveLength(2);
	expect(player).not.toMatch(/playVoiceNote\(src,/);
	expect(player).not.toContain("wavUrl: url");
});

test("a voice note's player plays what it was kept with, a WAV or, without one, the file", () => {
	const player = source("VoiceNotePlayer.svelte");
	expect(player).toContain("wavSrc = cached.wavUrl ?? null;");
	expect(player).toContain("keepWaveform(attachmentId, { bars, duration: localDuration, wavUrl: wavSrc });");
});
