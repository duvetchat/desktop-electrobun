// The encrypted backup (PLAN-E2E-CLIENTES.md, Task 32; decisions 20, 21 and 44 to 46): each conversation's days as the
// core seals them, a segment a day, kept in the user's own storage. Only a ready device backs up (on the web, the tab
// that leads: Ruling 16), its core's calls in the engine's turn and its requests outside it. A pass goes in this order:
// - a restore, on a device set up as a new one (recovered or approved): every segment, the newest conversation first
//   and each day of it newest first, taken in with what the API saw deleted; one that doesn't open is skipped;
// - each day backup_due lists, with the app quiet: built without what the API saw deleted, put in the place of the copy
//   this device knows of it, and confirmed with the version its build answered. Another copy there (409) is another
//   device's: taken in first, then the day built again over it, never overwritten unseen;
// - what a change of keys left under an older key: each such segment sealed anew under the current key, in the place of
//   the copy it was, the record keeping how far the move went.
// A full storage (413), or a segment too large to keep, pauses it for a day; any other failure waits a minute, then
// twice as long each time, up to an hour. What waits is never confirmed, so it stays due.
import { FetchError, TooLargeError, UpdateRequiredError } from "$lib/api/api";
import type { BackupSegment } from "$lib/api/e2e";
import { base64Bytes } from "$lib/activity-thumbnail";
import { bytesBase64 } from "$lib/staged-images";
import { CoreError } from "../errors";
import type { EngineParts } from "./engine";
import type { Failures } from "./failures";
import { BACKUP_KEY_SEEN, BACKUP_PAUSE, BACKUP_REENCRYPT, BACKUP_RESTORE } from "./store";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The most a page of the segments or of the deleted messages has (the API's most). */
const PAGE = 1000;
/** How many times one pass builds a day again over another device's copy: past it, the day waits for the next pass. */
const ROUNDS = 3;
/** A day of no conversation: its build answers the key the core seals with, and writes nothing (sealsWith). */
const NO_CONVERSATION = "00000000-0000-0000-0000-000000000000";
const FIRST_DAY = "2026-01-01";

/** Why the backup is paused: the user's storage is full, or a day's segment is too large to keep. */
export type BackupPause = "full" | "too_large";

/** What the views show of the backup (Settings → Devices, and a restore's bar): nothing while it's up to date. */
export type BackupShown =
	| { state: "restoring"; done: number; total: number }
	| { state: "uploading" }
	| { state: "paused"; reason: BackupPause };

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

/** What a command that opens a segment gave: its answer; or that it doesn't open here, or not with a key held here. */
type Opened<T> = { value: T } | "unread" | "no_key";

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);

/** The segment that holds a day the API kept another one out of (409, `current`): undefined for any other answer. */
function holding(error: unknown): string | undefined {
	if (!(error instanceof FetchError) || error.response?.status !== 409) return undefined;
	const current: unknown = error.response.data?.current;
	return typeof current === "string" ? current : undefined;
}

/**
 * What pauses the backup: a 413, the storage full or a file too large for it (the API's words tell which), and a
 * segment past the request's 32 MiB, which never goes. Null for anything else.
 */
function pauseFor(error: unknown): BackupPause | null {
	if (error instanceof TooLargeError) return "too_large";
	if (!(error instanceof FetchError) || error.response?.status !== 413) return null;
	const said: unknown = error.response.data?.error;
	return typeof said === "string" && /too large|over 32 MiB/i.test(said) ? "too_large" : "full";
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
	#uploading = false;
	/** Passing failures in a row, the earliest the next pass may run, and the timer that runs it. */
	#fails = 0;
	#notBefore = 0;
	#retry: (() => void) | null = null;

	constructor(parts: EngineParts, failures: Failures, work: BackupWork) {
		this.#parts = parts;
		this.#failures = failures;
		this.#work = work;
	}

	/** What the views show: a restore's progress, a pause and why, or days going up; nothing when it's up to date. */
	shown(): BackupShown | null {
		if (this.#restoring) return { state: "restoring", ...this.#restoring };
		const pause = this.#pause();
		if (pause) return { state: "paused", reason: pause.reason };
		return this.#uploading ? { state: "uploading" } : null;
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
		this.#known.clear();
		this.#restoring = null;
		this.#uploading = false;
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
		try {
			await this.#restore(generation);
			if (restoreOnly || this.#waitsForDay()) return;
			await this.#upload(generation);
			await this.#reencrypt(generation);
			this.#fails = 0;
			if (this.#pause()) {
				this.#write(generation, BACKUP_PAUSE, null);
				this.#work.shown();
			}
		} catch (error) {
			if (!this.#live(generation) || (error instanceof CoreError && error.code === "not_ready")) return;
			const reason = pauseFor(error);
			if (reason) return this.#pauseFor(generation, reason);
			if (error instanceof UpdateRequiredError) return this.#work.update(error);
			console.warn("[e2e] The encrypted backup tries again later:", error);
			// A key this device's core still seals with that the API retired: the change of keys' transfer may wait in
			// the inbox, after which the core builds those days again under the new key.
			if (refusedKey(error)) {
				await this.#work.inbox().catch((failed: unknown) => console.warn("[e2e] The inbox waits:", failed));
			}
			this.#later(Math.min(HOUR, MINUTE * 2 ** this.#fails++));
		} finally {
			this.#uploadingNow(false);
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

	/** The pause the record holds, if any: since when, and why. */
	#pause(): { at: number; reason: BackupPause } | null {
		const kept = this.#parts.store.read<{ at?: unknown; reason?: unknown }>(BACKUP_PAUSE);
		const reason = kept?.reason;
		return typeof kept?.at === "number" && (reason === "full" || reason === "too_large")
			? { at: kept.at, reason }
			: null;
	}

	/** The backup pauses for a day (decision 45's full quota), and says why: what waits stays due. */
	#pauseFor(generation: number, reason: BackupPause) {
		this.#write(generation, BACKUP_PAUSE, { at: this.#parts.clock.now(), reason });
		this.#work.shown();
		this.#later(DAY);
	}

	/** Paused less than a day ago: nothing goes up before the day is over, when the pass tries again by itself. */
	#waitsForDay(): boolean {
		const pause = this.#pause();
		const left = pause ? pause.at + DAY - this.#parts.clock.now() : 0;
		if (left <= 0) return false;
		// After a restart, the timer the pause set went with the app.
		if (!this.#retry) this.#later(left);
		return true;
	}

	#uploadingNow(uploading: boolean) {
		if (this.#uploading === uploading) return;
		this.#uploading = uploading;
		this.#work.shown();
	}

	#progress(next: { done: number; total: number } | null) {
		const changed = step(next) !== step(this.#restoring);
		this.#restoring = next;
		if (changed) this.#work.shown();
	}

	/** The record of a restore that's due: the conversations it's done with. Null when none is due. */
	#restoreRecord(): Set<string> | null {
		const kept = this.#parts.store.read<{ done?: unknown }>(BACKUP_RESTORE);
		if (typeof kept !== "object" || kept === null) return null;
		const done = Array.isArray(kept.done) ? kept.done.filter((id): id is string => typeof id === "string") : [];
		return new Set(done);
	}

	/**
	 * The restore that's due: the segments of the conversations it isn't done with, the newest conversation first (by
	 * its newest day), each of its days newest first. The record keeps the conversations done, so an app closed midway
	 * takes up from the next one.
	 */
	async #restore(generation: number): Promise<void> {
		const done = this.#restoreRecord();
		if (!done) return;
		const segments = (await this.#listed(generation)).filter((segment) => !done.has(segment.conversation_id));
		const byConversation = new Map<string, BackupSegment[]>();
		for (const segment of segments) {
			byConversation.set(segment.conversation_id, [...(byConversation.get(segment.conversation_id) ?? []), segment]);
		}
		const order = [...byConversation.values()]
			.map((days) => days.toSorted(newestFirst))
			.toSorted((a, b) => newestFirst(a[0]!, b[0]!));
		const total = segments.length;
		let restored = 0;
		this.#progress(total ? { done: 0, total } : null);
		for (const days of order) {
			const conversation = days[0]!.conversation_id;
			const deleted = await this.#deleted(generation, conversation);
			for (const segment of days) {
				if (await this.#import(generation, segment, deleted)) this.#work.changed(conversation);
				this.#progress({ done: ++restored, total });
			}
			done.add(conversation);
			this.#write(generation, BACKUP_RESTORE, { done: [...done] });
		}
		this.#write(generation, BACKUP_RESTORE, null);
		this.#progress(null);
	}

	/**
	 * A segment taken in: how many of its records changed something here. None for one the API no longer shows, or that
	 * doesn't open here, which nobody reads (the core's rule), or not with any key this device holds after its inbox.
	 */
	async #import(generation: number, segment: BackupSegment, deleted: string[]): Promise<number> {
		const data = await this.#download(segment.id);
		if (!data) return 0;
		const opened = await this.#opened(generation, () =>
			this.#parts.host.handle<{ imported: number }>({ cmd: "backup_import", data, deleted }),
		);
		if (typeof opened !== "object") return 0;
		this.#known.set(`${segment.conversation_id}/${segment.day}`, segment.id);
		return opened.value.imported;
	}

	/** A segment's bytes, in base64 as the core takes them: none for one the API no longer shows (404). */
	async #download(segmentId: string): Promise<string | null> {
		try {
			return bytesBase64(await this.#parts.api.segment(segmentId));
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

	/** The conversation's deleted encrypted messages, by ID, as the API lists them: none of one the user left. */
	async #deleted(generation: number, conversationId: string): Promise<string[]> {
		const ids: string[] = [];
		for (let after: string | undefined; ; ) {
			this.#check(generation);
			let page: string[];
			try {
				({ ids: page } = await this.#parts.api.deletedMessages(conversationId, after));
			} catch (error) {
				const status = statusOf(error);
				if (status === 403 || status === 404) return ids;
				throw error;
			}
			ids.push(...page);
			if (page.length < PAGE) return ids;
			after = page.at(-1);
		}
	}

	/** Every segment of the user's backup the API shows, in its order (by ID). */
	async #listed(generation: number): Promise<BackupSegment[]> {
		const all: BackupSegment[] = [];
		for (let after = ""; ; ) {
			this.#check(generation);
			const page = await this.#parts.api.segments(after ? { after } : {});
			all.push(...page);
			if (page.length < PAGE) return all;
			after = page.at(-1)!.id;
		}
	}

	/** Each day backup_due lists goes up, in its order, with its conversation's deleted messages read once a pass. */
	async #upload(generation: number): Promise<void> {
		const { host } = this.#parts;
		const { segments: due } = await this.#work.turn(() => host.handle<{ segments: DueDay[] }>({ cmd: "backup_due" }));
		if (!due.length) return;
		this.#uploadingNow(true);
		const deleted = new Map<string, string[]>();
		for (const { conversation_id: conversation, day } of due) {
			let ids = deleted.get(conversation);
			if (!ids) deleted.set(conversation, (ids = await this.#deleted(generation, conversation)));
			await this.#uploadDay(generation, conversation, day, ids);
		}
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
				if ((await this.#takeIn(generation, current, deleted)) === "no_key") return;
				this.#known.set(key, current);
				if (!(await this.#stillDue(conversation, day))) return;
				continue;
			}
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
	 * Another device's copy of a day, taken in before the day is built over it. One that doesn't open is no one's to read,
	 * and the day's build replaces it; `no_key` for one under a key this device doesn't hold, which stays where it is.
	 */
	async #takeIn(generation: number, segmentId: string, deleted: string[]): Promise<"taken" | "no_key"> {
		const data = await this.#download(segmentId);
		// Gone meanwhile: nothing holds the day any more.
		if (!data) return "taken";
		const opened = await this.#opened(generation, () =>
			this.#parts.host.handle({ cmd: "backup_import", data, deleted }),
		);
		return opened === "no_key" ? "no_key" : "taken";
	}

	/** Whether the day is still due once another copy was taken in: the same as what this device holds isn't. */
	async #stillDue(conversation: string, day: string): Promise<boolean> {
		const { host } = this.#parts;
		const { segments } = await this.#work.turn(() => host.handle<{ segments: DueDay[] }>({ cmd: "backup_due" }));
		return segments.some((due) => due.conversation_id === conversation && due.day === day);
	}

	/**
	 * What a change of keys left under an older key, moved to the current one: due once this device seals with another
	 * key than the one it last saw itself seal with, and until every segment the API shows was gone past. The record
	 * keeps the last segment gone past, so the move picks up there; a device seen for the first time has nothing of its
	 * own to move.
	 */
	async #reencrypt(generation: number): Promise<void> {
		const { api, store } = this.#parts;
		const current = await this.#sealsWith();
		const seen = store.read<unknown>(BACKUP_KEY_SEEN);
		const kept = store.read<unknown>(BACKUP_REENCRYPT);
		let after = typeof kept === "string" ? kept : null;
		if (seen !== current) {
			if (typeof seen === "string") after = "";
			this.#write(generation, BACKUP_KEY_SEEN, current);
			if (after !== null) this.#write(generation, BACKUP_REENCRYPT, after);
		}
		if (after === null) return;
		const deleted = new Map<string, string[]>();
		for (;;) {
			this.#check(generation);
			const page = await api.segments(after ? { after } : {});
			for (const segment of page) {
				if (segment.key_id !== current) await this.#move(generation, segment, current, deleted);
				after = segment.id;
				this.#write(generation, BACKUP_REENCRYPT, after);
			}
			if (page.length < PAGE) break;
		}
		this.#write(generation, BACKUP_REENCRYPT, null);
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
		this.#uploadingNow(true);
		const moved = await this.#opened(generation, () =>
			host.handle<{ data: string; key_id: string }>({ cmd: "backup_reencrypt", data, deleted: ids }),
		);
		// Sealed with another key than the current one, the device's key changed under the pass: the next pass sees it.
		if (typeof moved !== "object" || moved.value.key_id !== current) return;
		try {
			await api.putSegment(conversation, day, new Blob([base64Bytes(moved.value.data)]), id);
		} catch (error) {
			if (holding(error) === undefined) throw error;
		}
	}
}
