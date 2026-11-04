import { repairOggOpus } from "$lib/audio/ogg";

/** What the players of an attachment's audio know of it from its analysis (analyzeWaveform), for its next player: its
 * bars, its duration, and, when it's to play from one, a WAV of it. A voice note always plays from its WAV; an audio
 * file only when this browser couldn't decode it as it is (fileWavUrl). wavUrl holds nothing but a WAV (#118), and only
 * while something holds it (holdWav): a WAV let go of is forgotten here with it (releaseWav, #167). */
export interface Waveform {
	bars: number[];
	duration: number;
	wavUrl?: string;
}

export const waveformCache = new Map<string, Waveform>();
export const MAX_WAVEFORM_CACHE = 50;

/** Keeps an attachment's analysis for its next player, the oldest kept going past MAX_WAVEFORM_CACHE. */
export function keepWaveform(attachmentId: string, waveform: Waveform) {
	if (!attachmentId) return;
	if (waveformCache.size >= MAX_WAVEFORM_CACHE) {
		const firstKey = waveformCache.keys().next().value;
		if (firstKey) waveformCache.delete(firstKey);
	}
	waveformCache.set(attachmentId, waveform);
}

// The WAVs wavUrlOf made that aren't revoked yet, each with how many hold it: the players that show it, and the voice
// note player while it plays from it (lib/stores/voiceNotePlayer.svelte.ts). A WAV holds every sample, megabytes for a
// long note, so the last to let go of one revokes it (#167).
const wavHolds = new Map<string, number>();

/** A URL of the WAV an analysis made of some audio, to play it from, held once for whoever asked for it: it lets go
 * of it with releaseWav. */
export function wavUrlOf(wavBuf: ArrayBuffer): string {
	const url = URL.createObjectURL(new Blob([wavBuf], { type: "audio/wav" }));
	wavHolds.set(url, 1);
	return url;
}

/** Holds a WAV wavUrlOf made once more, for one more player of it. Any other URL (a file's own) is left alone. */
export function holdWav(url: string | null | undefined) {
	if (!url) return;
	const holds = wavHolds.get(url);
	if (holds !== undefined) wavHolds.set(url, holds + 1);
}

/** Lets go of a WAV held once (wavUrlOf, holdWav). The last to let go of it revokes it, and the analysis kept with it
 * is forgotten, as no player could play from it any more: the attachment's next player analyzes it again. */
export function releaseWav(url: string | null | undefined) {
	if (!url) return;
	const holds = wavHolds.get(url);
	if (holds === undefined) return;
	if (holds > 1) {
		wavHolds.set(url, holds - 1);
		return;
	}
	wavHolds.delete(url);
	URL.revokeObjectURL(url);
	for (const [attachmentId, waveform] of waveformCache) {
		if (waveform.wavUrl === url) waveformCache.delete(attachmentId);
	}
}

/** The WAV an audio file plays from, if any: none for one this browser decoded as it is, which plays as it is (a file
 * can be long, and its WAV holds every sample); for one it could decode only once repaired, which it can't play as it
 * is either (an Android voice recording, in Firefox: lib/audio/ogg.ts), the WAV its analysis made, as a voice note plays
 * from (#118), held for the caller (wavUrlOf). */
export function fileWavUrl(result: { repaired: boolean; wavBuf: ArrayBuffer }): string | undefined {
	return result.repaired ? wavUrlOf(result.wavBuf) : undefined;
}

export function fallbackBars(seed: string, barCount: number): number[] {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
	}
	const result: number[] = [];
	for (let i = 0; i < barCount; i++) {
		hash = ((hash << 5) - hash + i * 7) | 0;
		result.push(0.15 + (((hash >>> 0) % 100) / 100) * 0.85);
	}
	return result;
}

/** The bars of some audio's waveform, its duration and a WAV of it, from what this browser decodes of it; repaired says
 * it could decode it only once repaired, and so can't play it as it is either. */
export async function analyzeWaveform(
	url: string,
	barCount: number,
): Promise<{ bars: number[]; duration: number; wavBuf: ArrayBuffer; repaired: boolean }> {
	const res = await fetch(url);
	const buf = await res.arrayBuffer();

	const ctx = new AudioContext();
	let decoded: AudioBuffer;
	let repaired = false;
	try {
		// decodeAudioData detaches the buffer it gets: the original stays for the repair.
		decoded = await ctx.decodeAudioData(buf.slice(0));
	} catch (e) {
		// An Ogg Opus voice note recorded on Android, which Firefox can't decode as it is (lib/audio/ogg.ts).
		const fixed = repairOggOpus(buf);
		if (!fixed) throw e;
		decoded = await ctx.decodeAudioData(fixed);
		repaired = true;
	} finally {
		ctx.close();
	}
	const duration = decoded.duration;
	const raw = decoded.getChannelData(0);

	const wavBuf = audioBufferToWav(decoded);

	const blockSize = Math.floor(raw.length / barCount);
	if (blockSize === 0) return { bars: fallbackBars(url, barCount), duration, wavBuf, repaired };

	const result: number[] = [];
	for (let i = 0; i < barCount; i++) {
		let sum = 0;
		const start = i * blockSize;
		for (let j = start; j < start + blockSize && j < raw.length; j++) {
			sum += Math.abs(raw[j]);
		}
		result.push(sum / blockSize);
	}

	const max = Math.max(...result, 0.001);
	const bars = result.map((v) => 0.08 + (v / max) * 0.92);

	return { bars, duration, wavBuf, repaired };
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
	const numChannels = buffer.numberOfChannels;
	const sampleRate = buffer.sampleRate;
	const bitsPerSample = 16;
	const channels: Float32Array[] = [];
	for (let i = 0; i < numChannels; i++) channels.push(buffer.getChannelData(i));
	const numSamples = buffer.length;
	const dataSize = numSamples * numChannels * (bitsPerSample / 8);
	const headerSize = 44;
	const wav = new ArrayBuffer(headerSize + dataSize);
	const view = new DataView(wav);

	function writeStr(offset: number, s: string) {
		for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
	}
	writeStr(0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeStr(8, "WAVE");
	writeStr(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
	view.setUint16(32, numChannels * (bitsPerSample / 8), true);
	view.setUint16(34, bitsPerSample, true);
	writeStr(36, "data");
	view.setUint32(40, dataSize, true);

	let offset = 44;
	for (let i = 0; i < numSamples; i++) {
		for (let ch = 0; ch < numChannels; ch++) {
			const s = Math.max(-1, Math.min(1, channels[ch][i]));
			view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
			offset += 2;
		}
	}
	return wav;
}
