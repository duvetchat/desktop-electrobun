import type { WindowKind } from "$lib/platform";

/** When the app checks its session's age (keepSessionFresh): as it starts, when its window comes back into view, and
 * every 10 minutes. */
export type SessionCheck = "start" | "visible" | "tick";

// A session lasts 24 h from its last renewal. As the app starts and when its window comes back, one older than an hour
// renews: the timers don't run while the computer sleeps, and a sleep through its last hour would sign the user out.
// The 10-minute tick renews it an hour early.
const RENEW_ON_RETURN_MS = 60 * 60 * 1000;
const RENEW_ON_TICK_MS = 23 * 60 * 60 * 1000;

/** Whether a check renews the session, whose tokens were issued (by a login or a renewal) at `refreshedAt`. */
export function renewalDue(check: SessionCheck, refreshedAt: number, now: number): boolean {
	return now - refreshedAt >= (check === "tick" ? RENEW_ON_TICK_MS : RENEW_ON_RETURN_MS);
}

/**
 * Whether the renewal due as the app starts goes before its gateway connection: only for tokens in their last hour, or
 * past it, which the gateway would refuse. Younger ones open the connection at once, and the renewal follows it: the
 * gateway follows a connection through a renewal (duvet:access_next), and waiting for one cost the connection a new
 * connection to the API, a preflight and the refresh itself (#281).
 */
export function renewalFirst(refreshedAt: number, now: number): boolean {
	return now - refreshedAt >= RENEW_ON_TICK_MS;
}

/**
 * Whether a window renews the session: the main window only (#357, docs/redesign/DECISIONS.md). The pop-out and the
 * Settings windows share its session through localStorage, and a renewal rotates the session token: two windows
 * renewing at once would each revoke the other's. A window that doesn't renew takes the main window's renewal from
 * storage instead (renewedByMainWindow).
 */
export function windowRenewsSession(window: WindowKind): boolean {
	return window === "main";
}

/** No renewal by the main window showed up in time: the request that needed one fails, and nobody is signed out. */
export class NoRenewalError extends Error {
	constructor() {
		super("The main window didn't renew the session in time");
		this.name = "NoRenewalError";
	}
}

export interface RenewalWatch {
	/** The access token storage holds now. */
	read: () => string | null;
	/** Calls back when another window may have written the token (the storage event); returns what stops it. */
	watch: (changed: () => void) => () => void;
	/** The token this window holds, which the API refused or is about to. */
	stale: string | null;
	timeoutMs: number;
}

/**
 * In a window that doesn't renew: the access token of the main window's renewal, once storage holds one that isn't
 * `stale`. At once when it's there already (this window's copy was behind); else when the main window writes it;
 * NoRenewalError after `timeoutMs`. It asks the API for nothing.
 */
export function renewedByMainWindow({ read, watch, stale, timeoutMs }: RenewalWatch): Promise<string> {
	const renewed = () => {
		const token = read();
		return token && token !== stale ? token : null;
	};
	const already = renewed();
	if (already) return Promise.resolve(already);
	return new Promise((resolve, reject) => {
		const stop = watch(() => {
			const token = renewed();
			if (!token) return;
			clearTimeout(timer);
			stop();
			resolve(token);
		});
		const timer = setTimeout(() => {
			stop();
			reject(new NoRenewalError());
		}, timeoutMs);
	});
}

/**
 * Runs a renewal, and runs it once more after `wait` when it failed without an answer: a network error, not the API's
 * refusal (`answered`). The API may have rotated the session and its answer been lost; for 30 s it gives a refresh with
 * the old session token the same new tokens, where a later check would get a 401 and sign the user out.
 */
export async function renewOnceMore<T>(
	renew: () => Promise<T>,
	answered: (err: unknown) => boolean,
	wait: () => Promise<void>,
): Promise<T> {
	try {
		return await renew();
	} catch (err) {
		if (answered(err)) throw err;
		await wait();
		return renew();
	}
}
