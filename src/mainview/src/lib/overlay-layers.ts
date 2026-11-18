// Which overlay is in front (#357). Sheets, dialogs, popovers, menus and their submenus all float in the page's top
// layer, and any of them can open any other: a profile's Ban opens a sheet from a popover, a bot's form opens a select
// from a sheet. So no kind has a fixed place above another: what opened last is in front. Each overlay claims a layer
// as it opens, one above every layer still open, and gives it back as it closes. What opened it stays where it was,
// behind, and is there again once the newer one has gone.
//
// The layers start where the design's sheets do (900) and stay far under the notices and toasts (9990 and up), which
// show over everything, a dialog too.

/** The lowest overlay's z-index. */
export const BASE_LAYER = 900;

const claimed: number[] = [];

/** The z-index for an overlay that is opening: one above every overlay still open. */
export function claimLayer(): number {
	const layer = Math.max(BASE_LAYER - 1, ...claimed) + 1;
	claimed.push(layer);
	return layer;
}

/** Gives a layer back as its overlay closes. */
export function releaseLayer(layer: number): void {
	const at = claimed.lastIndexOf(layer);
	if (at >= 0) claimed.splice(at, 1);
}

/** An overlay's layer as an inline style; nothing for an overlay that has none (closed, or drawn on the server). */
export function layerStyle(layer: number): string | undefined {
	return layer ? `z-index: ${layer};` : undefined;
}
