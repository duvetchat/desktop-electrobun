// What a device fails to open, reported to the API by kind (PLAN-E2E-API.md, K; decision 40): counted, then sent with
// the rest of its minute, one request per kind with its count. The route takes 60 an hour: its 429 stops the round, and
// the next waits as long as it says. No ID and no content goes: only the kind, the client and its version (its header).
import { FetchError } from "$lib/api/api";
import type { DecryptFailureKind, E2eApi } from "$lib/api/e2e";
import type { Clock } from "./engine";

/** How long a failure waits for the others of its minute. */
const WINDOW_MS = 60_000;
/** How long the reports wait after a 429 that doesn't say: the route's window. */
const LIMITED_MS = 3600_000;
/** The most one report counts (the route's): the rest go in the next. */
const MOST = 1000;
/** What a message, an edit or a deletion that didn't open says of why: each is a kind of its own. */
const UNREADABLE: readonly DecryptFailureKind[] = ["message", "envelope", "too_large"];

/** What one entry of an apply did, as its results say. */
export interface EntryResult {
	seq: number;
	kind: string;
	result: string;
	epoch?: number;
	reason?: string;
	rule?: string;
}

/**
 * The kinds of what an apply's entries failed to open: a message, an edit or a deletion that didn't open, by its reason;
 * a commit or a welcome the core couldn't process. Not an entry the API marked deleted (`deleted`, by number), whose
 * bytes are gone: that isn't a failure (PLAN-E2E-API.md, its queue's entry).
 */
export function failedKinds(results: EntryResult[], deleted: ReadonlySet<number>): DecryptFailureKind[] {
	return results.flatMap(({ seq, result, reason, rule }): DecryptFailureKind[] => {
		const unread = UNREADABLE.find((kind) => kind === reason);
		if (deleted.has(seq)) return [];
		if (result === "undecryptable" && unread) return [unread];
		if (result === "rejected" && rule === "invalid_commit") return ["commit"];
		if (result === "rejected" && rule === "invalid_welcome") return ["welcome"];
		return [];
	});
}

/** How long a 429 says to wait (its Retry-After, in seconds), or an hour when it doesn't. */
function retryAfter(error: FetchError): number {
	const seconds = Number(error.response?.headers.get("Retry-After") ?? Number.NaN);
	return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : LIMITED_MS;
}

/** The failures waiting for their report, by kind. */
export class Failures {
	readonly #api: E2eApi;
	readonly #clock: Clock;
	readonly #counts = new Map<DecryptFailureKind, number>();
	#timer: (() => void) | null = null;

	constructor(api: E2eApi, clock: Clock) {
		this.#api = api;
		this.#clock = clock;
	}

	/** One more of a kind, reported with the others of its minute. */
	note(kind: DecryptFailureKind) {
		this.#counts.set(kind, (this.#counts.get(kind) ?? 0) + 1);
		this.#wait();
	}

	/** Stops waiting: what wasn't reported goes uncounted. */
	stop() {
		this.#timer?.();
		this.#timer = null;
	}

	#wait(ms = WINDOW_MS) {
		this.#timer ??= this.#clock.later(ms, () => {
			this.#timer = null;
			void this.#report();
		});
	}

	/**
	 * Each kind's count in one request; what the API didn't take waits for the next minute. A rate limit (429) stops the
	 * round, the other kinds with it, and the next waits its Retry-After, an hour without one.
	 */
	async #report() {
		for (const [kind, count] of [...this.#counts]) {
			const sent = Math.min(count, MOST);
			if (count === sent) this.#counts.delete(kind);
			else this.#counts.set(kind, count - sent);
			try {
				await this.#api.reportDecryptFailure(kind, sent);
			} catch (error) {
				console.error(`[e2e] Failures to decrypt weren't reported (${kind}):`, error);
				this.#counts.set(kind, (this.#counts.get(kind) ?? 0) + sent);
				if (error instanceof FetchError && error.response?.status === 429) {
					// A failure noted meanwhile may have set a minute's wait: this one goes first.
					this.#timer?.();
					this.#timer = null;
					return this.#wait(retryAfter(error));
				}
			}
		}
		if (this.#counts.size > 0) this.#wait();
	}
}
