// A conversation's history shared with a member (PLAN-E2E-CLIENTES.md, Task 30; decision 26), and the packages this
// device is handed (PLAN-E2E-API.md, «Rutas», I).
//
// Sharing is the person's act, on another member, with how far back it goes: the core seals what this device holds of
// the conversation from then on (`history_share`), the newest that fit in 64 MiB; the API takes the package (its PUT,
// where the hour's ten shares are counted), its parts go up one by one, its key goes to each of the member's devices'
// inbox, and last it's completed, which posts its notice (type 4) to the conversation and lists it for the member: so
// nobody sees a share whose keys didn't go. The person hears once the API took it or why it didn't; the rest goes
// outside the engine's turn, as a catch-up does (deviceless.ts), and a try that failed waits and goes on with the same
// package, which the API takes again. One that ends for good after the person heard it went is told to them. A share
// to a verified contact whose key changed (Task 28) is taken, and nothing more of it goes until the person's yes, or
// their verification of the new number.
//
// Receiving, a package is listed (HISTORY_SHARE_CREATE, GET …/history-shares: the API's oldest 100 not acknowledged,
// the next once those are) and its key comes by the inbox, in either order: the record keeps the key's package 30 days,
// stamped as it came, and one whose key hasn't come waits for it, with nothing of it fetched. The key says what it is,
// as its sender's device signs it: a member's share is offered, the newest three of a conversation at once, added only
// on the person's word or let go on their Dismiss (Ruling 22: never a package a server or a member made up, added
// unasked); a catch-up is added by itself, unless its import failed three times, after which it's offered too. One at a
// time: its parts come down outside the engine's turn, then the core takes them in it, a catch-up only once nothing
// else waits there (the app quiet), after the conversation's queue (its welcome). The record notes it in, then the API
// is told (its acknowledgement, tried again alone until it lands), and the rows that waited show it. A package done
// with is kept by its ID for 30 days, so its key coming again goes.
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

/**
 * A package this device offers until the person adds or dismisses it: a member's share, or a catch-up whose import
 * failed three times, which the person may try.
 */
export interface SharedOffer {
	share_id: string;
	conversation_id: string;
	from_user_id: string;
	/** How far back it goes, as the API lists it; none for a catch-up, or for what isn't one of the four. */
	range: ShareRange | null;
	/** It holds every message from then on (RFC 3339), as the API lists it. */
	starts_at: string;
}

const DAY = 24 * 3600_000;
const HOUR = 3600_000;
const RETRY_MS = 60_000;
const RETRY_MOST_MS = HOUR;
/** The API's page of the packages a device hasn't acknowledged: the oldest 100, the next once those are acknowledged. */
export const LIST_PAGE = 100;
/** How long the record keeps a package's key, and the ID of one done with: the API's and the core's 30 days. */
const KEPT_MS = 30 * DAY;
/** The keys, and the IDs of packages done with, that the record keeps at most: past it, the oldest go first. */
export const KEPT_MOST = 1000;
/** A catch-up whose import failed this many times isn't added by itself again: it's offered, for the person to try. */
const MOST_STARTS = 3;
/** The offers a conversation shows at once, the newest first: the next shows as one is added or dismissed. */
const OFFERS_SHOWN = 3;

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);
/** Answers a later try may get past: none (the network), a session's renewal, a slow answer, a limit, the server. */
const passing = (status: number | undefined) =>
	status === undefined || [401, 408, 429].includes(status) || status >= 500;
/**
 * How long a try that failed waits: what a 429 says, a minute at least (a wait of nothing would ask again as often as
 * the server answers so), else a minute, then twice as long each time, up to an hour.
 */
function waitAfter(error: unknown, tries: number): number {
	const asked =
		statusOf(error) === 429 && error instanceof FetchError
			? retryAfterMs(error.response?.headers.get("Retry-After") ?? null, Date.now())
			: undefined;
	return asked === undefined ? Math.min(RETRY_MOST_MS, RETRY_MS * 2 ** tries) : Math.max(asked, RETRY_MS);
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
	/** The step it's at, which says what a failure there means. */
	step: "put" | "parts" | "keys" | "complete";
	partsUp: number;
	keysSent: Set<string>;
	tries: number;
	cancel: (() => void) | null;
	/** Its member's changed key waits for the person's yes (Task 28): nothing more of it goes until again(). */
	held: boolean;
	/** Answers the person, once the API answered its package. */
	answer: (outcome: ShareOutcome) => void;
}

/** The person's shares going up, each until it's completed, its key at every device of the member's it was sealed to. */
export class Shares {
	readonly #parts: EngineParts;
	/** The person's share, which they were told went, ended for good: they're told. */
	readonly #ended: (conversationId: string, shareId: string) => void;
	readonly #going = new Set<Sharing>();
	readonly #uploads = new Set<Promise<void>>();

	constructor(parts: EngineParts, ended: (conversationId: string, shareId: string) => void) {
		this.#parts = parts;
		this.#ended = ended;
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
		if (!identity?.certificates.length) {
			return { answer: Promise.resolve<ShareOutcome>({ sent: false, why: "no_device" }) };
		}
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
			// A device the API serves that isn't on their list as this device holds it: the server's doing, as a member
			// with devices is served only theirs, so it's a refusal, not a member with no device (M6).
			if (error instanceof CoreError && (error.rule === "device_not_listed" || error.field === "devices")) {
				console.error("[e2e] A share's devices weren't the member's list:", error);
				return { answer: Promise.resolve<ShareOutcome>({ sent: false, why: "refused", error: null }) };
			}
			throw error;
		}
		const about: HistoryShareUpload = {
			...{ to_user_id: to, kind: "share", range, starts_at: new Date(made.start).toISOString() },
			...{ size: made.size, parts: made.parts },
		};
		let answer: (outcome: ShareOutcome) => void = () => {};
		const answered = new Promise<ShareOutcome>((resolve) => (answer = resolve));
		const sharing: Sharing = {
			...{ conversationId, made, about, taken: false, step: "put", partsUp: 0, keysSent: new Set<string>() },
			...{ tries: 0, cancel: null, held: false, answer },
		};
		this.#going.add(sharing);
		this.#start(sharing);
		return { answer: answered };
	}

	/** The uploads going on now, settled, whatever they end as. */
	settled(): Promise<void> {
		return Promise.all([...this.#uploads]).then(() => {});
	}

	/**
	 * The person's yes to a contact's changed key, or their verification of the new number: the shares held for one go
	 * on, each held again while its member still waits for a yes.
	 */
	again() {
		for (const sharing of this.#going) {
			if (!sharing.held) continue;
			sharing.held = false;
			this.#start(sharing);
		}
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
	 * Outside the turn, from where it stopped: the package, its parts, its key to each device (one the API no longer
	 * has, or no longer lets this user's reach, takes none), and last its completion, which posts its notice and lists
	 * it for the member. Past the package, a member whose changed key waits for the person's yes holds the rest.
	 */
	async #upload(sharing: Sharing) {
		const { api, host } = this.#parts;
		const { conversationId, made, about } = sharing;
		try {
			if (!sharing.taken) {
				sharing.step = "put";
				await api.putShare(conversationId, made.share_id, about);
				sharing.taken = true;
				sharing.answer({ sent: true, truncated: made.truncated, start: made.start });
			}
			if (this.#held(sharing)) return;
			sharing.step = "parts";
			for (; sharing.partsUp < made.parts; sharing.partsUp++) {
				const part = await host.sharePart(made.share_id, sharing.partsUp);
				await api.putSharePart(conversationId, made.share_id, sharing.partsUp, new Blob([part.slice()]));
			}
			if (this.#held(sharing)) return;
			sharing.step = "keys";
			for (const { device_id, message } of made.keys) {
				if (sharing.keysSent.has(device_id)) continue;
				await api.sendToDevice(device_id, message).catch((error: unknown) => {
					if (statusOf(error) !== 403 && statusOf(error) !== 404) throw error;
				});
				sharing.keysSent.add(device_id);
			}
			sharing.step = "complete";
			await api.completeShare(conversationId, made.share_id);
		} catch (error) {
			return this.#failed(sharing, error);
		}
		this.#done(sharing, null);
	}

	/**
	 * A try that failed. Before the API took the package, the person hears at once why it didn't go, and it goes: the
	 * hour's ten shares (a 429, with its wait), a refusal of the API's in its words, anything else (no answer, the server
	 * failing) in the app's; Share again makes another. Once taken, one a later try may get past (the network, the
	 * server, a device's inbox full) waits and goes on with the same package, and a refusal ends it, told to the person,
	 * who heard it went.
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
		const full = status === 409 && sharing.step === "keys";
		if ((!passing(status) && !full) || error instanceof CoreError) {
			console.error("[e2e] A share of a conversation's history stopped:", error);
			this.#done(sharing, null);
			return this.#ended(sharing.conversationId, sharing.made.share_id);
		}
		console.error("[e2e] A share of a conversation's history waits for its next try:", error);
		const wait = waitAfter(error, sharing.tries++);
		sharing.cancel = this.#parts.clock.later(wait, () => {
			sharing.cancel = null;
			if (this.#going.has(sharing)) this.#start(sharing);
		});
	}

	/** Whether its member's changed key waits for the person's yes (Task 28), which holds it, untried, until again(). */
	#held(sharing: Sharing): boolean {
		sharing.held = !!this.#parts.contacts?.holding([sharing.about.to_user_id]).length;
		return sharing.held;
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

/** What only a package's acknowledgement is left for: it came in, the person dismissed it, or it can't come in here. */
type Owed = "imported" | "dismissed" | "refused";
const OWED: readonly Owed[] = ["imported", "dismissed", "refused"];

/**
 * A package's key as the record keeps it (never the key itself, which the core keeps): what the inbox brought, when it
 * came (this device's clock), how many imports of it began without coming in, and what's owed of it.
 */
export interface KeptKey extends ShareKey {
	at: number;
	starts: number;
	owed: Owed | null;
}

/** What the record holds: the keys by package, and the packages done with, by ID, with when. */
export interface Kept {
	keys: Map<string, KeptKey>;
	done: Map<string, number>;
}

/**
 * The record without what's past its 30 days, and past its most of each, the oldest first: nothing goes because a list
 * left its package out.
 */
export function pruned({ keys, done }: Kept, now: number): Kept {
	const kept = <T>(entries: Map<string, T>, at: (value: T) => number) =>
		new Map(
			[...entries]
				.filter(([, value]) => now - at(value) < KEPT_MS)
				.sort(([, a], [, b]) => at(b) - at(a))
				.slice(0, KEPT_MOST),
		);
	return { keys: kept(keys, (key) => key.at), done: kept(done, (at) => at) };
}

const isEntry = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The record as it reads now: what doesn't read as an entry is none, and one without its time came now. */
function readKept(parts: EngineParts): Kept {
	const now = parts.clock.now();
	const kept: Kept = { keys: new Map(), done: new Map() };
	const read = parts.store.read<unknown>(SHARE_KEYS);
	for (const entry of Array.isArray(read) ? read : []) {
		if (!isEntry(entry) || typeof entry.share_id !== "string") continue;
		const { share_id, type, conversation_id, user_id, at, starts, owed, done } = entry;
		if (typeof done === "number") kept.done.set(share_id, done);
		else if (
			(type === "history.key" || type === "catch_up.key") &&
			typeof conversation_id === "string" &&
			typeof user_id === "string"
		) {
			kept.keys.set(share_id, {
				...{ type, share_id, conversation_id, user_id, at: typeof at === "number" ? at : now },
				starts: typeof starts === "number" && Number.isSafeInteger(starts) && starts > 0 ? starts : 0,
				owed: OWED.find((one) => one === owed) ?? null,
			});
		}
	}
	return pruned(kept, now);
}

/** The record written as it is now, its oldest past its most left out. */
function writeKept(parts: EngineParts, kept: Kept) {
	const { keys, done } = pruned(kept, parts.clock.now());
	parts.store.write(SHARE_KEYS, [
		...[...keys.values()].map(({ type, share_id, conversation_id, user_id, at, starts, owed }) => ({
			...{ type, share_id, conversation_id, user_id, at },
			...(starts ? { starts } : {}),
			...(owed ? { owed } : {}),
		})),
		...[...done].map(([share_id, at]) => ({ share_id, done: at })),
	]);
}

/**
 * The kind a package's key says, as its sender's device signed it, when it agrees with the API's listing (its
 * conversation, sharer and kind); none otherwise, which nothing here takes in, offers or acknowledges (Ruling 22).
 */
function kindOf(share: HistoryShare, key: ShareKey): "share" | "catch_up" | null {
	const kind = key.type === "catch_up.key" ? "catch_up" : "share";
	const agrees =
		key.conversation_id === share.conversation_id && key.user_id === share.from_user_id && kind === share.kind;
	return agrees ? kind : null;
}

/** Whether a package is offered: its key agrees, nothing is owed of it, and it's a share, or a catch-up past its tries. */
function offered(share: HistoryShare, key: KeptKey | undefined): boolean {
	const kind = key && kindOf(share, key);
	return !!kind && !key.owed && (kind === "share" || key.starts >= MOST_STARTS);
}

/** A package for this device, as the API lists it, and what's coming of it here. */
interface Incoming {
	share: HistoryShare;
	/** Its parts down so far, in order: kept until the core took them, or failed to, so a download goes on from there. */
	parts: Uint8Array[];
	/** Asked for: in the lane, or waiting to be. */
	queued: boolean;
	/** The tries that failed, for the wait before the next. */
	tries: number;
	cancel: (() => void) | null;
	/** When it was last listed or heard, in the order things came: one that came since a list was asked stays. */
	seen: number;
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
	/** The API's packages listed again, in the turn, once the device is ready. */
	list: () => void;
}

/** The packages this device receives: offered or added, each acknowledged once it's done with here. */
export class Received {
	readonly #parts: EngineParts;
	readonly #given: ReceivedParts;
	readonly #incoming = new Map<string, Incoming>();
	/** One package at a time comes in: the one before ends first, however it ends. */
	#lane: Promise<unknown> = Promise.resolve();
	readonly #working = new Set<Promise<unknown>>();
	/** What was listed or heard, counted: a list lets go only of what came before it was asked. */
	#mark = 0;
	/** The API's last list was a whole page: what's past it isn't listed until acknowledgements make room for it. */
	#full = false;

	constructor(parts: EngineParts, given: ReceivedParts) {
		this.#parts = parts;
		this.#given = given;
	}

	/** HISTORY_SHARE_CREATE: a package for this user, complete. */
	heard(share: HistoryShare) {
		this.#take(share);
	}

	/**
	 * At the start, at each READY, and after an acknowledgement while the API's page was whole: the API's packages for
	 * this device. One known before the list was asked that it no longer lists goes (another device of the user's took
	 * it in, or its time ran out), but only from a list shorter than the API's page, which leaves out what's past it;
	 * the record keeps its key all the same, until its 30 days, as it may be listed again.
	 */
	async listed(): Promise<void> {
		const mark = this.#mark;
		const listed = await this.#parts.api.shares();
		this.#full = listed.length >= LIST_PAGE;
		const ids = new Set(listed.map((share) => share.id));
		// The record read once for the whole page, and what each conversation offers told once.
		const [kept, told] = [readKept(this.#parts), new Set<string>()];
		for (const [id, incoming] of [...this.#incoming]) {
			if (!this.#full && !ids.has(id) && !incoming.queued && incoming.seen <= mark) this.#letGo(incoming, told);
		}
		for (const share of listed) this.#take(share, kept, told);
		for (const conversationId of told) this.#given.offered(conversationId);
	}

	/**
	 * A package's key, which the inbox brought and the core keeps: kept in the record too, stamped as it came, as the
	 * inbox deletes it next, and its package offered or added. Whether the record holds it: one it doesn't stays in the
	 * inbox for the next round. One of a package done with is a key sent again, which goes as it comes.
	 */
	keyCame(key: ShareKey): boolean {
		const kept = readKept(this.#parts);
		const { type, share_id, conversation_id, user_id } = key;
		if (kept.done.has(share_id)) return true;
		const had = kept.keys.get(share_id);
		kept.keys.set(share_id, {
			...{ type, share_id, conversation_id, user_id },
			...{ at: had?.at ?? this.#parts.clock.now(), starts: had?.starts ?? 0, owed: had?.owed ?? null },
		});
		writeKept(this.#parts, kept);
		const holds = readKept(this.#parts).keys.has(share_id);
		const incoming = this.#incoming.get(share_id);
		if (holds && incoming) this.#ready(incoming);
		return holds;
	}

	/** What the conversation offers: its newest three, by the IDs their senders made them with. */
	offers(conversationId: string): SharedOffer[] {
		const { keys } = readKept(this.#parts);
		return [...this.#incoming.values()]
			.filter(({ share }) => share.conversation_id === conversationId && offered(share, keys.get(share.id)))
			.map(({ share }) => share)
			.sort((a, b) => b.id.localeCompare(a.id))
			.slice(0, OFFERS_SHOWN)
			.map((share) => ({
				...{ share_id: share.id, conversation_id: share.conversation_id, from_user_id: share.from_user_id },
				...{ range: SHARE_RANGES.find((one) => one === share.range) ?? null, starts_at: share.starts_at },
			}));
	}

	/**
	 * The person's yes to an offer: it comes in now, after what's coming in already. How many messages it brought; a
	 * refusal of the core's ends the offer, one a try may get past keeps it, for another yes.
	 */
	async add(shareId: string): Promise<number> {
		const incoming = this.#offer(shareId);
		try {
			return await this.#enqueue(incoming, false);
		} catch (error) {
			this.#settleFailure(incoming, error);
			throw error;
		}
	}

	/**
	 * The person's Dismiss of an offer: it shows no more, and the API is told this device is done with it, as an offer
	 * left would hold a place of the API's page for its 30 days.
	 */
	dismiss(shareId: string): void {
		const incoming = this.#offer(shareId);
		this.#update(shareId, (key) => ({ ...key, owed: "dismissed" }));
		this.#ready(incoming);
	}

	/** A conversation this device is no longer in: its packages go, offered or not. */
	forget(conversationId: string) {
		for (const incoming of [...this.#incoming.values()]) {
			if (incoming.share.conversation_id === conversationId) this.#letGo(incoming);
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
		this.#full = false;
	}

	/** What's coming in now, settled, whatever it ends as. */
	settled(): Promise<void> {
		return Promise.all([...this.#working]).then(() => {});
	}

	/** The package of an offer this device shows, or the refusal of one it doesn't. */
	#offer(shareId: string): Incoming {
		const incoming = this.#incoming.get(shareId);
		if (!incoming || !offered(incoming.share, readKept(this.#parts).keys.get(shareId))) {
			throw new CoreError("not_found", "this device offers no such share", { what: "share" });
		}
		return incoming;
	}

	/**
	 * A package listed or heard: kept, and offered or added once its key is in; one known already is looked at again (a
	 * catch-up that waited for the device to be ready), as it was first listed. One done with, or past the API's caps,
	 * is never fetched. By the record as `kept` holds it; `told` gathers the conversations whose offers a list tells of
	 * once, at its end.
	 */
	#take(share: HistoryShare, kept = readKept(this.#parts), told?: Set<string>) {
		if (kept.done.has(share.id)) return;
		const seen = ++this.#mark;
		const known = this.#incoming.get(share.id);
		if (known) {
			known.seen = seen;
			return this.#ready(known, kept, told);
		}
		if (!Number.isSafeInteger(share.parts) || share.parts < 1 || share.parts > MAX_SHARE_PARTS) return;
		const incoming: Incoming = { share, parts: [], queued: false, tries: 0, cancel: null, seen };
		this.#incoming.set(share.id, incoming);
		this.#ready(incoming, kept, told);
	}

	/**
	 * Its key is in: a share is offered; a catch-up comes in by itself while its imports failed fewer than three times,
	 * and is offered after; one whose acknowledgement is owed has it go, alone. Its conversation's offers are told now,
	 * or gathered in `told`.
	 */
	#ready(incoming: Incoming, kept = readKept(this.#parts), told?: Set<string>) {
		const { share } = incoming;
		const key = kept.keys.get(share.id);
		const kind = key ? kindOf(share, key) : null;
		if (!key || !kind) return;
		if (told) told.add(share.conversation_id);
		else this.#given.offered(share.conversation_id);
		const due = key.owed !== null || (kind === "catch_up" && key.starts < MOST_STARTS);
		if (due && !incoming.queued && !incoming.cancel) {
			this.#enqueue(incoming, true).catch((error: unknown) => this.#settleFailure(incoming, error));
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
	 * import, noted in the record before the API's acknowledgement; then that acknowledgement, which alone goes when
	 * it's all that's owed, and which, failing, goes again by itself: the package is in all the same. How many messages
	 * it brought (0 once it was in already).
	 */
	async #bring(incoming: Incoming, quiet: boolean): Promise<number> {
		const { api, host } = this.#parts;
		const { share } = incoming;
		const key = readKept(this.#parts).keys.get(share.id);
		if (this.#incoming.get(share.id) !== incoming || !key || !kindOf(share, key)) return 0;
		let imported = 0;
		if (!key.owed) {
			for (let n = incoming.parts.length; n < share.parts; n++) incoming.parts.push(await api.sharePart(share.id, n));
			const take = async () => {
				await this.#given.sync(share.conversation_id).catch((error: unknown) => {
					console.error("[e2e] A conversation's queue waits while a package comes in:", error);
				});
				// Counted as begun before the core has it: one that fails, or never ends (the app closed meanwhile), counts.
				this.#update(share.id, (kept) => ({ ...kept, starts: kept.starts + 1 }));
				return host.importShare(share.id, incoming.parts).catch((error: unknown) => {
					// The core deletes a key once it imported its package: an import whose end wasn't noted (I2).
					if (error instanceof CoreError && error.code === "not_found" && error.what === "share")
						return { imported: 0 };
					throw error;
				});
			};
			let done: { imported: number } | undefined;
			try {
				done = quiet ? await this.#given.quiet(take) : await this.#given.turn(take);
			} finally {
				// Its parts go once the core had its try, however it ended: a try after a failed import fetches them again.
				incoming.parts = [];
			}
			// Not ready now: it comes in at the next READY, which lists it again.
			if (!done) return 0;
			imported = done.imported;
			this.#update(share.id, (kept) => ({ ...kept, owed: "imported" }));
			this.#given.changed(share.conversation_id);
			this.#given.offered(share.conversation_id);
		}
		const acknowledged = await api.ackShare(share.id).then(
			() => true,
			(error: unknown) => {
				// Gone already: nothing is left to say.
				if (statusOf(error) === 404) return true;
				// Only the acknowledgement is left, which goes again by itself: what this try was for is done.
				this.#settleFailure(incoming, error);
				return false;
			},
		);
		if (acknowledged) this.#done(incoming);
		return imported;
	}

	/**
	 * A try that failed. An acknowledgement that failed goes again by itself, unless the API refuses it for good. What
	 * no try changes ends the package here, its acknowledgement owed: the core's refusal of the package (it doesn't open,
	 * isn't its sharer's, or names another conversation), a part longer than a part can be, the API's refusal; one the
	 * API no longer has is done with. Anything else a later try may get past waits, as long as a 429 says (a minute at
	 * least), else a minute, then twice as long each time, up to an hour: a catch-up goes again by itself while its
	 * imports failed fewer than three times, and is offered after; a share waits for the person's next yes.
	 */
	#settleFailure(incoming: Incoming, error: unknown) {
		if (this.#incoming.get(incoming.share.id) !== incoming) return;
		const { share } = incoming;
		const key = readKept(this.#parts).keys.get(share.id);
		const passes =
			error instanceof CoreError
				? ["internal", "storage", "locked", "not_ready"].includes(error.code) ||
					(error.code === "not_found" && error.what === "group")
				: !(error instanceof RangeError) && passing(statusOf(error));
		if (!passes) {
			console.error("[e2e] A package of a conversation's history can't come in here:", error);
			if (key?.owed || statusOf(error) === 404) return this.#done(incoming);
			this.#update(share.id, (kept) => ({ ...kept, owed: "refused" }));
			return this.#ready(incoming);
		}
		console.error("[e2e] A package of a conversation's history waits for its next try:", error);
		this.#given.offered(share.conversation_id);
		const again = !!key && (key.owed !== null || (key.type === "catch_up.key" && key.starts < MOST_STARTS));
		if (!again) {
			// What waits for the person's next yes holds none of its parts meanwhile: that yes fetches them again.
			incoming.parts = [];
			return;
		}
		incoming.cancel = this.#parts.clock.later(waitAfter(error, incoming.tries++), () => {
			incoming.cancel = null;
			if (this.#incoming.get(share.id) === incoming) this.#ready(incoming);
		});
	}

	/** The record's entry of a package, changed: none without one. */
	#update(shareId: string, change: (key: KeptKey) => KeptKey) {
		const kept = readKept(this.#parts);
		const key = kept.keys.get(shareId);
		if (!key) return;
		kept.keys.set(shareId, change(key));
		writeKept(this.#parts, kept);
	}

	/**
	 * Done with: its key goes from the record and its ID stays 30 days, so a key of it that comes again goes; and while
	 * the API's page was whole, the next ones listed come in as its place frees.
	 */
	#done(incoming: Incoming) {
		const { share } = incoming;
		const kept = readKept(this.#parts);
		kept.keys.delete(share.id);
		kept.done.set(share.id, this.#parts.clock.now());
		writeKept(this.#parts, kept);
		this.#letGo(incoming);
		if (this.#full) this.#given.list();
	}

	/** It goes from here, its parts and its wait with it: the record keeps its key, until its 30 days or it's done with. */
	#letGo(incoming: Incoming, told?: Set<string>) {
		const { share } = incoming;
		incoming.cancel?.();
		incoming.cancel = null;
		if (this.#incoming.get(share.id) === incoming) this.#incoming.delete(share.id);
		if (told) told.add(share.conversation_id);
		else this.#given.offered(share.conversation_id);
	}
}
