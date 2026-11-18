import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startupSummary, writeStartupLine } from "./startup";

// The app's log gets one line of each start: Bun's steps and the page's, from Bun's start (#280).
test("one line, each step from Bun's start, in the order they came, in whole milliseconds", () => {
	expect(startupSummary(1000, { window: 1120.4, code: 1040, page: 1300, ready: 2000.6 })).toBe(
		"[startup] code 40 ms, window 120 ms, page 300 ms, ready 1001 ms (since Bun started)",
	);
});

// A first start has no app data folder yet: the log makes its own.
test("the file's folder is made when the app's data has none yet", async () => {
	const dir = mkdtempSync(join(tmpdir(), "duvet-startup-"));
	try {
		const file = join(dir, "not", "yet", "startup.log");
		await writeStartupLine(file, "first");
		expect(readFileSync(file, "utf8")).toBe("first\n");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// Bun's output goes nowhere in the packaged app, so each start's line goes into a file of the app's data (#288).
test("each start's line goes into the file after the ones before, which keeps the last 50", async () => {
	const dir = mkdtempSync(join(tmpdir(), "duvet-startup-"));
	try {
		const file = join(dir, "startup.log");
		await writeStartupLine(file, "first");
		await writeStartupLine(file, "second");
		expect(readFileSync(file, "utf8")).toBe("first\nsecond\n");

		writeFileSync(file, Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n") + "\n");
		await writeStartupLine(file, "newest");
		const lines = readFileSync(file, "utf8").trimEnd().split("\n");
		expect(lines.length).toBe(50);
		expect(lines[0]).toBe("line 11");
		expect(lines.at(-1)).toBe("newest");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
