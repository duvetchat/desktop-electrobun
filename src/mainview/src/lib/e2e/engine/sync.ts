// A conversation's queue and group (PLAN-E2E-CLIENTES.md, «La cola de una conversación», «Entrar a un grupo», «Un commit
// sin respuesta», «Lo periódico»). What the API numbers in each conversation goes to the core by its number, from the
// gateway's events and from the queue: a repeat is skipped, and a gap or an entry without its data reads the queue from
// where the core is, 50 entries an apply. A device out of the group comes in by its welcome (from where the core is, or
// from its leaf's number, `joined_seq`) or an external commit, and makes the group where it may (again, where its own
// creation never reached the API); its commits go through commits.ts, their bytes kept until an answer comes. A
// conversation gone, or its user out of it, is let go. The engine runs this work in its turn, one conversation at a
// time: this class keeps what's between turns, the entries heard, the commits whose requests go on, and what each
// conversation says to the person.
import { FetchError } from "$lib/api/api";
import type { Conversation, DirectMessage } from "$lib/api/conversations";
import type { Commit, QueuePage } from "$lib/api/e2e";
import type { MlsEntry, MlsEventEntry } from "$lib/types";
import { CoreError } from "../errors";
import type { EngineEvent } from "../events";
import { sendCommit, type Sent } from "./commits";
import type { EngineParts } from "./engine";
import { failedKinds, type EntryResult, type Failures } from "./failures";
import { joinGroup, makeGroup, mayMake, mayRestart, restartGroup } from "./groups";
import { observeUsers, withIdentities } from "./identity";
import { dropRecord, legacyRecord } from "./legacy";

/**
 * What a conversation says over its message box of its group (PLAN-E2E-CLIENTES.md, «Avisos»): blocked, with who may
 * restart it (this user, its owner, or nobody, for a group under an external sender other than the pinned one); waiting
 * for its owner to make it; waiting for another member to let this device back in; or members other than its record's.
 */
export type ConversationState =
	| { name: "blocked"; restart: "mine" | "owner" | "none"; owner: string | null }
	| { name: "wait_owner"; owner: string }
	| { name: "wait_rejoin" }
	| { name: "members_changed" };

/** What apply answers. */
interface Applied {
	applied_through: number | null;
	results: EntryResult[];
	commit_due: boolean;
}

/** Where the core is after applying: the entry it has through (null out of the group), the first one missing (a gap's),
 * and whether a commit of its own is due. */
interface Where {
	through: number | null;
	gap: number | null;
	due: boolean;
}

/** What a commit of this device's is for: it says what follows its answer. */
type Purpose = "make" | "restart" | "join" | "renew" | "renew_again" | "due";

/** A commit whose request goes on: its bytes, sent again as they are until an answer comes. */
interface InFlight {
	purpose: Purpose;
	commit: Commit;
	tries: number;
	cancel: (() => void) | null;
}

/** The group as the core holds it (its `group`). */
interface Held {
	generation: number;
	epoch: number;
	blocked: boolean;
}

/** Entries an apply takes at most. */
const APPLY_MOST = 50;
/** A due commit waits a random while, up to this long, so the members it's due on don't all make it at once. */
const DUE_WAIT_MS = 5_000;
/** A commit whose bytes went with the app is said to be refused only with the queue read whole this long after the
 * start (Ruling 25): before, the API may still be taking it. */
const SETTLE_MS = 60_000;
/** What failed goes again after 2 s, then twice as long each time, up to a minute apart. */
const RETRY_MS = 2_000;
const RETRY_MOST_MS = 60_000;
/** External commits that lost their epoch in a row before this device waits for the conversation's next event. */
const JOINS_LOST_MOST = 3;
/** Rules a join refuses for whatever the device observes: the record, the external sender, a blocked group, a group
 * info behind what this device saw. Any other is observed for, then tried once more. */
const FINAL_RULES = new Set(["member_list_mismatch", "external_sender_mismatch", "group_blocked", "stale_group_info"]);

/** The entries that are a conversation's messages, and what an apply did to one that changes what it shows. */
const MESSAGE_KINDS = new Set(["message", "edit", "delete"]);
const CHANGES = new Set(["applied", "own", "undecryptable"]);
/** A member's commits, which the core keeps staged when the API doesn't take them: the queue settles them. */
const MEMBER_COMMITS = new Set<string>(["renew", "renew_again", "due"]);

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);
const hasData = (entry: MlsEventEntry): entry is MlsEntry => typeof entry.data === "string";
const same = (a: ConversationState | null, b: ConversationState | null) => JSON.stringify(a) === JSON.stringify(b);

/** A message as its queue's entry: its ciphertext the data, its ID the message's, its author and device the sender's. */
function messageEntry(message: DirectMessage): [string, MlsEventEntry] | null {
	const { conversation_id, seq, generation, epoch } = message;
	if (!conversation_id || seq === undefined || generation === undefined || epoch === undefined) return null;
	const reply = message.referenced_message?.message_id;
	return [
		conversation_id,
		{
			...{ seq, kind: "message", data: message.ciphertext ?? null, sent_at: message.sent_at ?? 0, generation, epoch },
			...{ message_id: message.id, sender_user: message.author_id, sender_device: message.sender_device_id },
			...(message.mentions?.length ? { mentions: message.mentions } : {}),
			...(reply ? { reply_to: reply } : {}),
		},
	];
}

/** The entry an event carries, with its conversation and, of a group's own events, its generation: none from what has
 * none (a notice's message, its deletion). */
function entryOf(event: EngineEvent): { id: string; entry: MlsEventEntry; generation?: number } | null {
	switch (event.type) {
		case "MLS_COMMIT":
		case "MLS_WELCOME":
		case "MLS_PROPOSAL":
			return { id: event.data.conversation_id, entry: event.data.entry, generation: event.data.generation };
		case "DM_MESSAGE_UPDATE":
			return { id: event.data.conversation_id, entry: event.data.entry };
		case "DM_MESSAGE_DELETE":
			return event.data.entry ? { id: event.data.conversation_id, entry: event.data.entry } : null;
		case "DM_MESSAGE_CREATE": {
			const made = messageEntry(event.data);
			return made && { id: made[0], entry: made[1] };
		}
		default:
			return null;
	}
}

export class Conversations {
	readonly #parts: EngineParts;
	/** Runs work in the engine's turn, while the device is ready. */
	readonly #soon: (work: () => Promise<void>) => void;
	readonly #failures: Failures;
	readonly #changed: (conversationId: string, state: ConversationState | null) => void;
	/**
	 * A conversation's messages changed on this device (an apply opened, kept or took these), or how far its queue is
	 * applied moved: the views read them again, and draw a row past that number as loading.
	 */
	readonly #messagesChanged: (conversationId: string, ids: string[], through: number | null) => void;
	/** How far each conversation's queue is applied on this device, as its last apply said (null: out of its group). */
	readonly #through = new Map<string, number | null>();
	/** The API's external sender, as this device pinned it (Ruling 32). */
	#sender = "";
	/** The API's conversations as last listed, their groups as the events and the queue have told of them since. */
	readonly #known = new Map<string, Conversation>();
	/** Entries heard by events, by conversation and number, until the conversation's turn. */
	readonly #heard = new Map<string, Map<number, MlsEventEntry>>();
	readonly #states = new Map<string, ConversationState>();
	readonly #inFlight = new Map<string, InFlight>();
	/** Commits whose bytes went with the app: the queue settles them, or they're said to be refused (Ruling 25). */
	readonly #settling = new Set<string>();
	/** Due commits' waits, by conversation. */
	readonly #due = new Map<string, () => void>();
	/** Failed turns' retries, by conversation. */
	readonly #retries = new Map<string, { tries: number; cancel: () => void }>();
	/**
	 * External commits that lost their epoch in a row, by conversation, counted until this device is in its group: the
	 * welcome its leaf began with is stale by then, so the queue isn't read from there.
	 */
	readonly #joinsLost = new Map<string, number>();
	/** Groups a commit took this device out of (`removed`): whether its user is still in the conversation, a list says. */
	readonly #removed = new Set<string>();
	/** Groups under an external sender other than the pinned one: this device never goes in (Ruling 32). */
	readonly #otherSender = new Set<string>();
	/** Groups whose members aren't their record's, until the person says yes (`accept`). */
	readonly #recordRefused = new Set<string>();
	/** A minute has passed since the start (SETTLE_MS). */
	#settled = false;
	#settleTimer: (() => void) | null = null;

	constructor(
		parts: EngineParts,
		soon: (work: () => Promise<void>) => void,
		failures: Failures,
		changed: (conversationId: string, state: ConversationState | null) => void,
		messagesChanged: (conversationId: string, ids: string[], through: number | null) => void,
	) {
		this.#parts = parts;
		this.#soon = soon;
		this.#failures = failures;
		this.#changed = changed;
		this.#messagesChanged = messagesChanged;
	}

	/** Begins with the pinned external sender: the minute a commit whose bytes were lost waits for starts now. */
	start(externalSender: string) {
		this.#sender = externalSender;
		this.#settleTimer ??= this.#parts.clock.later(SETTLE_MS, () => {
			this.#settled = true;
			for (const id of this.#settling) this.#soon(() => this.sync(id));
		});
	}

	/** Stops waiting for anything: what's in memory goes, the bytes of a commit whose answer didn't come too. */
	stop() {
		this.#settleTimer?.();
		for (const cancel of this.#due.values()) cancel();
		for (const { cancel } of this.#retries.values()) cancel();
		for (const { cancel } of this.#inFlight.values()) cancel?.();
		for (const kept of [this.#due, this.#retries, this.#inFlight]) kept.clear();
	}

	/** Everything this device knew of its conversations goes, their states said to be none: it starts over. */
	forget() {
		this.stop();
		this.#settleTimer = null;
		this.#settled = false;
		for (const id of [...this.#states.keys()]) this.#set(id, null);
		for (const kept of [this.#known, this.#heard, this.#joinsLost, this.#through]) kept.clear();
		for (const kept of [this.#settling, this.#removed, this.#otherSender, this.#recordRefused]) kept.clear();
	}

	state(conversationId: string): ConversationState | null {
		return this.#states.get(conversationId) ?? null;
	}

	/** An event of a conversation's: its entry kept by its number, and the conversation's turn asked for. */
	heard(event: EngineEvent) {
		const carried = entryOf(event);
		if (!carried) return;
		this.#hear(carried.id, carried.entry, carried.generation);
		this.#soon(() => this.sync(carried.id));
	}

	/** Entries an answer gave (an edit's, a deletion's): applied now, in this turn, as heard ones are. */
	async take(conversationId: string, entries: MlsEntry[]): Promise<void> {
		for (const entry of entries) this.#hear(conversationId, entry);
		await this.sync(conversationId);
	}

	/** An entry kept by its number until the conversation's turn, and the queue's end it says. */
	#hear(id: string, entry: MlsEventEntry, generation?: number) {
		let kept = this.#heard.get(id);
		if (!kept) this.#heard.set(id, (kept = new Map()));
		kept.set(entry.seq, entry);
		const known = this.#known.get(id)?.mls;
		if (known) {
			known.last_seq = Math.max(known.last_seq, entry.seq);
			known.generation = Math.max(known.generation, generation ?? 0);
		}
	}

	/**
	 * Before this device sends there (PLAN-E2E-CLIENTES.md, «Enviar»): the conversation's group as it is now, its queue
	 * applied, joined or made where it has none. Without it, or blocked, nothing can be sent: the conversation says why.
	 */
	async current(conversationId: string): Promise<void> {
		await this.open(conversationId);
		const held = await this.#group(conversationId);
		if (!held || held.blocked) throw new Error("this device can't send in this conversation now");
	}

	/** The proposals and leaves off their lists that keep this device from sending (encrypt's pending_proposals), committed. */
	async commitDue(conversationId: string): Promise<void> {
		const conv = this.#known.get(conversationId) ?? (await this.#fresh(conversationId));
		if (conv && !this.#inFlight.has(conversationId)) await this.#own(conv, "commit_pending", "due");
	}

	/**
	 * At the start and at each READY: the API's conversations, each one's record made the first time it's seen, the queue
	 * of each with a group, those without one as #groupless says, and the commits whose requests had no answer sent again.
	 */
	async all(): Promise<void> {
		await this.#list();
		for (const conv of [...this.#known.values()]) {
			legacyRecord(this.#parts.store, conv);
			try {
				if (conv.mls) await this.sync(conv.id);
				else await this.#groupless(conv);
			} catch (error) {
				console.error("[e2e] A conversation's group waits for its next turn:", error);
			}
		}
		for (const id of [...this.#inFlight.keys()]) {
			await this.#resend(id).catch((error: unknown) => {
				console.error("[e2e] A commit waits for its answer again:", error);
			});
		}
	}

	/**
	 * The person opened the conversation (PLAN-E2E-CLIENTES.md, «Entrar a un grupo»): without a group, this user makes it
	 * where they may (any member before the cutover, either member of a DM, a group's owner); the others wait for its
	 * owner. With one, its turn.
	 */
	async open(conversationId: string): Promise<void> {
		let conv = this.#known.get(conversationId) ?? null;
		if (!conv?.mls) conv = await this.#fresh(conversationId);
		if (!conv) return;
		if (conv.mls) return this.sync(conv.id);
		if (!mayMake(conv, this.#parts.user)) return this.#set(conv.id, this.#waiting(conv));
		if (!this.#inFlight.has(conv.id)) await this.#make(conv);
	}

	/** The person's restart of the conversation's blocked group, which only its owner (in a DM, either member) makes. */
	async restart(conversationId: string): Promise<void> {
		const conv = this.#known.get(conversationId);
		const state = this.#states.get(conversationId);
		if (!conv || state?.name !== "blocked" || state.restart !== "mine" || this.#inFlight.has(conversationId)) return;
		await this.#commit(conv, "restart", await restartGroup(this.#parts, conv));
	}

	/** The person's yes to the members of today: the record goes, and this device joins with none to hold it to. */
	async accept(conversationId: string): Promise<void> {
		const conv = this.#known.get(conversationId);
		if (!conv || !this.#recordRefused.has(conversationId)) return;
		dropRecord(this.#parts.store, conversationId);
		this.#recordRefused.delete(conversationId);
		this.#set(conversationId, null);
		// No group yet (this device's was refused for its members): it's made now, with the members of today.
		if (!conv.mls) return this.open(conversationId);
		await this.#join(conv);
	}

	/**
	 * The leaf renewals due (refresh_due, «Lo periódico»): a commit in each conversation it names. One that fails waits
	 * for the next day's; the others go now.
	 */
	async renew(): Promise<void> {
		const { conversations } = await this.#parts.host.handle<{ conversations: string[] }>({ cmd: "refresh_due" });
		for (const id of conversations) {
			try {
				const conv = this.#known.get(id) ?? (await this.#fresh(id));
				if (conv && !this.#inFlight.has(id)) await this.#own(conv, "refresh", "renew");
			} catch (error) {
				console.error("[e2e] A leaf renewal waits for the next day's:", error);
			}
		}
	}

	/**
	 * The conversation's turn (`read`: its queue read even when the core seems to have it all, as after another commit
	 * took an epoch). A turn that fails goes again later, as the conversation's next event would also ask; but one the
	 * API refused as the conversation is gone, or its user out of it, ends there (#gone).
	 */
	async sync(conversationId: string, read = false): Promise<void> {
		const conv = this.#known.get(conversationId) ?? (await this.#fresh(conversationId));
		if (!conv) return this.#drop(conversationId);
		try {
			await this.#sync(conv, read);
		} catch (error) {
			if (await this.#gone(conv.id, error)) return;
			this.#retryLater(conv.id);
			throw error;
		}
		this.#retries.get(conv.id)?.cancel();
		this.#retries.delete(conv.id);
	}

	/**
	 * How far the conversation's queue is applied on this device: none (undefined) before this session's first apply,
	 * null while this device is out of its group.
	 */
	through(conversationId: string): number | null | undefined {
		return this.#through.get(conversationId);
	}

	/**
	 * A commit of this device's waits for its word in the conversation (encrypt's `pending_commit`), settled now as «Un
	 * commit sin respuesta» says: its bytes go again, or, gone with the app, the queue is read, which settles it.
	 */
	async settle(conversationId: string): Promise<void> {
		if (this.#inFlight.has(conversationId)) await this.#resend(conversationId);
		else await this.sync(conversationId, true);
	}

	#retryLater(id: string) {
		const retry = this.#retries.get(id) ?? { tries: 0, cancel: () => {} };
		retry.cancel();
		const ms = Math.min(RETRY_MOST_MS, RETRY_MS * 2 ** retry.tries++);
		retry.cancel = this.#parts.clock.later(ms, () => this.#soon(() => this.sync(id)));
		this.#retries.set(id, retry);
	}

	/** A conversation without a group: nothing for whoever may make it, else waiting for its owner. */
	#waiting(conv: Conversation): ConversationState | null {
		return mayMake(conv, this.#parts.user) ? null : { name: "wait_owner", owner: conv.owner_id };
	}

	/**
	 * A conversation the API lists without a group: it waits for whoever makes it, unless this device's core holds a
	 * creation of its own that never reached the API, whose request went with the app, which is made again (#make).
	 */
	async #groupless(conv: Conversation) {
		this.#set(conv.id, this.#waiting(conv));
		if (!mayMake(conv, this.#parts.user) || this.#inFlight.has(conv.id)) return;
		if (await this.#group(conv.id)) await this.#make(conv);
	}

	/**
	 * Makes the group of a conversation the API lists without one, with every member's key packages. A creation of this
	 * device's that the core still holds never reached the API (its request cut, then the app closed): the core is told
	 * no answer came, which drops a creation whole, before anything is claimed, and the group is made again. Were the old
	 * request to land after all, this creation loses its 409, and the device joins by external commit.
	 */
	async #make(conv: Conversation) {
		if (await this.#group(conv.id)) {
			await this.#parts.host.handle({ cmd: "commit_result", conversation_id: conv.id, accepted: false });
		}
		let commit: Commit;
		try {
			commit = await makeGroup(this.#parts, conv, this.#sender, legacyRecord(this.#parts.store, conv));
		} catch (error) {
			// Members other than the record's: the person says whether to go on.
			if (error instanceof CoreError && error.rule === "member_list_mismatch") return this.#refusedRecord(conv);
			throw error;
		}
		await this.#commit(conv, "make", commit);
	}

	/**
	 * The entries heard, in order; the queue when they don't follow on what the core has (a gap, an entry without its
	 * data, a number the API gave past them), when a commit of its own waits for the queue's word, or when asked; then
	 * what the group is now. A conversation known without a group is listed again: an event says it has one now.
	 */
	async #sync(given: Conversation, read: boolean) {
		const conv = given.mls ? given : await this.#fresh(given.id);
		if (!conv) return this.#drop(given.id);
		const { id, mls } = conv;
		if (!mls) return this.#set(id, this.#waiting(conv));
		// A commit of this device's waits for its answer: what's heard waits for it too.
		if (this.#inFlight.has(id)) return;
		const heard = [...(this.#heard.get(id)?.values() ?? [])].sort((a, b) => a.seq - b.seq);
		this.#heard.delete(id);
		let at = await this.#applyAll(conv, heard.filter(hasData));
		const from = at.gap !== null ? at.gap - 1 : at.through;
		const behind =
			read ||
			at.gap !== null ||
			heard.some((entry) => !hasData(entry)) ||
			this.#settling.has(id) ||
			mls.last_seq > (at.through ?? 0);
		// Out of the group (no number to read from), #after reads its welcome or joins.
		const whole = behind && from !== null;
		if (whole) {
			const done = await this.#readQueue(conv, from);
			// The queue doesn't go back that far (410): this device joins again, its database as it is (13).
			if (done === "expired") return this.#join(conv);
			at = done;
			await this.#settle(id);
		}
		await this.#after(conv, at, whole);
	}

	/** Applies entries in order, 50 an apply (once with none, which says where the core is). */
	async #applyAll(conv: Conversation, entries: MlsEntry[]): Promise<Where> {
		let at: Where = { through: null, gap: null, due: false };
		let told = false;
		for (let start = 0; ; ) {
			const chunk = entries.slice(start, start + APPLY_MOST);
			let applied: Applied;
			try {
				applied = await this.#apply(conv, chunk);
			} catch (error) {
				if (!(error instanceof CoreError)) throw error;
				if (error.code === "gap") return { ...at, gap: error.from ?? null };
				if (error.code !== "pending_commit" || told) throw error;
				// A commit of this device's whose bytes went with the app (none is in flight here): the core is told no
				// answer came, and the queue settles it. Unless the core dropped it with its group (a creation, an external
				// commit, a reset), it stays staged until then, or until it's said to be refused.
				const { epoch } = await this.#parts.host.handle<{ epoch: number | null }>({
					...{ cmd: "commit_result", conversation_id: conv.id, accepted: false },
				});
				if (epoch !== null) this.#settling.add(conv.id);
				told = true;
				continue;
			}
			at = { through: applied.applied_through, gap: null, due: applied.commit_due };
			start += APPLY_MOST;
			if (start >= entries.length) return at;
		}
	}

	/**
	 * One apply, the users it asks for observed first, the welcomes of a conversation from before the cutover held to its
	 * record (their `expected`, which the API never gives); what its results say is noted.
	 */
	async #apply(conv: Conversation, entries: MlsEntry[]): Promise<Applied> {
		const record = legacyRecord(this.#parts.store, conv);
		const given = record
			? entries.map((entry) => (entry.kind === "welcome" ? { ...entry, expected: record } : entry))
			: entries;
		const applied = await withIdentities(this.#parts, () =>
			this.#parts.host.handle<Applied>({
				...{ cmd: "apply", conversation_id: conv.id, entries: given, external_sender: this.#sender },
			}),
		);
		const deleted = new Set(entries.filter((entry) => entry.deleted).map((entry) => entry.seq));
		for (const kind of failedKinds(applied.results, deleted)) this.#failures.note(kind);
		const message = ({ kind, result }: EntryResult) => MESSAGE_KINDS.has(kind) && CHANGES.has(result);
		const ids = new Map(entries.map((entry) => [entry.seq, entry.message_id]));
		const touched = applied.results.filter(message).flatMap(({ seq }) => ids.get(seq) ?? []);
		const moved = this.#through.get(conv.id) !== applied.applied_through;
		this.#through.set(conv.id, applied.applied_through);
		if (touched.length || moved) this.#messagesChanged(conv.id, touched, applied.applied_through);
		for (const { kind, result, rule } of applied.results) {
			const refused = kind === "welcome" && result === "rejected";
			if (refused && rule === "external_sender_mismatch") this.#otherSender.add(conv.id);
			if (refused && rule === "member_list_mismatch" && legacyRecord(this.#parts.store, conv)) {
				this.#recordRefused.add(conv.id);
			}
			// A commit of its epoch, its own or another's: a commit of this device's whose bytes went is settled.
			if (kind === "commit" && result !== "ignored") this.#settling.delete(conv.id);
			if (result === "removed") this.#removed.add(conv.id);
		}
		return applied;
	}

	/** The queue after `after`, to its end, each page applied as it comes: where the core then is. */
	async #readQueue(conv: Conversation, after: number): Promise<Where | "expired"> {
		for (let from = after; ; ) {
			let page: QueuePage;
			try {
				page = await this.#parts.api.queue(conv.id, from);
			} catch (error) {
				if (statusOf(error) === 410) return "expired";
				throw error;
			}
			if (conv.mls) {
				const { generation, epoch, last_seq, floor_seq } = page;
				Object.assign(conv.mls, { generation, epoch, last_seq, floor_seq });
			}
			const at = await this.#applyAll(conv, page.entries);
			if (at.gap !== null) {
				// The core needs what comes before this page: from there, as long as that's before where this read began.
				if (at.gap - 1 >= from) throw new Error(`the queue of ${conv.id} skips entry ${at.gap}`);
				from = at.gap - 1;
				continue;
			}
			const last = page.entries.at(-1)?.seq;
			if (last === undefined || last >= page.last_seq) return at;
			from = last;
		}
	}

	/**
	 * A commit of this device's whose bytes went with the app (Ruling 25): with the queue read whole and a minute past the
	 * start, the API doesn't have it, and the core is told it was refused, so it's dropped. Never before, nor with the
	 * queue behind (Review Focus 11).
	 */
	async #settle(id: string) {
		if (!this.#settling.has(id) || !this.#settled) return;
		await this.#parts.host
			.handle({ cmd: "commit_result", conversation_id: id, accepted: false, invalid: true })
			.catch((error: unknown) => {
				// Nothing left to drop: the queue settled it after all.
				if (!(error instanceof CoreError && error.code === "not_found")) throw error;
			});
		// Only once the core took it: a call that failed says it again at the conversation's next turn.
		this.#settling.delete(id);
	}

	/** The group as the core holds it, or null without one. */
	async #group(id: string): Promise<Held | null> {
		try {
			return await this.#parts.host.handle<Held>({ cmd: "group", conversation_id: id });
		} catch (error) {
			if (error instanceof CoreError && error.code === "not_found") return null;
			throw error;
		}
	}

	/**
	 * What the group is once the entries are in (`read`: the queue was read to its end in this turn). In the API's group
	 * (its generation): blocked, or going on, with a due commit made after a random wait. Out of it, after a removal, a
	 * new list says whether its user is still in the conversation, and one that isn't is let go. With the user a member:
	 * its welcome read from the queue, where it follows the commit that made it (a restart's, an addition's), from where
	 * the core is, or, for a core that never counted the queue, from where its leaf began; but not after an external
	 * commit of its lost, by when that welcome is stale. Else an external commit.
	 */
	async #after(given: Conversation, at: Where, read: boolean): Promise<void> {
		let conv = given;
		const held = await this.#group(conv.id);
		if (held && held.generation >= (conv.mls?.generation ?? 0)) {
			for (const kept of [this.#otherSender, this.#recordRefused, this.#removed]) kept.delete(conv.id);
			this.#joinsLost.delete(conv.id);
			this.#set(conv.id, held.blocked ? this.#blocked(conv) : null);
			if (at.due && !held.blocked) this.#dueLater(conv.id);
			return;
		}
		if (this.#removed.has(conv.id)) {
			const listed = await this.#fresh(conv.id);
			this.#removed.delete(conv.id);
			if (!listed) return this.#drop(conv.id);
			conv = listed;
		}
		const { id, mls } = conv;
		if (!mls || !conv.members.some((member) => member.user_id === this.#parts.user)) return;
		const refused = this.#otherSender.has(id) || this.#recordRefused.has(id);
		const leaf = this.#joinsLost.has(id) || mls.joined_seq === null ? null : mls.joined_seq - 1;
		const from = read || refused ? null : (at.through ?? leaf);
		if (from !== null) {
			const done = await this.#readQueue(conv, from);
			const now = done === "expired" ? null : await this.#group(id);
			if (done !== "expired" && now && now.generation >= mls.generation) return this.#after(conv, done, true);
		}
		await this.#join(conv);
	}

	#blocked(conv: Conversation): ConversationState {
		const restart = this.#otherSender.has(conv.id) ? "none" : mayRestart(conv, this.#parts.user) ? "mine" : "owner";
		return { name: "blocked", restart, owner: conv.type === 2 ? conv.owner_id : null };
	}

	#refusedRecord(conv: Conversation) {
		this.#recordRefused.add(conv.id);
		this.#set(conv.id, { name: "members_changed" });
	}

	/**
	 * This device into the group by an external commit. The core asks no identities for it: refused for a rule, the
	 * members are observed and it's tried once more. Still refused, the conversation says why: members other than its
	 * record's, another external sender, a blocked group; or else this device waits for another member's commit (after
	 * it started over, the removal of its old devices) and tries again with each one (`wait_rejoin`).
	 */
	async #join(conv: Conversation) {
		const { id } = conv;
		if (this.#otherSender.has(id)) return this.#set(id, this.#blocked(conv));
		if (this.#recordRefused.has(id)) return this.#set(id, { name: "members_changed" });
		if (this.#inFlight.has(id)) return;
		// Its count starts over for the next event, still marked as lost.
		if ((this.#joinsLost.get(id) ?? 0) >= JOINS_LOST_MOST) return void this.#joinsLost.set(id, 0);
		this.#settling.delete(id);
		const join = () => joinGroup(this.#parts, conv, this.#sender, legacyRecord(this.#parts.store, conv));
		let commit: Commit;
		try {
			commit = await join().catch(async (error: unknown) => {
				if (!(error instanceof CoreError && error.code === "rule_violation") || FINAL_RULES.has(error.rule ?? "")) {
					throw error;
				}
				await observeUsers(
					this.#parts,
					conv.members.map((member) => member.user_id),
				);
				return join();
			});
		} catch (error) {
			// A commit of its own still waits for its word.
			if (error instanceof CoreError && error.code === "pending_commit") return;
			// No group to join yet (the group info's 404), or the conversation or its user gone (#gone).
			const status = statusOf(error);
			if (status === 403 || status === 404) {
				await this.#gone(id, error);
				return;
			}
			if (!(error instanceof CoreError && error.code === "rule_violation")) throw error;
			if (error.rule === "stale_group_info") return;
			if (error.rule === "member_list_mismatch") return this.#refusedRecord(conv);
			if (error.rule === "external_sender_mismatch") this.#otherSender.add(id);
			const final = error.rule === "external_sender_mismatch" || error.rule === "group_blocked";
			return this.#set(id, final ? this.#blocked(conv) : { name: "wait_rejoin" });
		}
		await this.#commit(conv, "join", commit);
	}

	/** A commit of this device's own on the group it holds (commit_pending, refresh), sent: none when there's nothing. */
	async #own(conv: Conversation, cmd: "commit_pending" | "refresh", purpose: Purpose) {
		const held = await this.#group(conv.id);
		if (!held || held.blocked) return;
		let made: { commit: string; group_info: string };
		try {
			made = await withIdentities(this.#parts, () =>
				this.#parts.host.handle<{ commit: string; group_info: string }>({ cmd, conversation_id: conv.id }),
			);
		} catch (error) {
			// Nothing to commit (another member did it, or it was a false alarm), or a commit of its own still waits.
			if (error instanceof CoreError && (error.code === "not_found" || error.code === "pending_commit")) return;
			throw error;
		}
		await this.#commit(conv, purpose, { generation: held.generation, epoch: held.epoch, ...made });
	}

	/** A due commit (apply's commit_due), after a random wait of up to 5 s: whoever loses the race finds it done. */
	#dueLater(id: string) {
		if (this.#due.has(id)) return;
		const wait = Math.random() * DUE_WAIT_MS;
		this.#due.set(
			id,
			this.#parts.clock.later(wait, () => {
				this.#due.delete(id);
				this.#soon(async () => {
					const conv = this.#known.get(id);
					if (conv && !this.#inFlight.has(id)) await this.#own(conv, "commit_pending", "due");
				});
			}),
		);
	}

	/**
	 * A commit of this device's to the API, its bytes kept until an answer comes: without one, the same bytes go again
	 * later and at each READY. Answered, the conversation's turn follows, reading the queue when the API didn't take it
	 * (another commit took the epoch, or it refused the request), and a renewal another commit beat is made again on top
	 * of it, once.
	 */
	async #commit(conv: Conversation, purpose: Purpose, commit: Commit): Promise<void> {
		const { id } = conv;
		const flight = this.#inFlight.get(id) ?? { purpose, commit, tries: 0, cancel: null };
		this.#inFlight.set(id, flight);
		let sent: Sent;
		try {
			sent = await sendCommit(this.#parts.host, id, () => this.#parts.api.commit(id, flight.commit));
		} catch (error) {
			this.#resendLater(id, flight);
			throw error;
		}
		if (sent === "unanswered") return this.#resendLater(id, flight);
		this.#inFlight.delete(id);
		if (sent === "invalid") {
			// The validator refused it: it never entered, and nothing changed. An external commit so refused waits for the
			// conversation's next commit, as one the core refused would.
			console.warn(`[e2e] The API refused a commit of this device's (${flight.purpose}).`);
			if (flight.purpose === "join") this.#set(id, { name: "wait_rejoin" });
			return;
		}
		if (flight.purpose === "join") {
			if (sent === "accepted") this.#joinsLost.delete(id);
			else this.#joinsLost.set(id, (this.#joinsLost.get(id) ?? 0) + 1);
		}
		// A member's commit the API refused, but not for its epoch: the core keeps it staged, and it blocks this device's
		// commits there until settled. The queue brings it back if an earlier send of it entered; if not, with the queue
		// read whole a minute past the start, the API doesn't have it (Ruling 25, «Un commit sin respuesta»).
		if (sent === "refused" && MEMBER_COMMITS.has(flight.purpose)) this.#settling.add(id);
		await this.sync(id, sent !== "accepted");
		// A refused one may have entered by an earlier send of its bytes, which the queue says: only one another commit
		// beat is surely to make again.
		if (sent === "lost" && flight.purpose === "renew") {
			const now = this.#known.get(id);
			if (now && !this.#inFlight.has(id)) await this.#own(now, "refresh", "renew_again");
		}
	}

	#resendLater(id: string, flight: InFlight) {
		flight.cancel?.();
		const ms = Math.min(RETRY_MOST_MS, RETRY_MS * 2 ** flight.tries++);
		flight.cancel = this.#parts.clock.later(ms, () => {
			flight.cancel = null;
			this.#soon(() => this.#resend(id));
		});
	}

	/** A commit whose answer didn't come, sent again with its bytes; let go with a conversation the API no longer lists. */
	async #resend(id: string) {
		const flight = this.#inFlight.get(id);
		const conv = this.#known.get(id);
		if (!flight) return;
		if (!conv) return this.#drop(id);
		flight.cancel?.();
		flight.cancel = null;
		await this.#commit(conv, flight.purpose, flight.commit);
	}

	/** The API's conversations, which this device knows from now on; the states of those it's no longer in go. */
	async #list() {
		const listed = await this.#parts.api.conversations();
		this.#known.clear();
		for (const conv of listed) this.#known.set(conv.id, conv);
		for (const id of [...this.#states.keys()]) if (!this.#known.has(id)) this.#set(id, null);
	}

	/** The conversation as the API lists it now: null for one the user isn't in. */
	async #fresh(id: string): Promise<Conversation | null> {
		await this.#list();
		return this.#known.get(id) ?? null;
	}

	/**
	 * Whether the API refused a request as the conversation is gone or its user out of it (a 403 or a 404 of its routes,
	 * as when a removal came, or the conversation was deleted): listed again, one gone is let go (#drop). A list that
	 * fails proves nothing.
	 */
	async #gone(id: string, error: unknown): Promise<boolean> {
		const status = statusOf(error);
		if (status !== 403 && status !== 404) return false;
		const listed = await this.#fresh(id).catch(() => undefined);
		if (listed !== null) return false;
		this.#drop(id);
		return true;
	}

	/** A conversation this device is no longer in: nothing waits for it, its retries and its commits' with it. */
	#drop(id: string) {
		this.#retries.get(id)?.cancel();
		this.#inFlight.get(id)?.cancel?.();
		this.#due.get(id)?.();
		for (const kept of [this.#retries, this.#inFlight, this.#due, this.#heard, this.#joinsLost, this.#through]) {
			kept.delete(id);
		}
		for (const kept of [this.#settling, this.#removed, this.#otherSender, this.#recordRefused]) kept.delete(id);
		this.#set(id, null);
	}

	#set(id: string, state: ConversationState | null) {
		if (same(this.#states.get(id) ?? null, state)) return;
		if (state) this.#states.set(id, state);
		else this.#states.delete(id);
		this.#changed(id, state);
	}
}
