// Code a page only needs sometimes, loaded apart from the page's own (#357). The settings screens are the case: on
// the web they are sheets of the app's page, in the desktop app they are windows of their own, and the app's main
// window can never draw them, so its page must not carry them. A page that can draw them loads them once it is idle,
// so the first opening finds them there, or at the first opening if that comes sooner.

/** Something loaded once, whoever asks and however often. */
export interface Lazy<Value> {
	/** Loads it, or gives the load already made. A load that failed (the network) is tried again by the next ask. */
	load(): Promise<Value>;
	/** It, once loaded; null before. */
	readonly value: Value | null;
}

export function lazy<Value>(loader: () => Promise<Value>): Lazy<Value> {
	let loading: Promise<Value> | null = null;
	let value: Value | null = null;
	return {
		load() {
			loading ??= loader().then(
				(loaded) => (value = loaded),
				(err: unknown) => {
					loading = null;
					throw err;
				},
			);
			return loading;
		},
		get value() {
			return value;
		},
	};
}

/** What a page offers to run something later: a browser's window. */
export interface IdleHost<Timer = unknown> {
	requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number;
	cancelIdleCallback?: (handle: number) => void;
	setTimeout: (run: () => void, ms: number) => Timer;
	clearTimeout: (handle: Timer) => void;
}

/** How long a busy page is waited for: the load goes then, idle or not. */
export const IDLE_TIMEOUT_MS = 4000;
/** Where the browser can't say when it is idle (Safari before 2024): well after the page's own start. */
export const NO_IDLE_DELAY_MS = 2000;

/** Runs something once the page is idle; returns what calls it off. `host` is the page's own window unless a test
 * hands another. */
export function whenIdle<Timer>(run: () => void, host?: IdleHost<Timer>): () => void {
	if (!host) return whenIdle(run, globalThis);
	if (host.requestIdleCallback) {
		const handle = host.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
		return () => host.cancelIdleCallback?.(handle);
	}
	const timer = host.setTimeout(run, NO_IDLE_DELAY_MS);
	return () => host.clearTimeout(timer);
}
