// Copy image, from Duvet's own right-click menu (#423). The page can't read a picture it shows from another origin, but
// Bun can fetch it, as it fetches an activity's image (fetchImageBytes: http(s) only, a few redirects, no compressed
// answer, a size cap), and Electrobun's clipboard takes a PNG on every system (clipboardWriteImage: on Windows as the
// "PNG" clipboard format alone, which browsers, chat apps and Office paste, and apps that read only a bitmap don't). A
// PNG goes as it is; another picture is made a PNG by the webview, which has the decoder Bun lacks, once its headers
// say it isn't too big to decode whole (decodable). Nothing it fetched goes back to the page: the answer is whether it
// was copied, so a frame that has Electrobun's preload gets no more out of this than the clipboard overwritten.

import { decodable } from "./image-size";

/** The most bytes a picture may have to be copied: Duvet's own storage takes files of 20 MiB at most. */
export const MAX_COPIED_BYTES = 32 << 20;
/** How long the picture's fetch may take, its redirects included. */
export const COPY_FETCH_MS = 8_000;
/** How long the copy may take in all: the page gives up on its request after 15 s (lib/electrobun-rpc.ts). */
export const COPY_WITHIN_MS = 13_000;

/** What a copy needs: the picture's bytes, the webview's PNG of a picture, and the clipboard. */
export interface ImageCopier {
	fetchBytes(url: string): Promise<Uint8Array | null>;
	/** The PNG the webview makes of a picture, or null when it can't. */
	toPng(bytes: Uint8Array): Promise<Uint8Array | null>;
	write(png: Uint8Array): void;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Whether bytes start as a PNG does. */
export function isPng(bytes: Uint8Array): boolean {
	return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

/**
 * Copies the picture at url to the clipboard: true once it's there. False, and the clipboard as it was, for what
 * can't be fetched, isn't a picture, is too big to decode, can't be made a PNG, or took longer than COPY_WITHIN_MS,
 * by when the page has said it failed.
 */
export async function copyImage(url: string, deps: ImageCopier, now: () => number = Date.now): Promise<boolean> {
	const until = now() + COPY_WITHIN_MS;
	const bytes = await deps.fetchBytes(url);
	if (!bytes) return false;
	let png: Uint8Array | null = bytes;
	if (!isPng(bytes)) png = decodable(bytes) ? await deps.toPng(bytes) : null;
	if (!png || !isPng(png) || now() > until) return false;
	deps.write(png);
	return true;
}
