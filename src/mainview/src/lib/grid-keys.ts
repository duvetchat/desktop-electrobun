/** The arrows in a grid of buttons (the emoji, sticker and GIF pickers): where the focus goes. */

/** The cell to focus from the cell at `at`, among `count` cells laid `columns` to a row; null for another key, and for
 * an arrow that would leave the grid (the key is then the browser's: Tab still leaves as it does). */
export function gridStep(count: number, at: number, columns: number, key: string): number | null {
	if (count === 0 || at < 0 || columns < 1) return null;
	const to =
		key === "ArrowRight"
			? at + 1
			: key === "ArrowLeft"
				? at - 1
				: key === "ArrowDown"
					? at + columns
					: key === "ArrowUp"
						? at - columns
						: key === "Home"
							? 0
							: key === "End"
								? count - 1
								: null;
	if (to === null || to === at) return null;
	// Down from the row before the last goes to the last cell when that row is short.
	if (key === "ArrowDown" && to >= count)
		return Math.floor(at / columns) < Math.floor((count - 1) / columns) ? count - 1 : null;
	return to < 0 || to >= count ? null : to;
}

/** A grid's key handler: put it on what holds the cells. The cells are its buttons; how many make a row is read from
 * where they are laid. */
export function gridKeys(e: KeyboardEvent): void {
	const holder = e.currentTarget;
	const from = e.target;
	if (!(holder instanceof HTMLElement) || !(from instanceof HTMLElement) || from.tagName !== "BUTTON") return;
	const cells = [...holder.querySelectorAll<HTMLElement>("button:not([disabled])")];
	const top = cells[0]?.offsetTop;
	const columns = cells.findIndex((cell) => cell.offsetTop !== top);
	const to = gridStep(cells.length, cells.indexOf(from), columns < 0 ? cells.length : columns, e.key);
	if (to === null) return;
	e.preventDefault();
	cells[to]?.focus();
}
