import { repairOggOpus } from "$lib/audio/ogg";
import { WAVEFORM_SAMPLES } from "$lib/e2e/conventions";

/** What the players of an attachment's audio know of it from its analysis (analyzeWaveform), for its next player: its
 * bars, its duration, whether this browser could decode it only once repaired, and the WAV a player made of it as it
 * played it, if one still holds it (makeWav, #316). A voice note always plays from a WAV; an audio file only when it
 * needed the repair. wavUrl holds nothing but a WAV (#118), and only while something holds it (holdWav): a WAV let go
 * of is forgotten here (releaseWav, #167). */
export interface Waveform {
	bars: number[];
	duration: number;
	repaired?: boolean;
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
	for (const [attachmentId, { wavUrl, ...rest }] of waveformCache) {
		if (wavUrl === url) waveformCache.set(attachmentId, rest);
	}
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

// The rate bars are decoded at: plenty for 80 bars, and a sixth of the samples of a decode at 48 kHz. A browser that
// refuses it (an older WebKit) decodes at 44.1 kHz.
const BARS_RATE = 8000;
// The rate a WAV to play from is made at, Opus's own.
const WAV_RATE = 48000;

// Two decodes for bars run at most at once: a chat that opened with many notes decoded them all together (#316). A
// note's WAV, made as it's played, waits for none of them.
const MAX_DECODES = 2;
let decodes = 0;
const turns: (() => void)[] = [];
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
	if (decodes < MAX_DECODES) decodes++;
	else await new Promise<void>((go) => turns.push(go));
	try {
		return await work();
	} finally {
		// The place goes to the next one waiting, or frees up.
		const next = turns.shift();
		if (next) next();
		else decodes--;
	}
}

function decodingContext(rate: number): OfflineAudioContext {
	try {
		return new OfflineAudioContext(1, 1, rate);
	} catch {
		return new OfflineAudioContext(1, 1, 44100);
	}
}

// What this browser decodes of some audio, at a rate, in an OfflineAudioContext, which opens no audio device; repaired
// says it could decode it only once repaired, and so can't play it as it is either. A Blob is a conversation's file,
// decrypted in memory: read as it is, as no fetch takes a blob: URL under the app's connect-src.
async function decode(source: string | Blob, rate: number): Promise<{ decoded: AudioBuffer; repaired: boolean }> {
	const buf = typeof source === "string" ? await (await fetch(source)).arrayBuffer() : await source.arrayBuffer();
	const ctx = decodingContext(rate);
	try {
		// decodeAudioData detaches the buffer it gets: the original stays for the repair.
		return { decoded: await ctx.decodeAudioData(buf.slice(0)), repaired: false };
	} catch (e) {
		// An Ogg Opus voice note recorded on Android, which Firefox can't decode as it is (lib/audio/ogg.ts).
		const fixed = repairOggOpus(buf);
		if (!fixed) throw e;
		return { decoded: await ctx.decodeAudioData(fixed), repaired: true };
	}
}

/** A WAV of some audio, held once for the caller (wavUrlOf), to play from: made as it's played, since it holds every
 * sample (96 KB a second of a mono note), where the players made one as they mounted and kept it (#316). */
export async function makeWav(source: string | Blob): Promise<string> {
	const { decoded } = await decode(source, WAV_RATE);
	return wavUrlOf(audioBufferToWav(decoded));
}

/** The bars of some audio's waveform and its duration, from what this browser decodes of it at a low rate, two at a
 * time; repaired says it could decode it only once repaired, and so can't play it as it is either. */
export async function analyzeWaveform(
	source: string | Blob,
	barCount: number,
): Promise<{ bars: number[]; duration: number; repaired: boolean }> {
	const url = typeof source === "string" ? source : "decrypted";
	const { decoded, repaired } = await inTurn(() => decode(source, BARS_RATE));
	const duration = decoded.duration;
	const raw = decoded.getChannelData(0);

	const blockSize = Math.floor(raw.length / barCount);
	if (blockSize === 0) return { bars: fallbackBars(url, barCount), duration, repaired };

	const result: number[] = [];
	for (let i = 0; i < barCount; i++) {
		let sum = 0;
		const start = i * blockSize;
		for (let j = start; j < start + blockSize && j < raw.length; j++) {
			sum += Math.abs(raw[j]!);
		}
		result.push(sum / blockSize);
	}

	const max = Math.max(...result, 0.001);
	const bars = result.map((v) => 0.08 + (v / max) * 0.92);

	return { bars, duration, repaired };
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
			const s = Math.max(-1, Math.min(1, channels[ch]![i]!));
			view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
			offset += 2;
		}
	}
	return wav;
}

/** The peak of each of `count` stretches of the samples, a byte each (0 to 255): a voice note's waveform. */
export function peaks(samples: Float32Array, count: number): Uint8Array {
	const out = new Uint8Array(count);
	for (let i = 0; i < count; i++) {
		const start = Math.floor((i * samples.length) / count);
		const end = Math.max(start + 1, Math.floor(((i + 1) * samples.length) / count));
		let peak = 0;
		for (let j = start; j < end && j < samples.length; j++) peak = Math.max(peak, Math.abs(samples[j]!));
		out[i] = Math.round(Math.min(1, peak) * 255);
	}
	return out;
}

/**
 * What a voice note's message says of it (PLAN-E2E-CLIENTES.md, its conventions between clients): its length, and its
 * waveform, the peak of each of its 64 stretches, from what this browser decodes of it at a low rate.
 */
export async function voiceNoteFacts(note: Blob): Promise<{ waveform: Uint8Array; duration_ms: number }> {
	const { decoded } = await inTurn(() => decode(note, BARS_RATE));
	return {
		waveform: peaks(decoded.getChannelData(0), WAVEFORM_SAMPLES),
		duration_ms: Math.round(decoded.duration * 1000),
	};
}
