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
