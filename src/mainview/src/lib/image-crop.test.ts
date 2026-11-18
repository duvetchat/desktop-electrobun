import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	coverCrop,
	cropView,
	frameSize,
	maxZoom,
	panCrop,
	sliderZoom,
	wheelZoom,
	zoomCrop,
	zoomOf,
	zoomSlider,
	type Crop,
	type Size,
} from "$lib/image-crop";

const landscape: Size = { width: 1000, height: 500 };

// The crop is inside the image, at the frame's aspect.
function expectInside(crop: Crop, image: Size, aspect: number) {
	expect(crop.x).toBeGreaterThanOrEqual(0);
	expect(crop.y).toBeGreaterThanOrEqual(0);
	expect(crop.x + crop.width).toBeLessThanOrEqual(image.width + 1e-9);
	expect(crop.y + crop.height).toBeLessThanOrEqual(image.height + 1e-9);
	expect(crop.width / crop.height).toBeCloseTo(aspect, 9);
}

describe("frameSize", () => {
	test("is the largest frame of the aspect within the bounds", () => {
		expect(frameSize(1, { width: 336, height: 280 })).toEqual({ width: 280, height: 280 });
		expect(frameSize(5 / 2, { width: 336, height: 280 })).toEqual({ width: 336, height: 134.4 });
		expect(frameSize(1 / 2, { width: 336, height: 280 })).toEqual({ width: 140, height: 280 });
	});
});

describe("coverCrop", () => {
	test("takes the most of the image the aspect allows, from its middle", () => {
		expect(coverCrop(landscape, 1)).toEqual({ x: 250, y: 0, width: 500, height: 500 });
		expect(coverCrop({ width: 400, height: 1000 }, 1)).toEqual({ x: 0, y: 300, width: 400, height: 400 });
		expect(coverCrop({ width: 1000, height: 1000 }, 5 / 2)).toEqual({ x: 0, y: 300, width: 1000, height: 400 });
		expect(coverCrop({ width: 600, height: 240 }, 5 / 2)).toEqual({ x: 0, y: 0, width: 600, height: 240 });
	});
});

describe("maxZoom", () => {
	test("stops where an image pixel takes 4 pixels of the output", () => {
		expect(maxZoom({ width: 1024, height: 1024 }, 1, { width: 256, height: 256 })).toBe(16);
		expect(maxZoom(landscape, 1, { width: 128, height: 128 })).toBe(15.625);
		expect(maxZoom({ width: 100, height: 100 }, 1, { width: 256, height: 256 })).toBe(1.5625);
	});

	test("is 1 for an image too small to zoom into", () => {
		expect(maxZoom({ width: 20, height: 20 }, 1, { width: 128, height: 128 })).toBe(1);
		expect(maxZoom({ width: 0, height: 0 }, 1, { width: 128, height: 128 })).toBe(1);
	});
});

describe("zoomCrop", () => {
	test("zooming in shows less of the image in the same frame, around its middle", () => {
		const crop = zoomCrop(coverCrop(landscape, 1), landscape, 1, 2);
		expect(crop).toEqual({ x: 375, y: 125, width: 250, height: 250 });
		expect(zoomOf(crop, landscape, 1)).toBe(2);
	});

	test("keeps the image point under the focus where it is", () => {
		const cover = coverCrop(landscape, 1);
		expect(zoomCrop(cover, landscape, 1, 2, { x: 0, y: 0 })).toEqual({ x: 250, y: 0, width: 250, height: 250 });
		expect(zoomCrop(cover, landscape, 1, 2, { x: 1, y: 1 })).toEqual({ x: 500, y: 250, width: 250, height: 250 });
	});

	test("zooming out never shows anything outside the image", () => {
		const nearEdge: Crop = { x: 700, y: 200, width: 250, height: 250 };
		expect(zoomCrop(nearEdge, landscape, 1, 1)).toEqual({ x: 500, y: 0, width: 500, height: 500 });
	});

	test("goes no further out than the whole frame's worth of image", () => {
		expect(zoomCrop(coverCrop(landscape, 1), landscape, 1, 0.5)).toEqual(coverCrop(landscape, 1));
	});
});

describe("panCrop", () => {
	test("moves the crop, stopping at the image's edges", () => {
		const crop: Crop = { x: 375, y: 125, width: 250, height: 250 };
		expect(panCrop(crop, landscape, 100, -25)).toEqual({ x: 475, y: 100, width: 250, height: 250 });
		expect(panCrop(crop, landscape, 1000, -1000)).toEqual({ x: 750, y: 0, width: 250, height: 250 });
		expect(panCrop(crop, landscape, -1000, 1000)).toEqual({ x: 0, y: 250, width: 250, height: 250 });
	});
});

describe("cropView", () => {
	test("puts the crop's edges on the frame's", () => {
		const crop: Crop = { x: 375, y: 125, width: 250, height: 250 };
		const frame: Size = { width: 280, height: 280 };
		const view = cropView(crop, frame);
		expect(view.scale).toBeCloseTo(1.12, 12);
		expect(view.x + crop.x * view.scale).toBeCloseTo(0, 9);
		expect(view.y + crop.y * view.scale).toBeCloseTo(0, 9);
		expect(view.x + (crop.x + crop.width) * view.scale).toBeCloseTo(frame.width, 9);
		expect(view.y + (crop.y + crop.height) * view.scale).toBeCloseTo(frame.height, 9);
	});

	test("does so for a banner's frame too", () => {
		const image: Size = { width: 1920, height: 1080 };
		const frame = frameSize(5 / 2, { width: 336, height: 280 });
		const crop = panCrop(zoomCrop(coverCrop(image, 5 / 2), image, 5 / 2, 3, { x: 0.2, y: 0.7 }), image, 33.3, -12.5);
		const view = cropView(crop, frame);
		expect(view.x + (crop.x + crop.width) * view.scale).toBeCloseTo(frame.width, 9);
		expect(view.y + (crop.y + crop.height) * view.scale).toBeCloseTo(frame.height, 9);
	});
});

describe("zooms and pans", () => {
	test("any run of them keeps the crop inside the image, at the frame's aspect", () => {
		let seed = 7;
		const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
		for (const [image, aspect] of [
			[landscape, 1],
			[{ width: 300, height: 900 }, 1],
			[{ width: 1920, height: 1080 }, 5 / 2],
			[{ width: 333, height: 777 }, 5 / 2],
		] as const) {
			const limit = maxZoom(image, aspect, { width: 256, height: 256 / aspect });
			let crop = coverCrop(image, aspect);
			for (let i = 0; i < 500; i++) {
				if (random() < 0.5) {
					crop = zoomCrop(crop, image, aspect, 1 + random() * (limit - 1), { x: random() * 1.4 - 0.2, y: random() });
				} else {
					crop = panCrop(crop, image, (random() - 0.5) * 2000, (random() - 0.5) * 2000);
				}
				expectInside(crop, image, aspect);
			}
		}
	});
});

describe("wheelZoom", () => {
	test("zooms in on a wheel up and out on a wheel down, within 1 and the limit", () => {
		expect(wheelZoom(2, -100, 8)).toBeGreaterThan(2);
		expect(wheelZoom(2, 100, 8)).toBeLessThan(2);
		expect(wheelZoom(1, 100, 8)).toBe(1);
		expect(wheelZoom(8, -100, 8)).toBe(8);
	});

	test("a wheel down undoes a wheel up", () => {
		expect(wheelZoom(wheelZoom(2, -100, 8), 100, 8)).toBeCloseTo(2, 12);
	});
});

describe("the zoom slider", () => {
	test("goes from no zoom to the limit", () => {
		expect(zoomSlider(1, 16)).toBe(0);
		expect(zoomSlider(16, 16)).toBe(1);
		expect(sliderZoom(0, 16)).toBe(1);
		expect(sliderZoom(1, 16)).toBe(16);
	});

	test("gives each step the same share of the zoom, so the low end isn't crowded", () => {
		expect(sliderZoom(0.5, 16)).toBe(4);
		expect(zoomSlider(4, 16)).toBe(0.5);
		expect(zoomSlider(sliderZoom(0.3, 16), 16)).toBeCloseTo(0.3, 12);
	});

	test("stays at the start when the image can't be zoomed", () => {
		expect(zoomSlider(1, 1)).toBe(0);
		expect(sliderZoom(0.7, 1)).toBe(1);
	});
});

// #325: the crop read the chosen file as a data URL, a third larger than the file, and kept it once dismissed: only
// Apply and Change image let go of it.
test("the image crop lets go of its image as it closes", () => {
	const crop = readFileSync(join(import.meta.dir, "components/ImageCropModal.svelte"), "utf8");
	expect(crop).toMatch(/<Sheet\s+bind:open\s+onOpenChange=\{\(o\) => \{\s*if \(!o\) \{\s*file = null;\s*imgSrc = "";/);
});
