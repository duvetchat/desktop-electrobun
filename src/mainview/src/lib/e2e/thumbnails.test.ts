import { expect, test } from "bun:test";
import { opaque, THUMBNAIL_SIDE, thumbnailSize } from "./thumbnails";

// A picture's or a video's thumbnail, as the page makes it to go with its file (PLAN-E2E-CLIENTES.md, its conventions
// between clients): 320 px on its longer side at most, a JPEG, or a PNG when it has transparency. The canvas that
// draws it is the browser's; what it's drawn to is this.

test("a thumbnail is 320 px on its longer side at most, in its picture's proportions; a smaller one keeps its size", () => {
	expect(THUMBNAIL_SIDE).toBe(320);
	expect(thumbnailSize(1280, 720)).toEqual({ width: 320, height: 180 });
	expect(thumbnailSize(720, 1280)).toEqual({ width: 180, height: 320 });
	expect(thumbnailSize(100, 50)).toEqual({ width: 100, height: 50 });
	expect(thumbnailSize(10_000, 1)).toEqual({ width: 320, height: 1 });
	expect(thumbnailSize(0, 0)).toBeNull();
});

test("a thumbnail is a JPEG, or a PNG when its picture has transparency", () => {
	const pixels = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
	expect(opaque(pixels)).toBe(true);
	pixels[7] = 254;
	expect(opaque(pixels)).toBe(false);
});
