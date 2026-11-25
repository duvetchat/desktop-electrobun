// What the browser cases (<suite>.cases.ts) and their runner (scripts/web-e2e.ts) share: the browser and its tabs as a
// case drives them. Types only, so the runner, which Bun runs outside the page's build, imports nothing of the page.

export type BrowserName = "chrome" | "firefox";

/** A tab of the browser a case runs in, on the harness page (page.ts), loaded and ready. */
export interface Tab {
	/**
	 * Runs `fn` in the page with `args`, and resolves with what it returns. Both cross as JSON, and `fn` crosses as its
	 * source: it sees the page's globals (duvetE2E among them), never the case's variables.
	 */
	run<A extends unknown[], T>(fn: (...args: A) => T | Promise<T>, ...args: A): Promise<Awaited<T>>;
	/** Reloads the page and waits for the harness again. */
	reload(): Promise<void>;
	/** Closes the tab as a person would: its page ends, and what it held (its Web Locks, its worker) goes with it. */
	close(): Promise<void>;
}

export interface Browser {
	readonly name: BrowserName;
	/** A new tab on the harness page. */
	open(): Promise<Tab>;
}

export interface Case {
	name: string;
	/** Why the case doesn't run in a browser, by its name. */
	skip?: Partial<Record<BrowserName, string>>;
	/** Throws to fail. `log` adds a line to the run's output. The runner closes the tabs a case leaves open. */
	run(browser: Browser, log: (line: string) => void): Promise<void>;
}
