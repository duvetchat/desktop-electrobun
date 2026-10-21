// The image editor's geometry (ImageCropModal): its frame stays put, and the image under it is what the wheel
// and the slider zoom and a drag moves. The editor keeps the crop, the part of the image the frame shows, in the
// image's own pixels: the result is that part, and the frame shows the image from it (cropView).

/** A width and a height, in pixels. */
export interface Size {
	width: number;
	height: number;
}

/** The part of an image the frame shows, in the image's own pixels. */
export interface Crop {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A point of the frame, as fractions of its width and height: { x: 0.5, y: 0.5 } is its middle. */
export interface FramePoint {
	x: number;
	y: number;
}

// Zooming in stops where a pixel of the image takes 4 of the result's.
const MAX_UPSCALE = 4;

// A wheel's deltaY zooms by e^(-deltaY / 500): a mouse wheel's notch (100) by about 22%.
const WHEEL_SPEED = 1 / 500;

/** The largest frame of the aspect (width / height) within bounds. */
export function frameSize(aspect: number, bounds: Size): Size {
	if (aspect >= bounds.width / bounds.height) return { width: bounds.width, height: bounds.width / aspect };
	return { width: bounds.height * aspect, height: bounds.height };
}

/** The crop at zoom 1: the most of the image the aspect allows, from its middle. */
export function coverCrop(image: Size, aspect: number): Crop {
	const width = Math.min(image.width, image.height * aspect);
	const height = width / aspect;
	return { x: (image.width - width) / 2, y: (image.height - height) / 2, width, height };
}

/** How far in the editor can zoom for a result of that size, 1 when the image is too small for any zoom. */
export function maxZoom(image: Size, aspect: number, output: Size): number {
	const cover = coverCrop(image, aspect);
	return Math.max(
		1,
		Math.min((cover.width * MAX_UPSCALE) / output.width, (cover.height * MAX_UPSCALE) / output.height),
	);
}

/** A crop's zoom: 1 for the cover crop, 2 for one half its width. */
export function zoomOf(crop: Crop, image: Size, aspect: number): number {
	return crop.width > 0 ? coverCrop(image, aspect).width / crop.width : 1;
}

// The crop moved back within the image where it went past an edge.
function within(crop: Crop, image: Size): Crop {
	return {
		...crop,
		x: Math.max(0, Math.min(crop.x, image.width - crop.width)),
		y: Math.max(0, Math.min(crop.y, image.height - crop.height)),
	};
}

/**
 * The crop at a zoom (1 at least), keeping the image's point at focus where it is in the frame (its middle by
 * default), as far as the frame can without showing anything outside the image.
 */
export function zoomCrop(
	crop: Crop,
	image: Size,
	aspect: number,
	zoom: number,
	focus: FramePoint = { x: 0.5, y: 0.5 },
): Crop {
	const cover = coverCrop(image, aspect);
	const width = cover.width / Math.max(1, zoom);
	const height = cover.height / Math.max(1, zoom);
	return within(
		{ x: crop.x + focus.x * (crop.width - width), y: crop.y + focus.y * (crop.height - height), width, height },
		image,
	);
}

/** The crop moved by dx, dy pixels of the image, as far as its edges let it. */
export function panCrop(crop: Crop, image: Size, dx: number, dy: number): Crop {
	return within({ ...crop, x: crop.x + dx, y: crop.y + dy }, image);
}

/**
 * Where the image goes under a frame of that size for the frame to show the crop: its scale (display pixels per
 * pixel of the image) and its top-left corner, from the frame's.
 */
export function cropView(crop: Crop, frame: Size): { scale: number; x: number; y: number } {
	const scale = frame.width / crop.width;
	return { scale, x: -crop.x * scale, y: -crop.y * scale };
}

/** The zoom after a wheel event's deltaY (up zooms in), between 1 and limit. */
export function wheelZoom(zoom: number, deltaY: number, limit: number): number {
	return Math.min(Math.max(zoom * Math.exp(-deltaY * WHEEL_SPEED), 1), limit);
}

/** The zoom slider's position, 0 to 1, for a zoom. Each step multiplies the zoom by as much as any other. */
export function zoomSlider(zoom: number, limit: number): number {
	return limit > 1 ? Math.log(zoom) / Math.log(limit) : 0;
}

/** The zoom at a position of the zoom slider. */
export function sliderZoom(value: number, limit: number): number {
	return limit ** value;
}
