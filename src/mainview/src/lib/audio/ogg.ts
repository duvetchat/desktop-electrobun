// Ogg Opus voice notes as Android's MediaMuxer writes them (the mobile app's recorder, on Android 10 and later): each
// page carries its packet's start as its granule position instead of its end (RFC 7845), and the last page doesn't end
// the stream. Chromium plays them; Firefox rejects them (NS_ERROR_DOM_MEDIA_METADATA_ERR, and decodeAudioData's
// EncodingError).

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let r = i << 24;
		for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
		table[i] = r >>> 0;
	}
	return table;
})();

/** An Ogg page's CRC (polynomial 0x04c11db7, no reflection), of the page with its CRC field zeroed. */
export function oggCrc(bytes: Uint8Array): number {
	let crc = 0;
	for (const b of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
	return crc;
}

/** How many samples, at 48 kHz, an Opus packet decodes to, from its TOC byte (RFC 6716, 3.1). */
export function opusSamples(packet: ArrayLike<number>): number {
	const config = packet[0] >> 3;
	const ms =
		config < 12 ? [10, 20, 40, 60][config % 4] : config < 16 ? [10, 20][config % 2] : [2.5, 5, 10, 20][config % 4];
	const code = packet[0] & 3;
	const frames = code === 0 ? 1 : code < 3 ? 2 : (packet[1] ?? 0) & 0x3f;
	return frames * ms * 48;
}

/** The file with each page's granule position at the end of the last packet it completes (pre-skip included, -1 on a
 * page that completes none), the last page ending the stream, and the CRCs computed again; null when it isn't whole
 * Ogg pages of one stream, the first packet OpusHead, with three packets at least. */
export function repairOggOpus(input: ArrayBuffer): ArrayBuffer | null {
	const data = new Uint8Array(input.slice(0));
	const view = new DataView(data.buffer);
	const pages: { at: number; length: number; completes: number; samples: number }[] = [];
	let packets = 0;
	// Of the packet being read, only what's needed of it: its first eight bytes (OpusHead's magic, or a TOC byte and a
	// frame count) and its length, so that a file of one huge packet takes no more memory than any other.
	let head: number[] = [];
	let packetLength = 0;
	let pos = 0;
	while (pos < data.length) {
		if (pos + 27 > data.length || view.getUint32(pos, true) !== 0x5367674f) return null; // "OggS"
		if (pages.length > 0 && view.getUint32(pos + 14, true) !== view.getUint32(14, true)) return null; // one stream
		const segments = data[pos + 26];
		let body = pos + 27 + segments;
		const end = body + data.subarray(pos + 27, pos + 27 + segments).reduce((sum, s) => sum + s, 0);
		if (end > data.length) return null;
		let completes = 0;
		let samples = 0;
		for (let i = 0; i < segments; i++) {
			const size = data[pos + 27 + i];
			if (head.length < 8) head.push(...data.subarray(body, body + Math.min(size, 8 - head.length)));
			packetLength += size;
			body += size;
			if (size < 255) {
				if (packets === 0 && String.fromCharCode(...head) !== "OpusHead") return null;
				if (packets >= 2 && packetLength > 0) samples += opusSamples(head);
				packets++;
				completes++;
				head = [];
				packetLength = 0;
			}
		}
		pages.push({ at: pos, length: end - pos, completes, samples });
		pos = end;
	}
	if (packets < 3) return null;
	let total = 0;
	pages.forEach(({ at, length, completes, samples }, i) => {
		total += samples;
		view.setBigInt64(at + 6, completes === 0 ? -1n : BigInt(total), true);
		if (i === pages.length - 1) data[at + 5] |= 4;
		view.setUint32(at + 22, 0, true);
		view.setUint32(at + 22, oggCrc(data.subarray(at, at + length)), true);
	});
	return data.buffer;
}
