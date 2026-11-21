import { describe, expect, test } from "bun:test";
import { isPng, pictureToCopy } from "./copy-image";

// A PNG's signature, and the headers of a 2×2 one and of a JPEG of 2×2 and one of 5000×10 (image-size.ts reads them).
const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2,
]);
const jpeg = (width: number, height: number) =>
	new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3]);

// A fetch that answers with bytes, recording what it was asked for.
function fetcher(bytes: Uint8Array | null) {
	const asked: string[] = [];
	return {
		asked,
		fetch: async (url: string) => {
			asked.push(url);
			return bytes;
		},
	};
}

describe("Copy image's picture", () => {
	test("a PNG goes to the page as it is", async () => {
		const { asked, fetch } = fetcher(PNG);
		expect(await pictureToCopy("https://api.example/a.png", fetch)).toEqual(PNG);
		expect(asked).toEqual(["https://api.example/a.png"]);
	});

	test("another picture small enough to decode goes too, for the page to make a PNG of", async () => {
		const picture = jpeg(2, 2);
		expect(await pictureToCopy("https://api.example/a.jpg", fetcher(picture).fetch)).toEqual(picture);
	});

	test("nothing goes back for what can't be fetched, isn't a picture, or is too big to decode", async () => {
		for (const bytes of [null, new TextEncoder().encode("<html>"), jpeg(5000, 10)]) {
			expect(await pictureToCopy("https://api.example/x", fetcher(bytes).fetch)).toBeNull();
		}
	});

	test("a PNG is told by its signature", () => {
		expect(isPng(PNG)).toBe(true);
		expect(isPng(jpeg(2, 2))).toBe(false);
		expect(isPng(new Uint8Array())).toBe(false);
	});
});
