// The size an image says it has, read from its headers before anything decodes it (desktop#148). The webview decodes
// an activity's image whole to make it small, at 4 bytes a pixel whatever the file's size: a 31 KB PNG of 16000×16000
// took Chromium a GB and WebKit two. So an image is made inline only when its headers say it's small enough.

/** The most pixels an image may have across or down to be decoded: 4096×4096 takes 64 MiB. */
export const MAX_DECODED_SIDE = 4096;

export interface ImageSize {
	width: number;
	height: number;
}

/**
 * The size a PNG, JPEG, GIF or WebP image is decoded at, as its headers say, a GIF's widened to its frames as browsers
 * do; null for anything else, or headers cut short.
 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const text = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
	if (bytes.length >= 24 && text(1, 3) === "PNG" && bytes[0] === 0x89 && text(12, 4) === "IHDR") {
		return { width: view.getUint32(16), height: view.getUint32(20) };
	}
	if (bytes.length >= 10 && (text(0, 6) === "GIF87a" || text(0, 6) === "GIF89a")) return gifSize(bytes, view);
	if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes, view);
	if (bytes.length >= 30 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") return webpSize(bytes, view, text);
	return null;
}

// A GIF's logical screen, widened to each frame's bounds: its header, its color table, then its blocks up to the
// trailer.
function gifSize(bytes: Uint8Array, view: DataView): ImageSize | null {
	let width = view.getUint16(6, true);
	let height = view.getUint16(8, true);
	const colorTable = (packed: number) => (packed & 0x80 ? 3 << ((packed & 7) + 1) : 0);
	// Past a block's data sub-blocks, which start at i.
	const subBlocksEnd = (i: number) => {
		while (i < bytes.length && bytes[i] !== 0) i += bytes[i] + 1;
		return i < bytes.length ? i + 1 : -1;
	};
	for (let i = 13 + colorTable(bytes[10]); i >= 0 && i < bytes.length; ) {
		if (bytes[i] === 0x3b) return { width, height }; // the trailer
		if (bytes[i] === 0x21) {
			i = subBlocksEnd(i + 2); // an extension: its label, then its data
		} else if (bytes[i] === 0x2c && i + 10 <= bytes.length) {
			// A frame: where it is and its size, its color table, its LZW code size, then its data.
			width = Math.max(width, view.getUint16(i + 1, true) + view.getUint16(i + 5, true));
			height = Math.max(height, view.getUint16(i + 3, true) + view.getUint16(i + 7, true));
			i = subBlocksEnd(i + 10 + colorTable(bytes[i + 9]) + 1);
		} else {
			return null;
		}
	}
	return null; // cut short of its trailer
}

// A JPEG's size, from its first frame header (SOF): its segments are each a marker, then most of them a length.
function jpegSize(bytes: Uint8Array, view: DataView): ImageSize | null {
	for (let i = 2; i + 4 <= bytes.length; ) {
		if (bytes[i] !== 0xff) return null;
		const marker = bytes[i + 1];
		if (marker === 0xff) {
			i++; // fill
			continue;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
			i += 2; // no length
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) return null; // its end, or its data, before any frame header
		const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isFrame && i + 9 <= bytes.length) {
			const height = view.getUint16(i + 5);
			const width = view.getUint16(i + 7);
			return width && height ? { width, height } : null;
		}
		i += 2 + view.getUint16(i + 2);
	}
	return null;
}

// A WebP's size, from its first chunk: a simple image's (VP8 or VP8L), or an extended one's canvas (VP8X), which every
// frame lies inside.
function webpSize(bytes: Uint8Array, view: DataView, text: (at: number, length: number) => string): ImageSize | null {
	const chunk = text(12, 4);
	const at = 20; // the chunk's payload
	if (chunk === "VP8 " && bytes[at + 3] === 0x9d && bytes[at + 4] === 0x01 && bytes[at + 5] === 0x2a) {
		return { width: view.getUint16(at + 6, true) & 0x3fff, height: view.getUint16(at + 8, true) & 0x3fff };
	}
	if (chunk === "VP8L" && bytes[at] === 0x2f) {
		const bits = view.getUint32(at + 1, true);
		return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
	}
	if (chunk === "VP8X") {
		const le24 = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
		return { width: le24(at + 4) + 1, height: le24(at + 7) + 1 };
	}
	return null;
}

/** Whether an image's headers say it may be decoded: one of those formats, MAX_DECODED_SIDE a side at most. */
export function decodable(bytes: Uint8Array): boolean {
	const size = imageSize(bytes);
	return (
		!!size && size.width > 0 && size.height > 0 && size.width <= MAX_DECODED_SIDE && size.height <= MAX_DECODED_SIDE
	);
}
