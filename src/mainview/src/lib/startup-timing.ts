// The steps of the app's start the page sees, each as it first happened (Date.now()): the app page mounted, its session
// ready, its socket open, READY, the first screen and the spaces. They're reported once those last two are in: to the
// console, and to Bun, whose output (the app's log) has them with its own steps (#280).
const marks: Record<string, number> = {};
let reported = false;

/** Notes a step of the start, the first time it happens. */
export function markStartup(step: string, at = Date.now()) {
	marks[step] ??= at;
}

/** Each step's time from `origin`, in the order they came, in whole milliseconds. */
export function startupLine(steps: Record<string, number>, origin: number): string {
	return Object.entries(steps)
		.sort(([, a], [, b]) => a - b)
		.map(([step, at]) => `${step} ${Math.round(at - origin)} ms`)
		.join(", ");
}

/** Reports the start once, with the page's own start: to the console, and through `send` (to Bun, in the app). */
export function reportStartup(send?: (marks: Record<string, number>) => void) {
	if (reported) return;
	reported = true;
	const steps = { page: performance.timeOrigin, ...marks };
	console.info(`[startup] ${startupLine(steps, performance.timeOrigin)} (since the page started)`);
	send?.(steps);
}
