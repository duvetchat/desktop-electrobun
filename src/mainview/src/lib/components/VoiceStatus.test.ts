import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The voice status of the user's panel: UserStatusBar's, until the redesign split it (#357).
const bar = readFileSync(join(import.meta.dir, "VoiceStatus.svelte"), "utf8");

// #315: the ping's interval was the bar's state, started by an effect with no cleanup, so a bar destroyed during a call
// (every READY remounts the app's UI, voice staying) left its interval fetching /health every 3 s for the session, one
// more per bar at each READY. The effect that starts it returns what stops it: the bar's end stops it, as leaving voice
// does.
test("the ping's interval ends with the effect that started it", () => {
	expect(bar).toMatch(/const pinging = setInterval\(measurePing, 3000\);\s*return \(\) => clearInterval\(pinging\);/);
	expect(bar).not.toContain("pingIntervalId");
});
