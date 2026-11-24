import { t } from "$lib/i18n";
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

/**
 * No renewal by the main window showed up in time: the request that needed one fails, and nobody is signed out. Its
 * message is what a toast of that request shows (getApiError), in the language of the moment it's made.
 */
export class NoRenewalError extends Error {
	constructor() {
		super(t("auth_session_not_renewed"));
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
	/** Asks the main window to renew now, when storage holds nothing newer: it may be asleep, or see no reason to. */
	ask?: () => void;
}

/**
 * In a window that doesn't renew: the access token of the main window's renewal, once storage holds one that isn't
 * `stale`. At once when it's there already (this window's copy was behind); else the main window is asked to renew
 * (`ask`), and this resolves when it writes the token; NoRenewalError after `timeoutMs`. It asks the API for nothing.
 */
export function renewedByMainWindow({ read, watch, stale, timeoutMs, ask }: RenewalWatch): Promise<string> {
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
		// After the watch is on: the main window's answer is the token it writes.
		ask?.();
	});
}

/** The channel of what the app's other windows ask the main one about the session (lib/window-hub.ts). */
export const SESSION_CHANNEL = "session";

/** A window's copy of the access token, as lib/stores/auth.ts keeps it. */
export interface TokenCopy {
	subscribe(run: (token: string | null) => void): unknown;
	set(token: string | null): void;
}

/**
 * Keeps a window's copy of the access token and the storage the windows share together. The main window owns the
 * token: what it sets (a sign-in, a renewal, a sign-out) is written to storage. Any other window only reads: its copy
 * follows what the main window writes, and nothing it sets reaches storage, so a page that loaded with an older token
 * can never put it back over a renewed one.
 */
export function keepTokenWithStorage(
	mainWindow: boolean,
	token: TokenCopy,
	storage: {
		getItem(key: string): string | null;
		setItem(key: string, value: string): void;
		removeItem(key: string): void;
	},
	onStorage: (changed: (key: string | null) => void) => void,
	key = "duvet_session_token",
): void {
	if (mainWindow) {
		token.subscribe((value) => {
			if (value) storage.setItem(key, value);
			else storage.removeItem(key);
		});
		return;
	}
	// A null key is storage cleared whole.
	onStorage((changed) => {
		if (changed === null || changed === key) token.set(storage.getItem(key));
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
