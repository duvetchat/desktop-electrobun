// An IPC app's activity image, made small enough to go inline (desktop#148). Since gateway#134 the gateway keeps an
// activity's images only as data URIs of 8 KiB at most, which every member's client draws without loading anything.
// The Bun process fetches an image an app names by URL (src/bun/activity-images.ts), but it has no image decoder: it
// hands the bytes here, where a canvas has one. A canvas drawn from a Blob's bitmap isn't tainted, so it can be read.

/** The most an inline image may take, as the gateway counts it: the whole data URI, in bytes (it's ASCII). */
export const MAX_INLINE_IMAGE = 8 << 10;

/** A way to make the image: its side in pixels, its type, and a JPEG's quality. */
export interface ThumbnailStep {
	side: number;
	type: "image/jpeg" | "image/png";
	quality?: number;
}

/**
 * The steps for an opaque image: a JPEG of 80 px, twice the 40 px the card draws an activity's image at, which
 * takes about 3.5 KB for a song's cover; smaller ones in case it takes more.
 */
export const OPAQUE_STEPS: ThumbnailStep[] = [
	{ side: 80, type: "image/jpeg", quality: 0.85 },
	{ side: 64, type: "image/jpeg", quality: 0.8 },
	{ side: 48, type: "image/jpeg", quality: 0.75 },
];

/** The steps for one with transparency: a PNG, which takes more, of 48 px at most (about 7 KB for an app's icon). */
export const TRANSPARENT_STEPS: ThumbnailStep[] = [
	{ side: 48, type: "image/png" },
	{ side: 40, type: "image/png" },
	{ side: 32, type: "image/png" },
	{ side: 24, type: "image/png" },
];

/**
 * The image encode makes at the first of steps whose image fits inline: a data URI of the step's type, in base64, of
 * MAX_INLINE_IMAGE bytes at most. A browser that can't encode a type makes a PNG instead, which doesn't count for a
 * JPEG's step. Null when none fits.
 */
export function fittingImage(steps: ThumbnailStep[], encode: (step: ThumbnailStep) => string): string | null {
	for (const step of steps) {
		const image = encode(step);
		if (image.length <= MAX_INLINE_IMAGE && image.startsWith(`data:${step.type};base64,`)) return image;
	}
	return null;
}

/** Whether every pixel of an image's RGBA bytes is opaque. */
export function isOpaque(pixels: Uint8ClampedArray): boolean {
	for (let i = 3; i < pixels.length; i += 4) {
		if (pixels[i] !== 255) return false;
	}
	return true;
}

/**
 * bytes as a square image cropped to its centre, small enough to go inline (fittingImage): a JPEG when it's opaque,
 * a PNG when it has transparency, never larger than the image itself. Null when the webview can't decode it (it
 * isn't an image), or nothing fits.
 */
export async function activityThumbnail(bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(new Blob([bytes]));
	} catch {
		return null;
	}
	try {
		const crop = Math.min(bitmap.width, bitmap.height);
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		if (!context || crop === 0) return null;
		const draw = (side: number) => {
			const size = Math.min(side, crop);
			// Sizing the canvas clears it and its settings.
			canvas.width = size;
			canvas.height = size;
			context.imageSmoothingQuality = "high";
			context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, size, size);
			return size;
		};
		const size = draw(OPAQUE_STEPS[0]!.side);
		const steps = isOpaque(context.getImageData(0, 0, size, size).data) ? OPAQUE_STEPS : TRANSPARENT_STEPS;
		return fittingImage(steps, (step) => {
			draw(step.side);
			return canvas.toDataURL(step.type, step.quality);
		});
	} finally {
		bitmap.close();
	}
}

/** The bytes a base64 text holds, as the Bun process sends an image's. */
export function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
	const text = atob(base64);
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
	return bytes;
}
