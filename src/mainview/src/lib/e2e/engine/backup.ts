// The encrypted backup (PLAN-E2E-CLIENTES.md, Task 32; decisions 20, 21 and 44 to 46): each conversation's days as the
// core seals them, a segment a day, kept in the user's own storage. Only a ready device backs up (on the web, the tab
// that leads: Ruling 16), its core's calls in the engine's turn and its requests outside it. A pass runs once the app
// has been quiet a minute, and at the latest 30 minutes after the last one ended, or as a UTC day ends. It takes the
// inbox first, whose change of keys brings the key the work seals with, then goes in this order:
// - a restore, on a device set up as a new one (recovered or approved): every segment, the newest conversation first
//   and each day of it newest first, taken in with what the API saw deleted; one that doesn't open is skipped, and
//   what a passing outage stops is tried again a day later, while the rest comes in;
// - each day backup_due lists: built without what the API saw deleted, put in the place of the copy this device knows
//   of it, and confirmed with the version its build answered. Another copy there (409) is another device's: taken in
//   first, then the day built again over it, never overwritten unseen;
// - what isn't under the current key (a change of keys', or any a new installation finds): each such segment sealed
//   anew under the current key, in the place of the copy it was, the record keeping how far the move went.
// A full storage (413) pauses it for a day. A day too large to keep is set aside, and so is a day, or a restore's day or
// conversation, that failed three passes in a row: each is tried again a day later, while the rest goes on. A move's
// segment that failed three passes in a row is passed over. Any other failure waits a minute, then twice as long each
// time, up to an hour. What waits is never confirmed, so it stays due.
import { FetchError, TooLargeError, UpdateRequiredError } from "$lib/api/api";
import type { BackupSegment } from "$lib/api/e2e";
import { base64Bytes } from "$lib/activity-thumbnail";
import { bytesBase64 } from "$lib/staged-images";
import { CoreError } from "../errors";
import type { EngineParts } from "./engine";
import type { Failures } from "./failures";
import { BACKUP_KEY_SEEN, BACKUP_PAUSE, BACKUP_REENCRYPT, BACKUP_RESTORE, BACKUP_SET_ASIDE } from "./store";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The longest the backup waits for the app to be quiet: a pass at the latest this long after the last one ended. */
const CEILING = 30 * MINUTE;
/** The most a page of the segments or of the deleted messages has (the API's most). */
const PAGE = 1000;
/** The most pages a listing takes: a million segments, or deleted messages, is no real backup's. */
const MAX_PAGES = 1000;
/** How many times one pass builds a day again over another device's copy: past it, the day waits for the next pass. */
const ROUNDS = 3;
/** How many passes in a row may fail on one day or segment before it's set aside. */
const FAILS = 3;
/** A day of no conversation: its build answers the key the core seals with, and writes nothing (sealsWith). */
const NO_CONVERSATION = "00000000-0000-0000-0000-000000000000";
const FIRST_DAY = "2026-01-01";

/** Why the backup is paused: the user's storage is full, or a day's segment is too large to keep. */
export type BackupPause = "full" | "too_large";

/**
 * What the views show of the backup (Settings → Devices, and a restore's bar): a restore's progress; a pause and why,
 * a day too large to keep among them while it's set aside; up to date once a pass found nothing due, and nothing
 * failed since; else days going up.
 */
export type BackupShown =
	| { state: "restoring"; done: number; total: number }
	| { state: "paused"; reason: BackupPause }
	| { state: "uploading" }
	| { state: "up_to_date" };

/** What the engine gives the backup. */
export interface BackupWork {
	/**
	 * A core call in the engine's turn while this device backs up (ready, with no change of keys waiting for its upload):
	 * refused (`not_ready`) when it doesn't, or once the engine stopped.
	 */
	turn<T>(work: () => Promise<T>): Promise<T>;
	/** The inbox, in the engine's turn: a change of keys' transfer brings the key a newer segment is under. */
	inbox(): Promise<void>;
	/** An import brought rows of the conversation: the views read them again. */
	changed(conversationId: string): void;
	/** What the views show of the backup changed. */
	shown(): void;
	/** A request outside the turn was answered 426: the device waits for its update. */
	update(error: UpdateRequiredError): void;
}

interface DueDay {
	conversation_id: string;
	day: string;
	complete: boolean;
}

interface Built {
	data: string;
	key_id: string;
	complete: boolean;
	version: number;
}

/**
 * What the backup counts failures of: a day it backs up (`day:<conversation>/<day>`), a restore's day or conversation
 * (`restore:<conversation>/<day>`, `restore:<conversation>` for its deleted messages), or a move's segment
 * (`move:<segment ID>`). How many passes in a row failed on it, since when it's set aside, and whether it's a day too
 * large.
 */
interface Aside {
	fails: number;
	at?: number;
	tooLarge?: true;
}

/** What a command that opens a segment gave: its answer; or that it doesn't open here, or not with a key held here. */
type Opened<T> = { value: T } | "unread" | "no_key";

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);

/** The segment that holds a day the API kept another one out of (409, `current`): undefined for any other answer. */
function holding(error: unknown): string | undefined {
	if (!(error instanceof FetchError) || error.response?.status !== 409) return undefined;
	const current: unknown = error.response.data?.current;
	return typeof current === "string" ? current : undefined;
}

/** The user's storage is full (the API's 413 «not enough storage space»): what pauses the backup for a day. */
function storageFull(error: unknown): boolean {
	const said: unknown = error instanceof FetchError ? error.response?.data?.error : undefined;
	return statusOf(error) === 413 && typeof said === "string" && /not enough storage space/i.test(said);
}

/**
 * A day too large to keep: a segment past the request's 32 MiB (which never goes, or the API's «over 32 MiB»), past
 * the user's or their bucket's limit for one file («file is too large»), or past the core's own (`too_large`). Any 413
 * but a full storage's is taken for one, so no answer the API rewords stops the other days.
 */
function tooLarge(error: unknown): boolean {
	if (error instanceof TooLargeError) return true;
	if (error instanceof CoreError) return error.code === "too_large";
	return statusOf(error) === 413 && !storageFull(error);
}

/** The API refused a segment's key: one a change of keys this device hasn't taken retired, or none of the user's. */
function refusedKey(error: unknown): boolean {
	const said: unknown = error instanceof FetchError ? error.response?.data?.error : undefined;
	return statusOf(error) === 400 && typeof said === "string" && /^(retired|unknown) backup key$/.test(said);
}

/** Newest first, by day and then by ID. */
const newestFirst = (a: BackupSegment, b: BackupSegment) =>
	a.day === b.day ? (a.id < b.id ? 1 : -1) : a.day < b.day ? 1 : -1;

/** A restore's progress as the views show it: the whole percent reached, so its 1000 segments are told 100 times. */
const step = (progress: { done: number; total: number } | null) =>
	progress ? Math.floor((100 * progress.done) / Math.max(progress.total, 1)) : -1;

export class Backups {
	readonly #parts: EngineParts;
	readonly #failures: Failures;
	readonly #work: BackupWork;
	/** The pass under way, and the one asked for while it runs (all of it, or its restore only). */
	#pass: Promise<void> | null = null;
	#again: "all" | "restore" | null = null;
	/** Moved on by forget and stop: a pass from before them does nothing more. */
	#generation = 0;
	#stopped = false;
	/** The copy this device knows of each day (conversation/day → its segment's ID): what its next upload replaces. */
	readonly #known = new Map<string, string>();
	#restoring: { done: number; total: number } | null = null;
	/** The last pass found nothing due, and nothing failed since. */
	#upToDate = false;
	/** The day or segment the pass works on, which a failure counts against (as `Aside` keys it). */
	#item: string | null = null;
	/** The API answered the pass: a request that got no answer after that is the item's failure, not the network's. */
	#answered = false;
	/** Passing failures in a row, the earliest the next pass may run, and the timer that runs it. */
	#fails = 0;
	#notBefore = 0;
	#retry: (() => void) | null = null;
	/** The pass at the latest (CEILING), however busy the app. */
	#ceiling: (() => void) | null = null;

	constructor(parts: EngineParts, failures: Failures, work: BackupWork) {
		this.#parts = parts;
		this.#failures = failures;
		this.#work = work;
	}

	/** What the views show: a restore's progress, a pause and why, that it's up to date, or else days going up. */
	shown(): BackupShown {
		if (this.#restoring) return { state: "restoring", ...this.#restoring };
		if (this.#pausedAt() !== null) return { state: "paused", reason: "full" };
		if (this.#tooLargeAside()) return { state: "paused", reason: "too_large" };
		return this.#upToDate ? { state: "up_to_date" } : { state: "uploading" };
	}

	/**
	 * This device took the user's identity as a new one (recovered or approved), its first list still to go up: it
	 * restores the backup once it's ready, from the start, as nothing of before it is here.
	 */
	restoreDue() {
		this.#parts.store.write(BACKUP_RESTORE, { done: [] });
	}

	/** The device is ready: a restore that's due starts now, as the person waits for their messages. */
	wake() {
		this.#atTheLatest();
		if (this.#restoreRecord()) this.#start("restore");
	}

	/** The app has been quiet a minute: a pass, unless one waits out a failure or a pause. */
	quiet() {
		this.#start("all");
	}

	/** What the backup does now, settled: a test's wait. */
	settled(): Promise<void> {
		return this.#pass ?? Promise.resolve();
	}

	/** What this device knew of the backup goes, as it starts over as a new device: a pass under way does nothing more. */
	forget() {
		this.#generation++;
		this.#pass = null;
		this.#again = null;
		this.#retry?.();
		this.#retry = null;
		this.#ceiling?.();
		this.#ceiling = null;
		this.#known.clear();
		this.#restoring = null;
		this.#upToDate = false;
		this.#item = null;
		this.#fails = 0;
		this.#notBefore = 0;
	}

	/** Nothing more, for good: the engine stopped. */
	stop() {
		this.forget();
		this.#stopped = true;
	}

	/** A pass, after the one under way when there's one: one at a time. */
	#start(what: "all" | "restore") {
		if (this.#stopped) return;
		if (this.#pass) {
			this.#again = this.#again === "all" || what === "all" ? "all" : "restore";
			return;
		}
		const generation = this.#generation;
		const run = (async () => {
			for (let next: "all" | "restore" | null = what; next && this.#live(generation); ) {
				await this.#once(generation, next === "restore");
				next = this.#again;
				this.#again = null;
			}
		})();
		this.#pass = run;
		void run.finally(() => {
			if (this.#pass === run) this.#pass = null;
			if (this.#live(generation)) this.#atTheLatest();
		});
	}

	/**
	 * The next pass at the latest CEILING from now, however busy the app is, or as the UTC day ends, when that comes
	 * first: the day that ended is due then, and what a pass found up to date before it no longer is.
	 */
	#atTheLatest() {
		if (this.#stopped) return;
		const { clock } = this.#parts;
		const dayLeft = DAY - (clock.now() % DAY);
		this.#ceiling?.();
		this.#ceiling = clock.later(Math.min(CEILING, dayLeft + 1000), () => {
			this.#ceiling = null;
			this.quiet();
		});
	}

	#live(generation: number): boolean {
		return !this.#stopped && generation === this.#generation;
	}

	/** Goes on only while the pass is this device's still: one from before a start over, or a stop, ends here. */
	#check(generation: number) {
		if (!this.#live(generation)) throw new CoreError("not_ready", "the backup stopped");
	}

	/** The record written only while the pass is this device's still. */
	#write(generation: number, key: string, value: unknown) {
		if (this.#live(generation)) this.#parts.store.write(key, value);
	}

	async #once(generation: number, restoreOnly: boolean): Promise<void> {
		if (this.#parts.clock.now() < this.#notBefore) return;
		this.#answered = false;
		try {
			// Nothing before this device backs up: its first call is the turn's, refused until it's ready.
			await this.#work.turn(async () => {});
			// The core's rule: a change of keys' transfer first, which brings the key the work seals with; one that fails
			// leaves the keys as they are, which a refused key and a missing one deal with.
			await this.#work.inbox().catch((failed: unknown) => console.warn("[e2e] The inbox waits:", failed));
			await this.#restore(generation);
			if (restoreOnly || this.#waitsForDay()) return;
			const upToDate = await this.#upload(generation);
			await this.#reencrypt(generation);
			this.#fails = 0;
			if (this.#pausedAt() !== null) {
				this.#write(generation, BACKUP_PAUSE, null);
				this.#work.shown();
			}
			this.#upToDateNow(upToDate);
		} catch (error) {
			if (!this.#live(generation)) return;
			this.#progress(null);
			this.#upToDateNow(false);
			if (error instanceof CoreError && error.code === "not_ready") return;
			if (storageFull(error)) return this.#pauseFor(generation);
			if (error instanceof UpdateRequiredError) return this.#work.update(error);
			console.warn("[e2e] The encrypted backup tries again later:", error);
			// A key this device's core still seals with that the API retired: the change of keys' transfer may wait in
			// the inbox, after which the core builds those days again under the new key.
			if (refusedKey(error)) {
				await this.#work.inbox().catch((failed: unknown) => console.warn("[e2e] The inbox waits:", failed));
			} else if (this.#item && (this.#answered || !(error instanceof TypeError))) {
				// The item's own failure: the API's answer, its bytes, or a request cut after the API answered the pass.
				// One with no answer at all is the network's, and counts against nothing.
				this.#failedOn(generation, this.#item);
			}
			this.#later(Math.min(HOUR, MINUTE * 2 ** this.#fails++));
		} finally {
			this.#item = null;
		}
	}

	/** The pass runs again after `ms`, and none before. */
	#later(ms: number) {
		const { clock } = this.#parts;
		this.#notBefore = clock.now() + ms;
		this.#retry?.();
		this.#retry = clock.later(ms, () => {
			this.#retry = null;
			this.quiet();
		});
	}

	#upToDateNow(upToDate: boolean) {
		if (this.#upToDate === upToDate) return;
		this.#upToDate = upToDate;
		this.#work.shown();
	}

	/** Since when the storage is full, as the record holds it: null when it isn't. */
	#pausedAt(): number | null {
		const at = this.#parts.store.read<{ at?: unknown }>(BACKUP_PAUSE)?.at;
		return typeof at === "number" ? at : null;
	}

	/** The backup pauses for a day (decision 45's full quota), and says so: what waits stays due. */
	#pauseFor(generation: number) {
		this.#write(generation, BACKUP_PAUSE, { at: this.#parts.clock.now() });
		this.#work.shown();
		this.#later(DAY);
	}

	/** Paused less than a day ago: nothing goes up before the day is over, when the pass tries again by itself. */
	#waitsForDay(): boolean {
		const at = this.#pausedAt();
		const left = at === null ? 0 : at + DAY - this.#parts.clock.now();
		if (left <= 0) return false;
		// After a restart, the timer the pause set went with the app.
		if (!this.#retry) this.#later(left);
		return true;
	}

	/** The days and segments set aside or failing, as the record holds them. */
	#asideRecord(): Record<string, Aside> {
		const kept =
			this.#parts.store.read<Record<string, { fails?: unknown; at?: unknown; tooLarge?: unknown }>>(BACKUP_SET_ASIDE);
		const entries: Record<string, Aside> = {};
		for (const [item, entry] of Object.entries(kept ?? {})) {
			if (typeof entry !== "object" || entry === null) continue;
			entries[item] = {
				fails: typeof entry.fails === "number" ? entry.fails : 0,
				...(typeof entry.at === "number" ? { at: entry.at } : {}),
				...(entry.tooLarge === true ? { tooLarge: true } : {}),
			};
		}
		return entries;
	}

	#tooLargeAside(): boolean {
		return Object.values(this.#asideRecord()).some((entry) => entry.tooLarge);
	}

	/** The record of what's set aside written, and the views told when a day too large came or went with it. */
	#writeAside(generation: number, entries: Record<string, Aside>) {
		const tooLargeBefore = this.#tooLargeAside();
		this.#write(generation, BACKUP_SET_ASIDE, Object.keys(entries).length ? entries : null);
		if (this.#tooLargeAside() !== tooLargeBefore) this.#work.shown();
	}

	/** Whether the pass leaves the item alone: a move's segment for the whole move, anything else for a day after it was set aside. */
	#isAside(item: string): boolean {
		const at = this.#asideRecord()[item]?.at;
		if (at === undefined) return false;
		return item.startsWith("move:") || this.#parts.clock.now() < at + DAY;
	}

	/** A pass failed on the item: one more in a row, and set aside once they're FAILS. */
	#failedOn(generation: number, item: string) {
		const entries = this.#asideRecord();
		const fails = (entries[item]?.fails ?? 0) + 1;
		entries[item] = { fails, ...(fails >= FAILS ? { at: this.#parts.clock.now() } : {}) };
		this.#writeAside(generation, entries);
	}

	/** The item set aside now, for a day: a day too large to keep, or a restore's day under a key this device lacks. */
	#setAside(generation: number, item: string, oversized = false) {
		const entries = this.#asideRecord();
		const at = this.#parts.clock.now();
		entries[item] = { fails: entries[item]?.fails ?? 0, at, ...(oversized ? { tooLarge: true } : {}) };
		this.#writeAside(generation, entries);
	}

	/** The item went through: nothing of it is kept. */
	#cleared(generation: number, item: string) {
		const entries = this.#asideRecord();
		if (!(item in entries)) return;
		delete entries[item];
		this.#writeAside(generation, entries);
	}

	/** What's kept under `prefix` goes, but for the items in `still` (the days still due). */
	#forgetAside(generation: number, prefix: string, still: ReadonlySet<string> = new Set()) {
		const entries = this.#asideRecord();
		const gone = Object.keys(entries).filter((item) => item.startsWith(prefix) && !still.has(item));
		if (!gone.length) return;
		for (const item of gone) delete entries[item];
		this.#writeAside(generation, entries);
	}

	#progress(next: { done: number; total: number } | null) {
		const changed = step(next) !== step(this.#restoring);
		this.#restoring = next;
		if (changed) this.#work.shown();
	}

	/**
	 * The record of a restore that's due: the conversations it went through, and whether only what it set aside is left
	 * (`waiting`). Null when none is due.
	 */
	#restoreRecord(): { done: Set<string>; waiting: boolean } | null {
		const kept = this.#parts.store.read<{ done?: unknown; waiting?: unknown }>(BACKUP_RESTORE);
		if (typeof kept !== "object" || kept === null) return null;
		const done = Array.isArray(kept.done) ? kept.done.filter((id): id is string => typeof id === "string") : [];
		return { done: new Set(done), waiting: kept.waiting === true };
	}

	/**
	 * The restore that's due: the segments of the conversations it didn't go through yet, and the days it set aside whose
	 * day came, the newest conversation first (by its newest day), each of its days newest first. The record keeps the
	 * conversations gone through, so an app closed midway takes up from the next one. What a passing outage stops waits a
	 * day, while the rest comes in: a day whose segment failed FAILS passes in a row, or is under a key this device
	 * doesn't hold even after its inbox, and a conversation whose deleted messages didn't come FAILS passes in a row, none
	 * of whose days comes in without them. It's over once all that's left is what no core reads, or what the API no
	 * longer has.
	 */
	async #restore(generation: number): Promise<void> {
		const record = this.#restoreRecord();
		if (!record) return;
		const { done } = record;
		const setAside = () => Object.keys(this.#asideRecord()).filter((item) => item.startsWith("restore:"));
		const waits = new Set(setAside());
		// All of it was gone through, and none of what waits is due yet: nothing to list.
		if (record.waiting && waits.size && [...waits].every((item) => this.#isAside(item))) return;
		const listed = await this.#listed(generation);
		const byConversation = new Map<string, BackupSegment[]>();
		for (const segment of listed) {
			byConversation.set(segment.conversation_id, [...(byConversation.get(segment.conversation_id) ?? []), segment]);
		}
		const order = [...byConversation.values()]
			.map((days) => days.toSorted(newestFirst))
			.toSorted((a, b) => newestFirst(a[0]!, b[0]!))
			.map((days) => {
				const conversation = days[0]!.conversation_id;
				// Its deleted messages wait for their day: none of its days comes in meanwhile.
				if (this.#isAside(`restore:${conversation}`)) return { conversation, due: null };
				const due = days.filter((segment) => {
					const item = `restore:${conversation}/${segment.day}`;
					return (!done.has(conversation) || waits.has(item)) && !this.#isAside(item);
				});
				return { conversation, due };
			});
		const total = order.reduce((sum, { due }) => sum + (due?.length ?? 0), 0);
		let restored = 0;
		this.#progress(total ? { done: 0, total } : null);
		for (const { conversation, due } of order) {
			if (!due) continue;
			if (due.length) {
				const whole = `restore:${conversation}`;
				this.#item = whole;
				const deleted = await this.#deleted(generation, conversation);
				this.#item = null;
				this.#cleared(generation, whole);
				for (const segment of due) {
					const item = `restore:${conversation}/${segment.day}`;
					this.#item = item;
					const imported = await this.#import(generation, segment, deleted);
					this.#item = null;
					if (imported === "no_key") {
						this.#setAside(generation, item);
					} else {
						this.#cleared(generation, item);
						if (imported) this.#work.changed(conversation);
					}
					this.#progress({ done: ++restored, total });
				}
			}
			if (!done.has(conversation)) {
				done.add(conversation);
				this.#write(generation, BACKUP_RESTORE, { done: [...done] });
			}
		}
		// What waits of a day or a conversation the API no longer lists has nothing left to restore.
		const still = listed.flatMap(({ conversation_id: id, day }) => [`restore:${id}`, `restore:${id}/${day}`]);
		this.#forgetAside(generation, "restore:", new Set(still));
		this.#write(generation, BACKUP_RESTORE, setAside().length ? { done: [...done], waiting: true } : null);
		this.#progress(null);
	}

	/**
	 * A segment taken in: how many of its records changed something here, or `no_key` for one under a key this device
	 * doesn't hold even after its inbox. None for one the API no longer shows, or that doesn't open here, which nobody
	 * reads (the core's rule).
	 */
	async #import(generation: number, segment: BackupSegment, deleted: string[]): Promise<number | "no_key"> {
		const data = await this.#download(segment.id);
		if (!data) return 0;
		const opened = await this.#opened(generation, () =>
			this.#parts.host.handle<{ imported: number }>({ cmd: "backup_import", data, deleted }),
		);
		if (opened === "no_key") return opened;
		if (opened === "unread") return 0;
		this.#known.set(`${segment.conversation_id}/${segment.day}`, segment.id);
		return opened.value.imported;
	}

	/** A segment's bytes, in base64 as the core takes them: none for one the API no longer shows (404). */
	async #download(segmentId: string): Promise<string | null> {
		try {
			const bytes = await this.#parts.api.segment(segmentId);
			this.#answered = true;
			return bytesBase64(bytes);
		} catch (error) {
			if (statusOf(error) === 404) return null;
			throw error;
		}
	}

	/**
	 * A command that opens a segment (backup_import, backup_reencrypt), by the core's rules: one that doesn't open
	 * (`decrypt_failed`, counted for the API by its kind), or that no core reads (`too_large`, `bad_command` `data`), is
	 * `unread`; one under a key this device doesn't hold takes the inbox first, whose change of keys may bring it, then
	 * goes once more, and is `no_key` after that.
	 */
	async #opened<T>(generation: number, command: () => Promise<T>): Promise<Opened<T>> {
		for (let round = 1; ; round++) {
			this.#check(generation);
			// The core's refusal comes back as the turn's answer: one the backup expects isn't the engine's failure.
			const done = await this.#work.turn(() =>
				command().then(
					(value) => ({ value }),
					(error: unknown) => ({ error }),
				),
			);
			if ("value" in done) return done;
			const { error } = done;
			if (!(error instanceof CoreError)) throw error;
			if (error.code === "not_found" && error.what === "backup_key") {
				if (round > 1) return "no_key";
				await this.#work.inbox();
				continue;
			}
			if (error.code === "decrypt_failed") this.#failures.note("segment");
			const unread =
				error.code === "decrypt_failed" ||
				error.code === "too_large" ||
				(error.code === "bad_command" && error.field === "data");
			if (unread) return "unread";
			throw error;
		}
	}

	/** A page more of a listing, refused past MAX_PAGES: an API whose pages never end lists no real backup. */
	#nextPage(pages: number) {
		if (pages > MAX_PAGES) throw new Error(`the API's listing went past ${MAX_PAGES} pages`);
	}

	/**
	 * The conversation's deleted encrypted messages, by ID, as the API lists them: none of one the user left. Each page
	 * is asked for at the API's most, so a short one is its last whatever the API's own page is (desktop-electrobun#540).
	 */
	async #deleted(generation: number, conversationId: string): Promise<string[]> {
		const ids: string[] = [];
		for (let after: string | undefined, pages = 1; ; pages++) {
			this.#check(generation);
			this.#nextPage(pages);
			let page: string[];
			try {
				({ ids: page } = await this.#parts.api.deletedMessages(conversationId, after, PAGE));
			} catch (error) {
				const status = statusOf(error);
				if (status !== 403 && status !== 404) throw error;
				this.#answered = true;
				return ids;
			}
			this.#answered = true;
			ids.push(...page);
			if (page.length < PAGE) return ids;
			after = page.at(-1);
		}
	}

	/** Every segment of the user's backup the API shows, in its order (by ID). */
	async #listed(generation: number): Promise<BackupSegment[]> {
		const all: BackupSegment[] = [];
		for (let after = "", pages = 1; ; pages++) {
			this.#check(generation);
			this.#nextPage(pages);
			const page = await this.#parts.api.segments(after ? { after } : {});
			this.#answered = true;
			all.push(...page);
			if (page.length < PAGE) return all;
			after = page.at(-1)!.id;
		}
	}

	/** What the core holds due to go up, in its order: by conversation, then by day. */
	async #due(): Promise<DueDay[]> {
		const { host } = this.#parts;
		return (await this.#work.turn(() => host.handle<{ segments: DueDay[] }>({ cmd: "backup_due" }))).segments;
	}

	/**
	 * Each day backup_due lists goes up, in its order, with its conversation's deleted messages read once a pass; a day
	 * too large to keep is set aside, and the rest goes on. Whether nothing was due once it's done: up to date.
	 */
	async #upload(generation: number): Promise<boolean> {
		const due = await this.#due();
		const items = due.map(({ conversation_id, day }) => `day:${conversation_id}/${day}`);
		// A day no longer due is done with, wherever it went.
		this.#forgetAside(generation, "day:", new Set(items));
		if (!due.length) return true;
		this.#upToDateNow(false);
		const deleted = new Map<string, string[]>();
		for (const [i, { conversation_id: conversation, day }] of due.entries()) {
			const item = items[i]!;
			if (this.#isAside(item)) continue;
			this.#item = item;
			let ids = deleted.get(conversation);
			if (!ids) deleted.set(conversation, (ids = await this.#deleted(generation, conversation)));
			try {
				await this.#uploadDay(generation, conversation, day, ids);
			} catch (error) {
				// Any other failure ends the pass, counted against this day (#once).
				if (!tooLarge(error)) throw error;
				console.warn("[e2e] A day of the encrypted backup is too large to keep: it's tried again tomorrow.", error);
				this.#item = null;
				this.#setAside(generation, item, true);
				continue;
			}
			this.#item = null;
			this.#cleared(generation, item);
		}
		return (await this.#due()).length === 0;
	}

	/**
	 * One day up: built without what the API saw deleted, in the place of the copy this device knows of it, then
	 * confirmed with the version its build answered, after the API took it. Another copy there (409) is another device's:
	 * taken in first, and the day built again over it while it's still due; one under a key this device doesn't hold
	 * stays there, and the day waits.
	 */
	async #uploadDay(generation: number, conversation: string, day: string, deleted: string[]): Promise<void> {
		const { api, host } = this.#parts;
		const key = `${conversation}/${day}`;
		for (let round = 1; round <= ROUNDS; round++) {
			this.#check(generation);
			const built = await this.#work.turn(() =>
				host.handle<Built>({ cmd: "backup_segment", conversation_id: conversation, day, deleted }),
			);
			let stored: { id: string };
			try {
				const bytes = new Blob([base64Bytes(built.data)]);
				stored = await api.putSegment(conversation, day, bytes, this.#known.get(key) ?? null);
			} catch (error) {
				const current = holding(error);
				if (current === undefined) throw error;
				if ((await this.#takeIn(generation, conversation, current, deleted)) === "no_key") return;
				this.#known.set(key, current);
				if (!(await this.#stillDue(conversation, day))) return;
				continue;
			}
			this.#answered = true;
			this.#known.set(key, stored.id);
			await this.#work.turn(() =>
				host.handle({
					...{ cmd: "backup_uploaded", conversation_id: conversation, day },
					...{ complete: built.complete, version: built.version },
				}),
			);
			return;
		}
	}

	/**
	 * Another device's copy of a day, taken in before the day is built over it, the views told of what it brought. One
	 * that doesn't open is no one's to read, and the day's build replaces it; `no_key` for one under a key this device
	 * doesn't hold, which stays where it is.
	 */
	async #takeIn(
		generation: number,
		conversation: string,
		segmentId: string,
		deleted: string[],
	): Promise<"taken" | "no_key"> {
		const data = await this.#download(segmentId);
		// Gone meanwhile: nothing holds the day any more.
		if (!data) return "taken";
		const opened = await this.#opened(generation, () =>
			this.#parts.host.handle<{ imported: number }>({ cmd: "backup_import", data, deleted }),
		);
		if (opened === "no_key") return "no_key";
		if (typeof opened === "object" && opened.value.imported > 0) this.#work.changed(conversation);
		return "taken";
	}

	/** Whether the day is still due once another copy was taken in: the same as what this device holds isn't. */
	async #stillDue(conversation: string, day: string): Promise<boolean> {
		return (await this.#due()).some((due) => due.conversation_id === conversation && due.day === day);
	}

	/**
	 * What isn't under the key this device seals with now, moved to it: due once it seals with another key than the one
	 * it last saw itself seal with, or with its first (a new installation, which may finish a move a lost device left),
	 * and until every segment the API shows was gone past. The record keeps the last segment gone past, so the move
	 * picks up there; a segment that failed FAILS passes in a row is passed over.
	 */
	async #reencrypt(generation: number): Promise<void> {
		const { api, store } = this.#parts;
		const current = await this.#sealsWith();
		const seen = store.read<unknown>(BACKUP_KEY_SEEN);
		const kept = store.read<unknown>(BACKUP_REENCRYPT);
		let after = typeof kept === "string" ? kept : null;
		if (seen !== current) {
			after = "";
			this.#write(generation, BACKUP_KEY_SEEN, current);
			this.#write(generation, BACKUP_REENCRYPT, after);
		}
		if (after === null) return;
		const deleted = new Map<string, string[]>();
		for (let pages = 1; ; pages++) {
			this.#check(generation);
			this.#nextPage(pages);
			const page = await api.segments(after ? { after } : {});
			this.#answered = true;
			for (const segment of page) {
				const item = `move:${segment.id}`;
				if (segment.key_id !== current && !this.#isAside(item)) {
					this.#item = item;
					await this.#move(generation, segment, current, deleted);
					this.#item = null;
					this.#cleared(generation, item);
				}
				after = segment.id;
				this.#write(generation, BACKUP_REENCRYPT, after);
			}
			if (page.length < PAGE) break;
		}
		this.#write(generation, BACKUP_REENCRYPT, null);
		this.#forgetAside(generation, "move:");
	}

	/** The ID of the key the core seals with now: what a build of a day nothing's in answers, which writes nothing. */
	async #sealsWith(): Promise<string> {
		const { host } = this.#parts;
		const built = await this.#work.turn(() =>
			host.handle<Built>({ cmd: "backup_segment", conversation_id: NO_CONVERSATION, day: FIRST_DAY }),
		);
		return built.key_id;
	}

	/**
	 * A segment under an older key, sealed anew under the current one, without what the API saw deleted, in the place of
	 * the copy it was. One gone meanwhile, that doesn't open here, or whose day another copy took meanwhile (409) is left
	 * to what holds its day now; nothing is deleted but by the API's replacing it.
	 */
	async #move(generation: number, segment: BackupSegment, current: string, deleted: Map<string, string[]>) {
		const { api, host } = this.#parts;
		const { conversation_id: conversation, day, id } = segment;
		let ids = deleted.get(conversation);
		if (!ids) deleted.set(conversation, (ids = await this.#deleted(generation, conversation)));
		const data = await this.#download(id);
		if (!data) return;
		const moved = await this.#opened(generation, () =>
			host.handle<{ data: string; key_id: string }>({ cmd: "backup_reencrypt", data, deleted: ids }),
		);
		// Sealed with another key than the current one, the device's key changed under the pass: the next pass sees it.
		if (typeof moved !== "object" || moved.value.key_id !== current) return;
		let stored: { id: string };
		try {
			stored = await api.putSegment(conversation, day, new Blob([base64Bytes(moved.value.data)]), id);
		} catch (error) {
			if (holding(error) === undefined) throw error;
			return;
		}
		// The copy this device knew of the day moved: what its next upload replaces is the one it moved to.
		const key = `${conversation}/${day}`;
		if (this.#known.get(key) === id) this.#known.set(key, stored.id);
	}
}
