/**
 * Scrolls a row that only scrolls sideways (a pane's tabs, the emoji picker's categories) with a mouse's wheel, which
 * only turns up and down. A sideways gesture (a trackpad's) is left to the browser, which scrolls the row itself.
 */
export function scrollSideways(e: { deltaX: number; deltaY: number }, row: { scrollLeft: number }) {
	if (e.deltaY && !e.deltaX) row.scrollLeft += e.deltaY;
}
