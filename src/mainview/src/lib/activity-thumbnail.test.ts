import { describe, expect, test } from "bun:test";
import {
	base64Bytes,
	fittingImage,
	isOpaque,
	MAX_INLINE_IMAGE,
	OPAQUE_STEPS,
	TRANSPARENT_STEPS,
	type ThumbnailStep,
} from "./activity-thumbnail";

// An encoder that makes a data URI of the step's type, of as many bytes as sizeOf says for its side.
function encoder(sizeOf: (side: number) => number, type?: string) {
	const tried: number[] = [];
	const encode = (step: ThumbnailStep) => {
		tried.push(step.side);
		const prefix = `data:${type ?? step.type};base64,`;
		return prefix + "A".repeat(sizeOf(step.side) - prefix.length);
	};
	return { encode, tried };
}

describe("fittingImage", () => {
	test("takes the first step whose image fits in the gateway's 8 KiB", () => {
		const { encode, tried } = encoder(() => 3_500);
		expect(fittingImage(OPAQUE_STEPS, encode)?.length).toBe(3_500);
		expect(tried).toEqual([80]);
	});

	test("goes smaller while the image takes more, and an image of exactly 8 KiB fits", () => {
		const { encode, tried } = encoder((side) => (side > 40 ? MAX_INLINE_IMAGE + 1 : MAX_INLINE_IMAGE));
		expect(fittingImage(TRANSPARENT_STEPS, encode)?.length).toBe(MAX_INLINE_IMAGE);
		expect(tried).toEqual([48, 40]);
	});

	test("gives nothing when no step fits", () => {
		const { encode, tried } = encoder(() => MAX_INLINE_IMAGE + 1);
		expect(fittingImage(OPAQUE_STEPS, encode)).toBeNull();
		expect(tried).toEqual([80, 64, 48]);
	});

	test("takes no image of another type than the step's: a browser makes a PNG of a type it can't encode", () => {
		const { encode } = encoder(() => 3_000, "image/png");
		expect(fittingImage(OPAQUE_STEPS, encode)).toBeNull();
	});

	test("makes an opaque image a JPEG of 80 px at most, and one with transparency a PNG of 48 px at most", () => {
		expect(OPAQUE_STEPS.every((s) => s.type === "image/jpeg" && s.side <= 80)).toBe(true);
		expect(TRANSPARENT_STEPS.every((s) => s.type === "image/png" && s.side <= 48)).toBe(true);
	});
});

describe("isOpaque", () => {
	test("is opaque only when every pixel's alpha is 255", () => {
		expect(isOpaque(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(true);
		expect(isOpaque(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 254]))).toBe(false);
		expect(isOpaque(new Uint8ClampedArray([0, 0, 0, 0]))).toBe(false);
	});
});

describe("base64Bytes", () => {
	test("reads the bytes the Bun process sends", () => {
		const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
		expect(base64Bytes(Buffer.from(bytes).toString("base64"))).toEqual(bytes);
	});
});
