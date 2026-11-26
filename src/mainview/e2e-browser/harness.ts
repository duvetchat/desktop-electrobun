// What the browser cases (<suite>.cases.ts) and their runner (scripts/web-e2e.ts) share: the browser and its tabs as a
// case drives them. Types only, so the runner, which Bun runs outside the page's build, imports nothing of the page.

export type BrowserName = "chrome" | "firefox";

/** A tab of the browser a case runs in, on the suite's page, loaded and ready. */
export interface Tab {
	/**
	 * Runs `fn` in the page with `args`, and resolves with what it returns. Both cross as JSON, and `fn` crosses as its
	 * source: it sees the page's globals (the harness page's duvetE2E among them), never the case's variables.
	 */
	run<A extends unknown[], T>(fn: (...args: A) => T | Promise<T>, ...args: A): Promise<Awaited<T>>;
	/** Reloads the page and waits for it again. */
	reload(): Promise<void>;
	/** Closes the tab as a person would: its page ends, and what it held (its Web Locks, its worker) goes with it. */
	close(): Promise<void>;
}

export interface Browser {
	readonly name: BrowserName;
	/** A new tab on the suite's page, or on `path` of its site (the app's `/sign-in.html`). */
	open(path?: string): Promise<Tab>;
}

/** A stack's seeded account, as the API's harness names them (E2E_LIVE_ACCOUNTS). */
export interface Account {
	id: string;
	email: string;
}

/** A request the app sends, held at the proxy between the app and the API (scripts/web-e2e.ts). */
export interface Held {
	/** Settles once a request is held: before the API had it, or with the API's answer held. */
	readonly reached: Promise<void>;
	/** Settles once the app went away from it: what it sent never reached the API, or it never heard the answer. */
	readonly dropped: Promise<void>;
	/** Lets it go on, to the API or to the app. */
	release(): void;
}

/** A request the proxy passed on to the API, with its body as text, and the status the API answered. */
export interface Forwarded {
	method: string;
	path: string;
	body: string;
	status: number;
}

/** The stack the app runs against, as the app's suite sees it (PLAN-E2E-CLIENTES.md, Task 34). */
export interface Stack {
	/** The API itself, for what a case does there of its own (a friendship, a DM): the app goes through the proxy. */
	api: string;
	/** The accounts this browser's run may use: each browser has a pair of its own, so one stack serves both. */
	accounts: Account[];
	password: string;
	/** The app's own X-Duvet-Client, as the web build sends it. */
	client: string;
	/**
	 * Holds the next request the app sends whose method and path match: `before` it reaches the API, or `after`, with
	 * the API's answer, until it's released or the app goes away from it.
	 */
	hold(method: string, path: RegExp, when: "before" | "after"): Held;
	/** The requests the proxy passed on to the API, in order. */
	forwarded(): Forwarded[];
}

/** What a case gets of its suite's run besides its own browser. */
export interface SuiteRun {
	/**
	 * A browser of the case's kind in a profile of its own, kept for the whole suite: asked for again by its name, it's
	 * the same one, with what its tabs left (their storage, their session).
	 */
	profile(name: string): Promise<Browser>;
	/** The stack, for a suite that runs the app; null for the harness page's. */
	stack: Stack | null;
}

export interface Case {
	name: string;
	/** Why the case doesn't run in a browser, by its name. */
	skip?: Partial<Record<BrowserName, string>>;
	/**
	 * Throws to fail. `browser` is the case's own, in a fresh profile, launched as it first opens a tab; `log` adds a line
	 * to the run's output. The runner closes the case's browser, and the tabs a case leaves open in it.
	 */
	run(browser: Browser, log: (line: string) => void, suite: SuiteRun): Promise<void>;
}

/** What a suite's module exports: its cases, and the page they run on (the harness page, unless it's the app). */
export interface Suite {
	default: Case[];
	page?: "harness" | "app";
}
