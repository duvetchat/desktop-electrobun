import { expect, test } from "bun:test";
import { startupSummary } from "./startup";

// The app's log gets one line of each start: Bun's steps and the page's, from Bun's start (#280).
test("one line, each step from Bun's start, in the order they came, in whole milliseconds", () => {
	expect(startupSummary(1000, { window: 1120.4, code: 1040, page: 1300, ready: 2000.6 })).toBe(
		"[startup] code 40 ms, window 120 ms, page 300 ms, ready 1001 ms (since Bun started)",
	);
});
