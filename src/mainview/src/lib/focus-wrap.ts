/** Tab inside an overlay that keeps the keyboard to itself (the image viewer): where the focus goes instead of leaving
 * it. `at` is the focused control's place among the overlay's `count` controls, -1 when the focus is on the overlay
 * itself or outside it. Null leaves the key to the browser, which moves to the next control inside. */
export function wrapTab(count: number, at: number, back: boolean): number | null {
	if (count === 0) return -1;
	if (back) return at <= 0 ? count - 1 : null;
	return at === count - 1 || at < 0 ? 0 : null;
}

/** What Tab can reach in an overlay, in order. */
export const TABBABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The arrows, Home and End in a list of `count` options, from the option at `at` (-1: none has the focus yet): the
 * option to focus, or null for a key that isn't one of them. It stops at both ends. */
export function listStep(count: number, at: number, key: string): number | null {
	if (count === 0) return null;
	switch (key) {
		case "ArrowDown":
			return Math.min(count - 1, at + 1);
		case "ArrowUp":
			return Math.max(0, at - 1);
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}
