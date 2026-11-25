// What the page works out of a file the person sends in a conversation (PLAN-E2E-CLIENTES.md, its conventions between
// clients): a picture's or a video's size and its thumbnail, 320 px on its longer side at most, a JPEG, or a PNG when it
// has transparency, drawn by the browser's canvas. The engine seals the file and what's said of it (engine/files.ts);
// a voice note's facts are lib/audio/waveform.ts's. And a GIF of the picker's, which goes as a file of its own.
import { fetchWithin, requestLimits } from "$lib/api/api";
import { base64Bytes } from "$lib/activity-thumbnail";
import { getElectrobunRpc } from "$lib/electrobun-rpc";
import { SNIFF_PREFIX, sniffType } from "./conventions";
import type { OutgoingFile } from "./engine/files";

/** A thumbnail's longer side, at most. */
export const THUMBNAIL_SIDE = 320;
/** How long a video may take to show its first frame before it goes without a thumbnail. */
const VIDEO_WAIT_MS = 10_000;
/** The most bytes a GIF the picker gives may have: what Duvet's storage takes of one file. */
const MAX_GIF = 20 << 20;

/** A thumbnail's size: its picture's proportions, its longer side at most THUMBNAIL_SIDE; null for no picture. */
export function thumbnailSize(width: number, height: number): { width: number; height: number } | null {
	if (!(width > 0 && height > 0)) return null;
	const scale = Math.min(1, THUMBNAIL_SIDE / Math.max(width, height));
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Whether RGBA pixels have no transparency: a JPEG holds them. */
export function opaque(pixels: Uint8ClampedArray): boolean {
	for (let at = 3; at < pixels.length; at += 4) if (pixels[at] !== 255) return false;
	return true;
}

/** A picture or a video frame drawn as its thumbnail: a JPEG, or a PNG when it has transparency; null when it can't. */
async function thumbnailOf(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
	const size = thumbnailSize(width, height);
	if (!size) return null;
	const canvas = document.createElement("canvas");
	Object.assign(canvas, size);
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.drawImage(source, 0, 0, size.width, size.height);
	const type = opaque(context.getImageData(0, 0, size.width, size.height).data) ? "image/jpeg" : "image/png";
	return new Promise((resolve) => canvas.toBlob(resolve, type, 0.7));
}

/** A picture's size and thumbnail (its first frame, a GIF's), or nothing when this browser can't decode it. */
async function pictureFacts(file: Blob): Promise<Partial<OutgoingFile>> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return {};
	}
	try {
		const thumbnail = await thumbnailOf(bitmap, bitmap.width, bitmap.height);
		return { width: bitmap.width, height: bitmap.height, ...(thumbnail ? { thumbnail } : {}) };
	} finally {
		bitmap.close();
	}
}

/** A video's size, length and a thumbnail of its first frame, or nothing when this browser can't play it in time. */
async function videoFacts(file: Blob): Promise<Partial<OutgoingFile>> {
	const url = URL.createObjectURL(file);
	const video = document.createElement("video");
	video.muted = true;
	video.preload = "auto";
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("the video didn't load in time")), VIDEO_WAIT_MS);
			video.onloadeddata = () => {
				clearTimeout(timer);
				resolve();
			};
			video.onerror = () => {
				clearTimeout(timer);
				reject(new Error("the video didn't load"));
			};
			video.src = url;
		});
		const { videoWidth: width, videoHeight: height } = video;
		const thumbnail = await thumbnailOf(video, width, height);
		const length = Number.isFinite(video.duration) ? { duration_ms: Math.round(video.duration * 1000) } : {};
		return { width, height, ...length, ...(thumbnail ? { thumbnail } : {}) };
	} catch {
		return {};
	} finally {
		video.removeAttribute("src");
		video.load();
		URL.revokeObjectURL(url);
	}
}

/** The person's files as they go in a conversation: each with what this page could tell of it, one after the other. */
export async function outgoingFiles(files: File[]): Promise<OutgoingFile[]> {
	const outgoing: OutgoingFile[] = [];
	for (const file of files) {
		const type = sniffType(new Uint8Array(await file.slice(0, SNIFF_PREFIX).arrayBuffer()));
		const facts = type.startsWith("image/")
			? await pictureFacts(file)
			: type.startsWith("video/")
				? await videoFacts(file)
				: {};
		outgoing.push({ ...facts, file, name: file.name });
	}
	return outgoing;
}

/**
 * A GIF's bytes from where the picker found it: this page's fetch, without cookies, or, in the desktop app where the
 * GIF's host takes no fetch of another origin, Bun's, as Copy image has it fetch a picture. Null when neither has them.
 */
export async function gifBytes(url: string): Promise<Uint8Array | null> {
	try {
		const res = await fetchWithin(url, { credentials: "omit" }, requestLimits.answerMs, (received) => {
			if (received > MAX_GIF) throw new RangeError("the GIF is too large");
		});
		if (res.ok) return new Uint8Array(await res.arrayBuffer());
	} catch {
		// Refused here (another origin's, or too large): Bun's, where there's one.
	}
	const rpc = await getElectrobunRpc();
	const picture = rpc ? await rpc.request.pictureForCopy({ url }).catch(() => null) : null;
	return picture ? base64Bytes(picture) : null;
}
