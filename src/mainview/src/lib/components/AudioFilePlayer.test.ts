import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8").replaceAll("\r\n", "\n");
const players = ["VoiceNotePlayer.svelte", "AudioFilePlayer.svelte"];

// #316: a player's analysis gives its bars and duration only, and keeps them for the next player of its audio; the WAV
// to play from, which holds every sample, is made as the audio is played, where every player made one as it mounted.
test("a player's analysis makes no WAV, and keeps only what it found", () => {
	for (const file of players) {
		const player = source(file);
		const analysis = player.slice(
			player.indexOf("async function loadAndAnalyze"),
			player.indexOf("\n\t}\n", player.indexOf("async function loadAndAnalyze")),
		);
		expect(analysis).toContain("await analyzeWaveform(streamUrl, BAR_COUNT);");
		expect(analysis).not.toMatch(/wavUrlOf|makeWav|wavSrc =/);
		expect(player).not.toContain("wavBuf");
	}
	// Whether the audio needed the repair goes with them: an audio file's next player plays from a WAV only then.
	for (const file of players) {
		const player = source(file);
		expect(player).toContain("keepWaveform(attachmentId, { bars, duration: localDuration, repaired });");
		expect(player).toContain("keepWaveform(attachmentId, { bars, duration: localDuration, repaired, wavUrl: url });");
		expect(player).toMatch(/repaired = cached\.repaired \?\? false;/);
	}
});

// A voice note always plays from a WAV: an Android voice note doesn't play as it is in Firefox (#118). An audio file
// plays as it is, from its WAV only when this browser could decode it only once repaired.
test("the WAV is made as the audio plays, once, and only when a file needs one", () => {
	for (const file of players) {
		const player = source(file);
		expect(player.match(/makeWav\(/g)).toHaveLength(1);
		expect(player).toMatch(/wavMaking \?\?= makeWav\(/);
	}
	const note = source("VoiceNotePlayer.svelte");
	expect(note).toContain("const from = (await wav()) ?? src;");
	const audioFile = source("AudioFilePlayer.svelte");
	expect(audioFile).toContain("await analysis;");
	expect(audioFile).toContain("const from = (repaired ? await wav() : null) ?? src;");
	for (const player of [note, audioFile]) {
		// Played or sought, it plays from there, once it has it, if no other note was asked to play meanwhile.
		expect(player.match(/playVoiceNote\(/g)).toHaveLength(1);
		expect(player).toMatch(
			/if \(destroyed \|\| voiceNotePlayRequests\(\) !== requests\) return;\s*playVoiceNote\(from,/,
		);
	}
});

// Each player holds the WAV it plays from while it's there, the one kept for it as the one it made (lib/audio/
// waveform.ts), and lets go of it when it goes; one made after it's gone is let go of at once (#167).
test("a player holds its WAV while it's there, and lets go of one made once it's gone", () => {
	for (const file of players) {
		const player = source(file);
		expect(player).toMatch(/onDestroy\(\(\) => \{\s*destroyed = true;\s*\/\/[^\n]*\n\s*releaseWav\(wavSrc\);\s*\}\);/);
		expect(player).toMatch(/wavSrc = cached\.wavUrl \?\? null;\s*holdWav\(wavSrc\);/);
		expect(player).toMatch(/if \(destroyed\) \{\s*releaseWav\(url\);\s*return null;\s*\}/);
	}
});

// #325: the player read the file's duration through a second Audio of it, which nothing let go of.
test("an audio file's duration probe lets go of the file once it has its duration, or as the player goes", () => {
	const player = source("AudioFilePlayer.svelte");
	expect(player).toMatch(/const release = \(\) => \{\s*probe\.removeAttribute\("src"\);\s*probe\.load\(\);\s*\};/);
	expect(player).toMatch(/probe\.addEventListener\("loadedmetadata", \(\) => \{[^}]*release\(\);\s*\}\);/);
	expect(player).toMatch(/releaseProbe = release;/);
	expect(player).toContain("onDestroy(() => releaseProbe?.());");
});

// A conversation's audio and voice notes, decrypted in memory (lib/e2e/decrypted-files): a player takes the file's
// Blob, which its analysis and its WAV read as it is (no fetch of a blob: URL, which the app's connect-src doesn't take);
// it plays from the Blob's URL.
test("a player takes a decrypted file's Blob, and reads it as it is", () => {
	for (const file of players) {
		const player = source(file);
		expect(player).toMatch(/blob = null,/);
		expect(player).toMatch(/blob\?: Blob \| null;/);
		expect(player).toContain("const streamUrl = blob ?? streamOf(url);");
		expect(player).toContain("wavMaking ??= makeWav(blob ?? streamOf(src))");
	}
});
