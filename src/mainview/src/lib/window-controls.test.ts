import { expect, test } from "bun:test";
import { pressDrags } from "./window-controls";

// A press's target as the title bar reads it: inside its actions (the window's buttons) or not.
const target = (inActions: boolean) => ({
	closest: (selector: string) => (inActions && selector === ".titlebar-actions" ? {} : null),
});

// #348: where Bun says Windows drags the window (src/bun/window-snap.ts), a press on the title bar is reported for
// Windows' move loop, so a maximized window restores as it's dragged and the display's edges snap it.
test("a press of the primary button on the title bar drags, not one on its buttons or of another button", () => {
	expect(pressDrags(0, target(false))).toBe(true);
	expect(pressDrags(0, target(true))).toBe(false);
	expect(pressDrags(2, target(false))).toBe(false);
	expect(pressDrags(0, null)).toBe(false);
});
