import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markStartup, reportStartup, startupLine } from "$lib/startup-timing";

// Nothing recorded how long a start took, nor where: the app's steps are marked as they come, and reported once (#280).
const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

describe("startupLine", () => {
	test("gives each step's time from the origin, in the order they came, in whole milliseconds", () => {
		expect(startupLine({ ready: 1950.4, socket: 1800, app: 1250.6 }, 1000)).toBe(
			"app 251 ms, socket 800 ms, ready 950 ms",
		);
	});
});

describe("the page's marks", () => {
	test("keep the first time of each step, and are reported once, with the page's start, to the console and to Bun", () => {
		markStartup("socket", 5000);
		markStartup("socket", 9000);
		const info = spyOn(console, "info").mockImplementation(() => {});
		const sent: Record<string, number>[] = [];
		reportStartup((marks) => sent.push(marks));
		reportStartup((marks) => sent.push(marks));
		expect(info).toHaveBeenCalledTimes(1);
		expect(sent).toEqual([{ page: performance.timeOrigin, socket: 5000 }]);
		info.mockRestore();
	});
});

describe("where the steps are marked", () => {
	test("the connection marks its socket's opening and READY", () => {
		const connection = source("api/ws/connection.ts");
		// When the head script's socket opened, if it did before the connection listened (#291).
		expect(connection).toMatch(/const opened = \(\) => \{[^}]*markStartup\("socket", /);
		expect(connection).toContain("socket.onopen = opened;");
		expect(connection).toMatch(/case "READY": \{\s*markStartup\("ready"\);/);
	});

	test("the app page marks its own steps and reports once the first screen and the spaces are in", () => {
		const page = source("../routes/app/+page.svelte");
		for (const step of ["app", "session", "shown", "spaces"]) expect(page).toContain(`markStartup("${step}")`);
		expect(page).toContain("reportStartup(");
	});

	test("Bun marks its code's start and the window's, and logs the line the page sends", () => {
		const bun = source("../../../bun/index.ts");
		expect(bun).toContain("bunMarks.code = Date.now();");
		expect(bun).toContain("bunMarks.window = Date.now();");
		expect(bun).toContain("startupTimings: ({ marks }) =>");
		// In a file of the app's data: the packaged app keeps no output of Bun's (#288).
		expect(bun).toContain('writeStartupLine(join(Utils.paths.userData, "startup.log")');
	});
});
