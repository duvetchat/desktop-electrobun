import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The call panel's first row (#357): where the user is, the ping on hover, Disconnect. What it draws for a state is
// MediaPanel.test.ts's; this keeps its work out of it.
const row = readFileSync(join(import.meta.dir, "VoiceStatus.svelte"), "utf8");
const source = readFileSync(join(import.meta.dir, "../media-source.ts"), "utf8");

// #315: the ping's interval was the bar's state, started by an effect with no cleanup, so a bar destroyed during a call
// (every READY remounts the app's UI, voice staying) left its interval fetching /health every 3 s for the session, one
// more per bar at each READY. The row has no timer and no request of its own now: it draws the ping it is given, which
// lib/media-source.ts measures only while someone reads it (media-source.test.ts: "stops with its last reader").
test("the row measures nothing itself: no timer and no request can outlive it", () => {
	expect(row).not.toMatch(/setInterval|setTimeout|fetch\(/);
	expect(row).not.toContain("pingIntervalId");
	expect(source).toMatch(/timer = setInterval\(\(\) => once\(mine\), everyMs\);/);
	expect(source).toMatch(/return \(\) => \{\s*unsubscribe\(\);\s*stop\(\);\s*\};/);
});

test("the ping is still measured every 3 seconds", () => {
	expect(source).toContain("export const PING_EVERY_MS = 3000;");
});
