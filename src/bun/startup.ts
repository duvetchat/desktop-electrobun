import { readFile, writeFile } from "node:fs/promises";

// How many starts startup.log keeps, the newest last.
const KEPT_STARTS = 50;

/**
 * The app's start in one line, for startup.log: each step, Bun's own and the page's, as when it happened (Date.now()),
 * from Bun's start, in the order they came (#280).
 */
export function startupSummary(processStart: number, marks: Record<string, number>): string {
	const steps = Object.entries(marks)
		.sort(([, a], [, b]) => a - b)
		.map(([step, at]) => `${step} ${Math.round(at - processStart)} ms`);
	return `[startup] ${steps.join(", ")} (since Bun started)`;
}

/**
 * Adds a start's line to the file at `path` (startup.log, in the app's data), keeping the last 50 starts: the packaged
 * app keeps no output of Bun's, where the line went before (#288).
 */
export async function writeStartupLine(path: string, line: string): Promise<void> {
	const before = await readFile(path, "utf8").catch(() => "");
	const lines = [...before.split("\n").filter(Boolean), line].slice(-KEPT_STARTS);
	await writeFile(path, lines.join("\n") + "\n");
}
