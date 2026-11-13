/**
 * The app's start in one line, for Bun's output (the app's log): each step, Bun's own and the page's, as when it
 * happened (Date.now()), from Bun's start, in the order they came (#280).
 */
export function startupSummary(processStart: number, marks: Record<string, number>): string {
	const steps = Object.entries(marks)
		.sort(([, a], [, b]) => a - b)
		.map(([step, at]) => `${step} ${Math.round(at - processStart)} ms`);
	return `[startup] ${steps.join(", ")} (since Bun started)`;
}
