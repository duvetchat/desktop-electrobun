import { repairOggOpus } from "$lib/audio/ogg";

export const waveformCache = new Map<string, { bars: number[]; wavUrl: string; duration: number }>();
export const MAX_WAVEFORM_CACHE = 50;

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

export async function analyzeWaveform(
	url: string,
	barCount: number,
): Promise<{ bars: number[]; duration: number; wavBuf: ArrayBuffer }> {
	const res = await fetch(url);
	const buf = await res.arrayBuffer();

	const ctx = new AudioContext();
	let decoded: AudioBuffer;
	try {
		// decodeAudioData detaches the buffer it gets: the original stays for the repair.
		decoded = await ctx.decodeAudioData(buf.slice(0));
	} catch (e) {
		// An Ogg Opus voice note recorded on Android, which Firefox can't decode as it is (lib/audio/ogg.ts).
		const repaired = repairOggOpus(buf);
		if (!repaired) throw e;
		decoded = await ctx.decodeAudioData(repaired);
	} finally {
		ctx.close();
	}
	const duration = decoded.duration;
	const raw = decoded.getChannelData(0);

	const wavBuf = audioBufferToWav(decoded);

	const blockSize = Math.floor(raw.length / barCount);
	if (blockSize === 0) return { bars: fallbackBars(url, barCount), duration, wavBuf };

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

	return { bars, duration, wavBuf };
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
