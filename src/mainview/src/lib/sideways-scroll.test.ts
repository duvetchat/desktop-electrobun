import { expect, test } from "bun:test";
import { scrollSideways } from "$lib/sideways-scroll";

// A row of tabs that only scrolls sideways (a pane's tabs, the emoji picker's categories): a mouse's wheel, which only
// turns up and down, scrolls it too.
test("a mouse wheel's turn scrolls the row sideways", () => {
	const row = { scrollLeft: 10 };
	scrollSideways({ deltaX: 0, deltaY: 120 }, row);
	expect(row.scrollLeft).toBe(130);
	scrollSideways({ deltaX: 0, deltaY: -40 }, row);
	expect(row.scrollLeft).toBe(90);
});

test("a sideways gesture is left to the browser, which scrolls the row itself", () => {
	const row = { scrollLeft: 10 };
	scrollSideways({ deltaX: 30, deltaY: 5 }, row);
	expect(row.scrollLeft).toBe(10);
});
