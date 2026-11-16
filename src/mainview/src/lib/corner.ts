import { writable } from "svelte/store";

// What sits in the app's bottom right corner: the stream window, the call card, right above that window when it covers
// the card's place, and the toasts, right above the card while it shows. Each publishes its box while it shows, and
// these place the others.

/** A box held to the app's bottom right corner: its distances from the right and bottom edges, and its size, in px. */
export interface CornerBox {
	right: number;
	bottom: number;
	width: number;
	height: number;
}

/** How far from the app's edges what sits in the corner keeps (Tailwind's right-4 and bottom-4). */
export const CORNER_MARGIN = 16;
/** The space between two things stacked in the corner. */
export const STACK_GAP = 8;
/** The call card's width (CallCard.svelte's w-80). */
export const CALL_CARD_WIDTH = 320;
/** The call card's height (CallCard.svelte's h-18). */
export const CALL_CARD_HEIGHT = 72;

/** The stream window's box while it shows (StreamWindow.svelte). */
export const streamWindowBox = writable<CornerBox | null>(null);
/** The call card's box while it shows (CallCard.svelte). */
export const callCardBox = writable<CornerBox | null>(null);

// Whether the box covers any of the call card's place at the corner: touching its edge isn't covering it.
function coversCardPlace(box: CornerBox): boolean {
	return (
		box.right < CORNER_MARGIN + CALL_CARD_WIDTH &&
		box.right + box.width > CORNER_MARGIN &&
		box.bottom < CORNER_MARGIN + CALL_CARD_HEIGHT &&
		box.bottom + box.height > CORNER_MARGIN
	);
}

/** The call card's distance from the app's bottom edge: in the corner, or right above the stream window when that window
 * covers the card's place, as far as a window viewHeight tall leaves room for it. */
export function callCardBottom(stream: CornerBox | null, viewHeight: number): number {
	if (!stream || !coversCardPlace(stream)) return CORNER_MARGIN;
	const above = stream.bottom + stream.height + STACK_GAP;
	return Math.max(CORNER_MARGIN, Math.min(above, viewHeight - CALL_CARD_HEIGHT - CORNER_MARGIN));
}

/** The toasts' distance from the app's bottom edge: in the corner, or right above the call card while it shows. */
export function toastsBottom(card: CornerBox | null): number {
	return card ? card.bottom + card.height + STACK_GAP : CORNER_MARGIN;
}
