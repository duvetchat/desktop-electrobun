// Copy image, from Duvet's own right-click menu (#423). Bun fetches the picture, as the page can't read another
// origin's bytes (src/bun/copy-image.ts), and the webview puts it on the clipboard itself, as a browser's Copy image
// does: Chromium and WebKit write the platform's image formats, on Windows the bitmap ones beside PNG, which every app
// pastes. Electrobun's own write left Windows' "PNG" format alone, which nothing pasted, Duvet included (#450).

/** What a copy needs; Item is the webview's ClipboardItem. */
export interface PictureCopier<Item> {
	/** The picture's bytes, from Bun: a PNG, or another picture small enough to decode; null when it can't be had. */
	fetch(url: string): Promise<Uint8Array | null>;
	/** A PNG of a picture that isn't one, made by the webview's canvas; null when it can't decode it. */
	toPng(bytes: Uint8Array): Promise<Blob | null>;
	/** A clipboard item (new ClipboardItem). */
	item(parts: Record<string, Promise<Blob>>): Item;
	/** The clipboard's write (navigator.clipboard.write). */
	write(items: Item[]): Promise<void>;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Whether bytes start as a PNG does. */
export function isPng(bytes: Uint8Array): boolean {
	return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

/**
 * Copies the picture at url to the clipboard: true once it's there. The item is written at once, with a promise of the
 * PNG: WebKit takes a clipboard write only in the user's gesture, which is over once Bun has answered. The promise
 * fails, and the write with it, for a picture Bun couldn't get or the webview can't make a PNG of.
 */
export async function copyPicture<Item>(url: string, deps: PictureCopier<Item>): Promise<boolean> {
	const png = (async () => {
		const bytes = await deps.fetch(url);
		if (!bytes) throw new Error("no picture to copy");
		const blob = isPng(bytes) ? new Blob([new Uint8Array(bytes)], { type: "image/png" }) : await deps.toPng(bytes);
		if (!blob) throw new Error("the picture can't be made a PNG");
		return blob;
	})();
	// The write reads the promise; a write that fails before it does mustn't leave its rejection unhandled.
	png.catch(() => {});
	try {
		await deps.write([deps.item({ "image/png": png })]);
		return true;
	} catch (err) {
		console.error("[copy-image] couldn't copy the picture:", err);
		return false;
	}
}
