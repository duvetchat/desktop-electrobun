// A conversation's history shared with a member (PLAN-E2E-CLIENTES.md, Task 30; decision 26), and the packages this
// device is handed (PLAN-E2E-API.md, «Rutas», I).
//
// Sharing is the person's act, on another member, with how far back it goes: the core seals what this device holds of
// the conversation from then on (`history_share`), the newest that fit in 64 MiB; the API takes the package (its PUT,
// where the hour's ten shares are counted), its parts go up one by one, it's completed (its notice, type 4, goes to the
// conversation) and its key goes to each of the member's devices' inbox. The person hears once the API took it or why
// it didn't; the rest goes outside the engine's turn, as a catch-up does (deviceless.ts), and a try that failed waits
// and goes on with the same package, which the API takes again.
//
// Receiving, a package is listed (HISTORY_SHARE_CREATE, GET …/history-shares) and its key comes by the inbox, in either
// order: one whose key hasn't come waits for it, and nothing of it is fetched. The key says what it is, as its sender's
// device signs it: a member's share is offered, and added only on the person's word (Ruling 22: never a package a
// server or a member made up, added unasked); a catch-up is added by itself. One at a time: its parts come down outside
// the engine's turn, then the core takes them in it, a catch-up only once nothing else waits there (the app quiet), after
// the conversation's queue (its welcome). Then the API is told (its acknowledgement), and the rows that waited show it.
import { FetchError } from "$lib/api/api";
import type { HistoryShareUpload } from "$lib/api/e2e";
import { retryAfterMs } from "$lib/emoji-retry";
import type { HistoryShare } from "$lib/types";
import { CoreError } from "../errors";
import { MAX_SHARE_PARTS, type ShareMade } from "../host";
import type { EngineParts } from "./engine";
import { observeUsers, withIdentities } from "./identity";
import { SHARE_KEYS } from "./store";

/** How far back a share goes, as the core takes it. */
export type ShareRange = "day" | "week" | "month" | "all";
export const SHARE_RANGES: readonly ShareRange[] = ["day", "week", "month", "all"];

/**
 * What the person's share came to: the API took the package (its parts go on up from there), and whether the core had
 * to leave out its oldest messages, holding every one from `start` on (Unix ms); or why it didn't go: the hour's ten
 * shares, its `retryAfterMs` the wait the API said; a member with no device to take it; a refusal, in the API's words
 * when it gave some.
 */
export type ShareOutcome =
	| { sent: true; truncated: boolean; start: number }
	| { sent: false; why: "limit"; retryAfterMs: number }
	| { sent: false; why: "no_device" }
	| { sent: false; why: "refused"; error: string | null };

/** A member's share this device was handed, which it offers until the person adds it. */
export interface SharedOffer {
	share_id: string;
	conversation_id: string;
	from_user_id: string;
	/** How far back it goes, as the API lists it; none for what isn't one of the four. */
	range: ShareRange | null;
	/** It holds every message from then on (RFC 3339), as the API lists it. */
	starts_at: string;
}

const HOUR = 3600_000;
const RETRY_MS = 60_000;
const RETRY_MOST_MS = HOUR;
/** The keys the record keeps: a device is handed a few packages, each named once. */
const KEYS_KEPT = 100;

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);
/** Answers a later try may get past: none (the network), a session's renewal, a slow answer, a limit, the server. */
const passing = (status: number | undefined) =>
	status === undefined || [401, 408, 429].includes(status) || status >= 500;
/** How long a try that failed waits: what a 429 says, else a minute, then twice as long each time, up to an hour. */
function waitAfter(error: unknown, tries: number): number {
	const asked =
		statusOf(error) === 429 && error instanceof FetchError
			? retryAfterMs(error.response?.headers.get("Retry-After") ?? null, Date.now())
			: undefined;
	return asked ?? Math.min(RETRY_MOST_MS, RETRY_MS * 2 ** tries);
}
/** The API's own words for a refusal, when it gave some. */
const apiWords = (error: unknown): string | null => {
	const said: unknown = error instanceof FetchError ? error.response?.data?.error : undefined;
	return typeof said === "string" && said ? said : null;
};

/** A package of the person's going up: what's done of it, so a try that failed goes on from there. */
interface Sharing {
	conversationId: string;
	made: ShareMade;
	about: HistoryShareUpload;
	/** The API took it (its PUT): the person was answered. */
	taken: boolean;
	partsUp: number;
	completed: boolean;
	keysSent: Set<string>;
	tries: number;
	cancel: (() => void) | null;
	/** Answers the person, once the API answered its package. */
	answer: (outcome: ShareOutcome) => void;
}

/** The person's shares going up, each until its key reached every device of the member's it was sealed to. */
export class Shares {
	readonly #parts: EngineParts;
	readonly #going = new Set<Sharing>();
	readonly #uploads = new Set<Promise<void>>();

	constructor(parts: EngineParts) {
		this.#parts = parts;
	}

	/**
	 * In the engine's turn, with the conversation's queue applied: the package, sealed to the member's listed devices as
	 * the API serves them (the member observed first), then its upload, outside the turn. What it gives settles once the
	 * API answered the package; a member with no listed device is told at once, with nothing made.
	 */
	async make(conversationId: string, to: string, range: ShareRange): Promise<{ answer: Promise<ShareOutcome> }> {
		const { api, host } = this.#parts;
		const identity = await api.identity(to).catch((error: unknown) => {
			if (statusOf(error) === 403 || statusOf(error) === 404) return null;
			throw error;
		});
		const none = { answer: Promise.resolve<ShareOutcome>({ sent: false, why: "no_device" }) };
		if (!identity?.certificates.length) return none;
		await observeUsers(this.#parts, [to]);
		let made: ShareMade;
		try {
			made = await withIdentities(this.#parts, () =>
				host.share({
					...{ cmd: "history_share", conversation_id: conversationId, to_user: to, range },
					devices: identity.certificates,
				}),
			);
		} catch (error) {
			// None of the devices served is on their list as this device holds it.
			if (error instanceof CoreError && (error.rule === "device_not_listed" || error.field === "devices")) return none;
			throw error;
		}
		const about: HistoryShareUpload = {
			...{ to_user_id: to, kind: "share", range, starts_at: new Date(made.start).toISOString() },
			...{ size: made.size, parts: made.parts },
		};
		let answer: (outcome: ShareOutcome) => void = () => {};
		const answered = new Promise<ShareOutcome>((resolve) => (answer = resolve));
		const sharing: Sharing = {
			...{ conversationId, made, about, taken: false, partsUp: 0, completed: false, keysSent: new Set<string>() },
			...{ tries: 0, cancel: null, answer },
		};
		this.#going.add(sharing);
		this.#start(sharing);
		return { answer: answered };
	}

	/** The uploads going on now, settled, whatever they end as. */
	settled(): Promise<void> {
		return Promise.all([...this.#uploads]).then(() => {});
	}

	/** Nothing more goes up: what waits is let go, and the person still waiting is told it didn't go. */
	stop() {
		for (const sharing of [...this.#going]) this.#done(sharing, { sent: false, why: "refused", error: null });
	}

	#start(sharing: Sharing) {
		const upload: Promise<void> = this.#upload(sharing).finally(() => this.#uploads.delete(upload));
		this.#uploads.add(upload);
	}

	/**
	 * Outside the turn, from where it stopped: the package, its parts, its completion, and its key to each device; a device
	 * the API no longer has, or no longer lets this user's reach, takes none.
	 */
	async #upload(sharing: Sharing) {
		const { api, host } = this.#parts;
		const { conversationId, made, about } = sharing;
		try {
			if (!sharing.taken) {
				await api.putShare(conversationId, made.share_id, about);
				sharing.taken = true;
				sharing.answer({ sent: true, truncated: made.truncated, start: made.start });
			}
			for (; sharing.partsUp < made.parts; sharing.partsUp++) {
				const part = await host.sharePart(made.share_id, sharing.partsUp);
				await api.putSharePart(conversationId, made.share_id, sharing.partsUp, new Blob([part.slice()]));
			}
			if (!sharing.completed) {
				await api.completeShare(conversationId, made.share_id);
				sharing.completed = true;
			}
			for (const { device_id, message } of made.keys) {
				if (sharing.keysSent.has(device_id)) continue;
				await api.sendToDevice(device_id, message).catch((error: unknown) => {
					if (statusOf(error) !== 403 && statusOf(error) !== 404) throw error;
				});
				sharing.keysSent.add(device_id);
			}
		} catch (error) {
			return this.#failed(sharing, error);
		}
		this.#done(sharing, null);
	}

	/**
	 * A try that failed. Before the API took the package, the person hears at once why it didn't go, and it goes: the
	 * hour's ten shares (a 429, with its wait), a refusal of the API's in its words, anything else (no answer, the server
	 * failing) in the app's; Share again makes another. Once taken, one a later try may get past (the network, the
	 * server, a full inbox) waits and goes on with the same package, and a refusal ends it, said in the log alone.
	 */
	#failed(sharing: Sharing, error: unknown) {
		if (!this.#going.has(sharing)) return;
		const status = statusOf(error);
		if (!sharing.taken) {
			console.error("[e2e] A share of a conversation's history didn't go:", error);
			const refused = status !== undefined && status < 500 ? apiWords(error) : null;
			return this.#done(
				sharing,
				status === 429
					? { sent: false, why: "limit", retryAfterMs: waitAfter(error, 0) }
					: { sent: false, why: "refused", error: refused },
			);
		}
		const full = status === 409 && sharing.completed;
		if ((!passing(status) && !full) || error instanceof CoreError) {
			console.error("[e2e] A share of a conversation's history stopped:", error);
			return this.#done(sharing, null);
		}
		console.error("[e2e] A share of a conversation's history waits for its next try:", error);
		const wait = waitAfter(error, sharing.tries++);
		sharing.cancel = this.#parts.clock.later(wait, () => {
			sharing.cancel = null;
			if (this.#going.has(sharing)) this.#start(sharing);
		});
	}

	/** It's over: the host lets the package go, and the person, if still waiting, hears how it went. */
	#done(sharing: Sharing, outcome: ShareOutcome | null) {
		sharing.cancel?.();
		this.#going.delete(sharing);
		if (outcome && !sharing.taken) sharing.answer(outcome);
		void this.#parts.host.dropShare(sharing.made.share_id).catch((error: unknown) => {
			console.error("[e2e] A shared history's package stays with the host until it closes:", error);
		});
	}
}

/** A package's key as the inbox brought it (receive_direct's answer): whose package, from whom, of which kind. */
export interface ShareKey {
	type: "history.key" | "catch_up.key";
	share_id: string;
	conversation_id: string;
	/** Who shared it: the user whose device sealed it. */
	user_id: string;
}

/** Whether receive_direct's answer is a package's key. */
export const isShareKey = (received: { type: string }): received is ShareKey =>
	received.type === "history.key" || received.type === "catch_up.key";

/** The keys the record keeps, oldest first: what doesn't read as one is none. */
function keysIn(parts: EngineParts): ShareKey[] {
	const kept = parts.store.read<unknown>(SHARE_KEYS);
	if (!Array.isArray(kept)) return [];
	return kept.filter(
		(key): key is ShareKey =>
			typeof key === "object" &&
			key !== null &&
			isShareKey(key) &&
			[key.share_id, key.conversation_id, key.user_id].every((field) => typeof field === "string"),
	);
}

/** A package for this device, as the API lists it, and what's done of it here. */
interface Incoming {
	share: HistoryShare;
	/** Its parts down so far, in order: kept until the core took them, so a try that failed goes on from there. */
	parts: Uint8Array[];
	/** In this device's core: only its acknowledgement is left. */
	imported: boolean;
	/** Asked for: in the lane, or waiting to be. */
	queued: boolean;
	tries: number;
	cancel: (() => void) | null;
}

/** What the engine gives the packages it receives. */
export interface ReceivedParts {
	/** Runs work in the engine's turn while the device is ready; the person's act is refused otherwise. */
	turn: <T>(work: () => Promise<T>) => Promise<T>;
	/** Runs work in the engine's turn once nothing else waits there, while the device is ready: undefined if it isn't. */
	quiet: <T>(work: () => Promise<T>) => Promise<T | undefined>;
	/** The conversation's queue applied, in the turn: its welcome brings this device into its group. */
	sync: (conversationId: string) => Promise<void>;
	/** The conversation's messages changed: the views read them again. */
	changed: (conversationId: string) => void;
	/** What a conversation offers changed. */
	offered: (conversationId: string) => void;
}

/** The packages this device receives: offered or added, each acknowledged once it's in. */
export class Received {
	readonly #parts: EngineParts;
	readonly #given: ReceivedParts;
	readonly #incoming = new Map<string, Incoming>();
	/** One package at a time comes in: the one before ends first, however it ends. */
	#lane: Promise<unknown> = Promise.resolve();
	readonly #working = new Set<Promise<unknown>>();

	constructor(parts: EngineParts, given: ReceivedParts) {
		this.#parts = parts;
		this.#given = given;
	}

	/** HISTORY_SHARE_CREATE: a package for this user, complete. */
	heard(share: HistoryShare) {
		this.#take(share);
	}

	/**
	 * At the start and at each READY, in the turn: the API's packages for this device. One it no longer lists goes (another
	 * device of the user's took it in and the API let it go, or its time ran out), its key with it.
	 */
	async listed(): Promise<void> {
		const listed = await this.#parts.api.shares();
		const ids = new Set(listed.map((share) => share.id));
		for (const [id, incoming] of [...this.#incoming]) {
			if (!ids.has(id) && !incoming.queued) this.#letGo(incoming, true);
		}
		for (const share of listed) this.#take(share);
	}

	/**
	 * A package's key, which the inbox brought and the core keeps: kept in the record too, as the inbox deletes it next,
	 * and its package offered or added. Whether the record holds it: one it doesn't stays in the inbox for the next round.
	 */
	keyCame(key: ShareKey): boolean {
		const { store } = this.#parts;
		const others = keysIn(this.#parts).filter((one) => one.share_id !== key.share_id);
		const { type, share_id, conversation_id, user_id } = key;
		store.write(SHARE_KEYS, [...others, { type, share_id, conversation_id, user_id }].slice(-KEYS_KEPT));
		const holds = keysIn(this.#parts).some((one) => one.share_id === key.share_id);
		const incoming = this.#incoming.get(key.share_id);
		if (holds && incoming) this.#ready(incoming);
		return holds;
	}

	/** The members' shares of the conversation this device offers, the oldest first. */
	offers(conversationId: string): SharedOffer[] {
		return [...this.#incoming.values()].flatMap(({ share, imported }) => {
			if (imported || share.conversation_id !== conversationId || this.#kindOf(share) !== "share") return [];
			const range = SHARE_RANGES.find((one) => one === share.range) ?? null;
			return [
				{
					...{ share_id: share.id, conversation_id: share.conversation_id, from_user_id: share.from_user_id },
					...{ range, starts_at: share.starts_at },
				},
			];
		});
	}

	/**
	 * The person's yes to an offered share: it comes in now, after what's coming in already. How many messages it brought;
	 * a refusal of the core's ends the offer, one a try may get past keeps it, with what came down of it.
	 */
	async add(shareId: string): Promise<number> {
		const incoming = this.#incoming.get(shareId);
		if (!incoming || this.#kindOf(incoming.share) !== "share") {
			throw new CoreError("not_found", "this device offers no such share", { what: "share" });
		}
		try {
			return await this.#enqueue(incoming, false);
		} catch (error) {
			this.#settleFailure(incoming, error, false);
			throw error;
		}
	}

	/** A conversation this device is no longer in: its packages go, offered or not. */
	forget(conversationId: string) {
		for (const incoming of [...this.#incoming.values()]) {
			if (incoming.share.conversation_id === conversationId) this.#letGo(incoming, false);
		}
	}

	/** The device is ready again: what came meanwhile is offered, or comes in, now. */
	again() {
		for (const incoming of [...this.#incoming.values()]) this.#ready(incoming);
	}

	/** Nothing more comes in: what waits is let go, its parts with it. */
	stop() {
		for (const incoming of this.#incoming.values()) incoming.cancel?.();
		this.#incoming.clear();
	}

	/** What's coming in now, settled, whatever it ends as. */
	settled(): Promise<void> {
		return Promise.all([...this.#working]).then(() => {});
	}

	/**
	 * A package listed or heard: kept, and offered or added once its key is in; one known already is looked at again (a
	 * catch-up that waited for the device to be ready). Past the API's caps, it's never fetched.
	 */
	#take(share: HistoryShare) {
		const known = this.#incoming.get(share.id);
		if (known) return this.#ready(known);
		if (!Number.isSafeInteger(share.parts) || share.parts < 1 || share.parts > MAX_SHARE_PARTS) return;
		const incoming: Incoming = { share, parts: [], imported: false, queued: false, tries: 0, cancel: null };
		this.#incoming.set(share.id, incoming);
		this.#ready(incoming);
	}

	/**
	 * The kind its key says, as its sender's device signed it: none without a key, or with one that says otherwise than
	 * the API's list (another conversation, sharer or kind), which nothing here takes in.
	 */
	#kindOf(share: HistoryShare): "share" | "catch_up" | null {
		const key = keysIn(this.#parts).find((one) => one.share_id === share.id);
		if (!key) return null;
		const kind = key.type === "catch_up.key" ? "catch_up" : "share";
		const agrees =
			key.conversation_id === share.conversation_id && key.user_id === share.from_user_id && kind === share.kind;
		return agrees ? kind : null;
	}

	/** Its key is in: a member's share is offered, a catch-up comes in by itself. */
	#ready(incoming: Incoming) {
		const kind = this.#kindOf(incoming.share);
		if (kind === "share") this.#given.offered(incoming.share.conversation_id);
		if (kind === "catch_up" && !incoming.queued && !incoming.cancel) {
			this.#enqueue(incoming, true).catch((error: unknown) => this.#settleFailure(incoming, error, true));
		}
	}

	/** Into the lane: what's ahead of it ends first. */
	#enqueue(incoming: Incoming, quiet: boolean): Promise<number> {
		incoming.queued = true;
		const run = this.#lane.then(() => this.#bring(incoming, quiet));
		this.#lane = run.catch(() => {});
		const working: Promise<unknown> = run
			.finally(() => {
				incoming.queued = false;
				this.#working.delete(working);
			})
			.catch(() => {});
		this.#working.add(working);
		return run;
	}

	/**
	 * Its parts, outside the turn, from where an earlier try stopped; then, in it, the conversation's queue and the core's
	 * import; then the API's acknowledgement. How many messages it brought (0 once it was in already).
	 */
	async #bring(incoming: Incoming, quiet: boolean): Promise<number> {
		if (this.#incoming.get(incoming.share.id) !== incoming) return 0;
		const { api, host } = this.#parts;
		const { share } = incoming;
		let imported = 0;
		if (!incoming.imported) {
			for (let n = incoming.parts.length; n < share.parts; n++) incoming.parts.push(await api.sharePart(share.id, n));
			const take = async () => {
				await this.#given.sync(share.conversation_id).catch((error: unknown) => {
					console.error("[e2e] A conversation's queue waits while a package comes in:", error);
				});
				return host.importShare(share.id, incoming.parts);
			};
			const done = quiet ? await this.#given.quiet(take) : await this.#given.turn(take);
			// Not ready now: it comes in at the next READY, which lists it again.
			if (!done) return 0;
			imported = done.imported;
			Object.assign(incoming, { imported: true, parts: [] });
			this.#given.changed(share.conversation_id);
			this.#given.offered(share.conversation_id);
		}
		await api.ackShare(share.id).catch((error: unknown) => {
			// Gone already: nothing is left to say.
			if (statusOf(error) !== 404) throw error;
		});
		this.#letGo(incoming, true);
		return imported;
	}

	/**
	 * A try that failed. A key the core doesn't hold waits for one. What no try changes ends it here, acknowledged: the
	 * core's refusal of the package (it doesn't open, isn't its sharer's, or names another conversation), a part longer
	 * than a part can be, the API's refusal (a package it no longer has goes unacknowledged). Anything else a later try may
	 * get past: a catch-up goes again after a wait, as long as a 429 says, else a minute, then twice as long each time, up
	 * to an hour; a share waits for the person's next yes.
	 */
	#settleFailure(incoming: Incoming, error: unknown, again: boolean) {
		if (this.#incoming.get(incoming.share.id) !== incoming) return;
		const { share } = incoming;
		if (error instanceof CoreError && error.code === "not_found" && error.what === "share") {
			this.#forgetKey(share.id);
			return this.#given.offered(share.conversation_id);
		}
		const passes =
			error instanceof CoreError
				? ["internal", "storage", "locked", "not_ready"].includes(error.code) ||
					(error.code === "not_found" && error.what === "group")
				: !(error instanceof RangeError) && passing(statusOf(error));
		if (!passes) {
			console.error("[e2e] A package of a conversation's history can't come in here:", error);
			if (statusOf(error) !== 404) {
				void this.#parts.api.ackShare(share.id).catch((failed: unknown) => {
					console.error("[e2e] A package that can't come in wasn't acknowledged:", failed);
				});
			}
			return this.#letGo(incoming, true);
		}
		console.error("[e2e] A package of a conversation's history waits for its next try:", error);
		if (!again) return;
		incoming.cancel = this.#parts.clock.later(waitAfter(error, incoming.tries++), () => {
			incoming.cancel = null;
			if (this.#incoming.get(share.id) === incoming) this.#ready(incoming);
		});
	}

	/** It's over here: its parts go, and, done with for good, its key from the record. */
	#letGo(incoming: Incoming, forGood: boolean) {
		const { share } = incoming;
		incoming.cancel?.();
		if (this.#incoming.get(share.id) === incoming) this.#incoming.delete(share.id);
		if (forGood) this.#forgetKey(share.id);
		this.#given.offered(share.conversation_id);
	}

	#forgetKey(shareId: string) {
		const keys = keysIn(this.#parts);
		if (keys.some((key) => key.share_id === shareId)) {
			this.#parts.store.write(
				SHARE_KEYS,
				keys.filter((key) => key.share_id !== shareId),
			);
		}
	}
}
