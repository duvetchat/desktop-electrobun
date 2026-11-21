// Copy image, from Duvet's own right-click menu (#423). The page can't read a picture it shows from another origin, but
// Bun can fetch it, as it fetches an activity's image (fetchImageBytes: http(s) only, a few redirects, no compressed
// answer, a size cap). It hands the page the bytes, and the webview puts them on the clipboard itself
// (lib/copy-picture.ts, #450): Electrobun's clipboardWriteImage wrote Windows' "PNG" format alone, which nothing
// pasted, Duvet included. Only a picture goes back: a PNG, or another picture small enough to decode whole (decodable),
// which the page makes a PNG. A frame that has Electrobun's preload (macOS, Linux) can ask for one too: a picture at a
// URL Bun reaches, fetched without cookies.

import { decodable } from "./image-size";

/** The most bytes a picture may have to be copied: Duvet's own storage takes files of 20 MiB at most. */
export const MAX_COPIED_BYTES = 32 << 20;
/** How long the picture's fetch may take, its redirects included: the page gives up on its request after 15 s. */
export const COPY_FETCH_MS = 8_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Whether bytes start as a PNG does. */
export function isPng(bytes: Uint8Array): boolean {
	return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

/**
 * The picture at url, to copy: its bytes, when they're a PNG or another picture small enough to decode whole. Null for
 * what can't be fetched, isn't a picture, or is too big to decode.
 */
export async function pictureToCopy(
	url: string,
	fetchBytes: (url: string) => Promise<Uint8Array | null>,
): Promise<Uint8Array | null> {
	const bytes = await fetchBytes(url);
	if (!bytes) return null;
	return isPng(bytes) || decodable(bytes) ? bytes : null;
}
