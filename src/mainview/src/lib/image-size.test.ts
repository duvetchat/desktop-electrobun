import { describe, expect, test } from "bun:test";
import { decodable, imageSize, MAX_DECODED_SIDE } from "./image-size";

// The headers of images of a given size, as their encoders write them; their pixels don't matter here.
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const png = (width: number, height: number) =>
	new Uint8Array([
		0x89,
		...ascii("PNG\r\n\x1a\n"),
		...be32(13),
		...ascii("IHDR"),
		...be32(width),
		...be32(height),
		8,
		6,
		0,
		0,
		0,
	]);

// A GIF of a logical screen, with frames where they say, each one data sub-block long.
const gif = (width: number, height: number, frames: [number, number, number, number][] = []) =>
	new Uint8Array([
		...ascii("GIF89a"),
		...le16(width),
		...le16(height),
		0,
		0,
		0,
		...ascii("!"),
		0xf9,
		4,
		0,
		0,
		0,
		0,
		0,
		...frames.flatMap(([left, top, w, h]) => [
			0x2c,
			...le16(left),
			...le16(top),
			...le16(w),
			...le16(h),
			0,
			2,
			1,
			0,
			0,
		]),
		0x3b,
	]);

const jpeg = (width: number, height: number) =>
	new Uint8Array([
		0xff,
		0xd8,
		...[0xff, 0xe0, 0, 16, ...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0],
		...[0xff, 0xdb, 0, 3, 0],
		...[
			0xff,
			0xc0,
			0,
			17,
			8,
			...le16(height).reverse(),
			...le16(width).reverse(),
			3,
			1,
			0x22,
			0,
			2,
			0x11,
			1,
			3,
			0x11,
			1,
		],
	]);

const riff = (chunk: string, payload: number[]) =>
	new Uint8Array([
		...ascii("RIFF"),
		...le24(payload.length + 12),
		0,
		...ascii("WEBP"),
		...ascii(chunk),
		...le24(payload.length),
		0,
		...payload,
	]);
const vp8 = (width: number, height: number) =>
	riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height), 0, 0]);
const vp8l = (width: number, height: number) => {
	const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
	return riff("VP8L", [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255, 0, 0, 0, 0, 0]);
};
const vp8x = (width: number, height: number) => riff("VP8X", [0x10, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);

describe("imageSize", () => {
	test("reads a PNG's, a JPEG's, a GIF's and a WebP's size from their headers", () => {
		expect(imageSize(png(200, 215))).toEqual({ width: 200, height: 215 });
		expect(imageSize(jpeg(480, 360))).toEqual({ width: 480, height: 360 });
		expect(imageSize(gif(10, 20))).toEqual({ width: 10, height: 20 });
		expect(imageSize(vp8(640, 640))).toEqual({ width: 640, height: 640 });
		expect(imageSize(vp8l(300, 200))).toEqual({ width: 300, height: 200 });
		expect(imageSize(vp8x(1280, 720))).toEqual({ width: 1280, height: 720 });
	});

	test("widens a GIF to its frames, as browsers draw one that lies outside its screen", () => {
		expect(imageSize(gif(1, 1, [[0, 0, 1, 1]]))).toEqual({ width: 1, height: 1 });
		expect(imageSize(gif(1, 1, [[100, 0, 16000, 16000]]))).toEqual({ width: 16100, height: 16000 });
	});

	test("has no size for anything else, or for headers cut short", () => {
		for (const bytes of [
			new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
			new TextEncoder().encode("<html>not an image</html>"),
			new Uint8Array([0x42, 0x4d, 0, 0]), // a BMP
			png(10, 10).subarray(0, 20),
			gif(10, 10, [[0, 0, 10, 10]]).subarray(0, 30), // no trailer
			jpeg(10, 10).subarray(0, 20), // no frame header
			new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), // over before a frame header
			riff("ALPH", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
		]) {
			expect(imageSize(bytes)).toBeNull();
		}
	});
});

describe("decodable", () => {
	test(`takes an image of up to ${MAX_DECODED_SIDE} px a side, and none it can't read`, () => {
		expect(decodable(png(MAX_DECODED_SIDE, MAX_DECODED_SIDE))).toBe(true);
		expect(decodable(jpeg(1280, 720))).toBe(true);
		expect(decodable(png(16000, 16000))).toBe(false); // 31 KB of 1-bit PNG took Chromium a GB to decode
		expect(decodable(png(MAX_DECODED_SIDE + 1, 1))).toBe(false);
		expect(decodable(jpeg(1, MAX_DECODED_SIDE + 1))).toBe(false);
		expect(decodable(gif(1, 1, [[0, 0, 5000, 1]]))).toBe(false);
		expect(decodable(vp8x(16384, 16384))).toBe(false);
		expect(decodable(png(0, 10))).toBe(false);
		expect(decodable(new TextEncoder().encode("<svg/>"))).toBe(false);
	});
});
