import { describe, expect, test } from "bun:test";
import { copyImage, isPng, type ImageCopier } from "./copy-image";

// A PNG's signature, and the headers of a 2×2 one and of a JPEG of 2×2 and one of 5000×10 (image-size.ts reads them).
const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2,
]);
const jpeg = (width: number, height: number) =>
	new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3]);

// What the copy did: what it fetched, what it handed the webview to make a PNG of, and what it wrote.
function copier(bytes: Uint8Array | null, png: Uint8Array | null = PNG) {
	const done = { fetched: [] as string[], made: [] as Uint8Array[], written: [] as Uint8Array[] };
	const deps: ImageCopier = {
		fetchBytes: async (url) => {
			done.fetched.push(url);
			return bytes;
		},
		toPng: async (from) => {
			done.made.push(from);
			return png;
		},
		write: (data) => void done.written.push(data),
	};
	return { deps, done };
}

describe("Copy image", () => {
	test("a PNG goes to the clipboard as it is", async () => {
		const { deps, done } = copier(PNG);
		expect(await copyImage("https://api.example/a.png", deps)).toBe(true);
		expect(done).toEqual({ fetched: ["https://api.example/a.png"], made: [], written: [PNG] });
	});

	test("another picture goes as the PNG the webview makes of it", async () => {
		const picture = jpeg(2, 2);
		const { deps, done } = copier(picture);
		expect(await copyImage("https://api.example/a.jpg", deps)).toBe(true);
		expect(done.made).toEqual([picture]);
		expect(done.written).toEqual([PNG]);
	});

	test("nothing is written for what can't be fetched, isn't a picture, is too big to decode, or the webview can't make", async () => {
		for (const [bytes, png] of [
			[null, PNG],
			[new TextEncoder().encode("<html>"), PNG],
			[jpeg(5000, 10), PNG],
			[jpeg(2, 2), null],
		] as const) {
			const { deps, done } = copier(bytes, png);
			expect(await copyImage("https://api.example/x", deps)).toBe(false);
			expect(done.written).toEqual([]);
		}
	});

	test("a copy that answers too late writes nothing: the page was told it failed", async () => {
		const { deps, done } = copier(jpeg(2, 2));
		let now = 0;
		deps.toPng = async () => {
			now = 20_000;
			return PNG;
		};
		expect(await copyImage("https://api.example/a.jpg", deps, () => now)).toBe(false);
		expect(done.written).toEqual([]);
	});

	test("a PNG is told by its signature", () => {
		expect(isPng(PNG)).toBe(true);
		expect(isPng(jpeg(2, 2))).toBe(false);
		expect(isPng(new Uint8Array())).toBe(false);
	});
});
