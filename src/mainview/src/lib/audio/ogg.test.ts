import { describe, expect, spyOn, test } from "bun:test";
import { oggCrc, opusSamples, repairOggOpus } from "$lib/audio/ogg";
import { analyzeWaveform } from "$lib/audio/waveform";

const SERIAL = 0x4244293a;

// A page with the given segment sizes and body, its CRC computed.
function rawPage(flags: number, granule: bigint, seq: number, segments: number[], body: Uint8Array, serial = SERIAL) {
	const bytes = new Uint8Array(27 + segments.length + body.length);
	const view = new DataView(bytes.buffer);
	bytes.set([0x4f, 0x67, 0x67, 0x53]); // "OggS"
	bytes[5] = flags;
	view.setBigInt64(6, granule, true);
	view.setUint32(14, serial, true);
	view.setUint32(18, seq, true);
	bytes[26] = segments.length;
	bytes.set(segments, 27);
	bytes.set(body, 27 + segments.length);
	view.setUint32(22, oggCrc(bytes), true);
	return bytes;
}

// A page that holds whole packets.
function page(flags: number, granule: bigint, seq: number, packets: Uint8Array[], serial = SERIAL) {
	const segments = packets.flatMap((p) => [...Array(Math.floor(p.length / 255)).fill(255), p.length % 255]);
	const body = new Uint8Array(packets.reduce((n, p) => n + p.length, 0));
	packets.reduce((at, p) => (body.set(p, at), at + p.length), 0);
	return rawPage(flags, granule, seq, segments, body, serial);
}

function file(...pages: Uint8Array[]) {
	const out = new Uint8Array(pages.reduce((n, p) => n + p.length, 0));
	pages.reduce((at, p) => (out.set(p, at), at + p.length), 0);
	return out.buffer;
}

function pagesOf(buffer: ArrayBuffer) {
	const data = new Uint8Array(buffer);
	const view = new DataView(buffer);
	const pages: { flags: number; granule: bigint; crcOk: boolean }[] = [];
	for (let pos = 0; pos < data.length; ) {
		const segments = data[pos + 26];
		const length = 27 + segments + data.subarray(pos + 27, pos + 27 + segments).reduce((n, s) => n + s, 0);
		const copy = data.slice(pos, pos + length);
		new DataView(copy.buffer).setUint32(22, 0, true);
		pages.push({
			flags: data[pos + 5],
			granule: view.getBigInt64(pos + 6, true),
			crcOk: oggCrc(copy) === view.getUint32(pos + 22, true),
		});
		pos += length;
	}
	return pages;
}

const text = (s: string) => new TextEncoder().encode(s);
// OpusHead: version 1, mono, 312 samples of pre-skip, 48 kHz, no gain, mapping family 0.
const head = new Uint8Array([...text("OpusHead"), 1, 1, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0]);
const tags = new Uint8Array([...text("OpusTags"), 4, 0, 0, 0, ...text("test"), 0, 0, 0, 0]);
// A 20 ms CELT fullband packet (TOC config 31, one frame): 960 samples.
const frame = new Uint8Array([0xf8, 1, 2, 3]);

describe("repairOggOpus", () => {
	test("an Android voice note's pages get their packets' ends, and its last page ends the stream", () => {
		// As Android's MediaMuxer writes them: each page carries its packet's start.
		const android = file(
			page(2, 0n, 0, [head]),
			page(0, 0n, 1, [tags]),
			page(0, 0n, 2, [frame]),
			page(0, 960n, 3, [frame]),
			page(0, 1920n, 4, [frame]),
		);
		const repaired = repairOggOpus(android);
		expect(repaired).not.toBeNull();
		const pages = pagesOf(repaired!);
		expect(pages.map((p) => p.granule)).toEqual([0n, 0n, 960n, 1920n, 2880n]);
		expect(pages.map((p) => p.flags)).toEqual([2, 0, 0, 0, 4]);
		expect(pages.every((p) => p.crcOk)).toBe(true);
		// The input stays as it was.
		expect(pagesOf(android).map((p) => p.granule)).toEqual([0n, 0n, 0n, 960n, 1920n]);
	});

	test("a page that completes no packet gets -1, and the page that completes it counts it", () => {
		const long = new Uint8Array(300).fill(7);
		long[0] = 0xf8;
		const repaired = repairOggOpus(
			file(
				page(2, 0n, 0, [head]),
				page(0, 0n, 1, [tags]),
				rawPage(0, 0n, 2, [255], long.subarray(0, 255)),
				rawPage(1, 0n, 3, [45, 4], new Uint8Array([...long.subarray(255), ...frame])),
			),
		);
		expect(pagesOf(repaired!).map((p) => p.granule)).toEqual([0n, 0n, -1n, 1920n]);
	});

	test("anything but one whole Ogg Opus stream isn't repaired", () => {
		expect(repairOggOpus(text("RIFF....WAVEfmt ").buffer)).toBeNull();
		// Headers alone.
		expect(repairOggOpus(file(page(2, 0n, 0, [head]), page(0, 0n, 1, [tags])))).toBeNull();
		// Ogg Vorbis.
		const vorbis = new Uint8Array([1, ...text("vorbis")]);
		expect(repairOggOpus(file(page(2, 0n, 0, [vorbis]), page(0, 0n, 1, [tags]), page(0, 0n, 2, [frame])))).toBeNull();
		// Two streams.
		expect(
			repairOggOpus(file(page(2, 0n, 0, [head]), page(0, 0n, 1, [tags]), page(0, 0n, 2, [frame], SERIAL + 1))),
		).toBeNull();
		// Cut short.
		expect(repairOggOpus(file(page(2, 0n, 0, [head]), page(0, 0n, 1, [tags])).slice(0, 40))).toBeNull();
	});
});

describe("opusSamples", () => {
	test("counts a packet's samples at 48 kHz from its TOC byte", () => {
		expect(opusSamples(new Uint8Array([0xf8]))).toBe(960); // CELT 20 ms, one frame
		expect(opusSamples(new Uint8Array([0xe0]))).toBe(120); // CELT 2.5 ms
		expect(opusSamples(new Uint8Array([0x68]))).toBe(960); // hybrid 20 ms
		expect(opusSamples(new Uint8Array([0x18]))).toBe(2880); // SILK 60 ms
		expect(opusSamples(new Uint8Array([0x09]))).toBe(1920); // SILK 20 ms, two frames
		expect(opusSamples(new Uint8Array([0x0b, 0x03]))).toBe(2880); // SILK 20 ms, three frames (code 3)
	});
});

describe("analyzeWaveform", () => {
	test("decodes an Android voice note that the browser can't decode as it is, once repaired", async () => {
		const android = file(
			page(2, 0n, 0, [head]),
			page(0, 0n, 1, [tags]),
			page(0, 0n, 2, [frame]),
			page(0, 960n, 3, [frame]),
			page(0, 1920n, 4, [frame]),
		);
		const decoded: bigint[] = [];
		// A browser that, like Firefox, rejects an Ogg Opus stream whose first audio page ends at 0.
		class StrictAudioContext {
			async decodeAudioData(buffer: ArrayBuffer) {
				const first = pagesOf(buffer)[2].granule;
				decoded.push(first);
				if (first === 0n) throw new DOMException("invalid content", "EncodingError");
				const length = 2880;
				return {
					duration: length / 48000,
					numberOfChannels: 1,
					sampleRate: 48000,
					length,
					getChannelData: () => new Float32Array(length).fill(0.5),
				};
			}
			close() {}
		}
		const fetched = spyOn(globalThis, "fetch").mockResolvedValue(new Response(android));
		const saved = (globalThis as Record<string, unknown>).AudioContext;
		(globalThis as Record<string, unknown>).AudioContext = StrictAudioContext;
		try {
			const result = await analyzeWaveform("/attachments/a?stream=1", 4);
			expect(decoded).toEqual([0n, 960n]);
			expect(result.duration).toBe(0.06);
			expect(result.bars).toHaveLength(4);
			expect(new TextDecoder().decode(result.wavBuf.slice(0, 4))).toBe("RIFF");
		} finally {
			fetched.mockRestore();
			(globalThis as Record<string, unknown>).AudioContext = saved;
		}
	});
});
