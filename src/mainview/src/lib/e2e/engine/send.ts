// What this device sends to a conversation (PLAN-E2E-CLIENTES.md, «Enviar», and «Qué se manda», its message rows): the
// person's messages, their edits and their deletions. The core encrypts a message and keeps it as pending, its bytes
// with it, until `sent` binds it to the API's ID: the same nonce gives the same bytes again, so one whose answer was lost
// goes again as it was, and the API answers it with the message it posted. What waits in a conversation goes first, in
// the order it was made, its queue applied before; once one's bytes no member can open any more, it and each one after
// it are encrypted again, in their order, under new nonces, each still known by the nonce the person sent it with. An
// edit and a deletion the core makes anew each time: a message's go one after the other, each kept until its answer
// comes (in memory with its bytes, and in the record without them, made again at the next start), and the entry the
// answer gives goes to the core. Only the core keeps text: the record keeps what goes with each message in the clear.
import { FetchError, PausedError, UpdateRequiredError } from "$lib/api/api";
import type { DirectMessage } from "$lib/api/conversations";
import type { AllowedMentions, MessageReference, MlsEntry } from "$lib/types";
import { CoreError } from "../errors";
import { pendingRows, shownMessages, type ShownMessage } from "./content";
import type { EngineParts } from "./engine";
import { withIdentities } from "./identity";
import { PENDING_CHANGES, PENDING_SENDS } from "./store";
import type { Conversations } from "./sync";

/**
 * A message as the person sends it: its nonce (a UUIDv4, «Convenciones entre clientes»), its text (none for a sticker,
 * which goes in the clear with an empty envelope), and what goes with it in the clear.
 */
export interface Outgoing {
	conversation_id: string;
	nonce: string;
	text?: string;
	message_reference?: MessageReference;
	allowed_mentions?: AllowedMentions;
	sticker_attachment_id?: string;
}

/** What goes with a message in the clear, kept by its nonce until it's sent. */
type Clear = Omit<Outgoing, "nonce" | "text">;

/** What the record keeps by a message's nonce: what goes with it in the clear, and, once its bytes were made again
 * under this nonce, the nonce the person sent it with (`first`), which the views and the engine know it by. */
type Kept = Clear & { first?: string };

/** A message of the person's still being sent: the core's row, by the nonce they sent it with, with what goes with it in
 * the clear. */
export type Pending = ShownMessage & Partial<Clear>;

type ChangeKind = "edit" | "delete";

/** An edit or a deletion of the person's, made: its bytes, sent again as they are until an answer comes. */
interface Change {
	conversation: string;
	message: string;
	kind: ChangeKind;
	/** An edit's text, made into bytes again when the API says no member could open them any more. */
	text: string | null;
	ciphertext: string;
	remade: boolean;
}

/** A message's changes not answered yet, one after the other: the first goes, and its retry's wait. */
interface Changes {
	list: Change[];
	tries: number;
	/** Waiting as the pause said (its Retry-After), which a READY doesn't cut short. */
	paused: boolean;
	cancel: (() => void) | null;
}

/** What the record keeps of a message whose changes aren't all answered: never their text. A deletion among them is
 * what's made again at the next start, else an edit from the row's text, which is its last edit's. */
interface KeptChange {
	conversation_id: string;
	message_id: string;
	kind: ChangeKind;
}

/** What a conversation's messages tell the engine: which changed on this device, the person's that the API took (by
 * the nonce they sent it with), and a change the API refused for good. */
export interface SendsHooks {
	changed: (conversationId: string, ids?: string[]) => void;
	sent: (conversationId: string, nonce: string, message: DirectMessage) => void;
	refused: (conversationId: string, messageId: string, kind: ChangeKind) => void;
}

/** The most users a message names: the API takes 20. */
const MENTIONS_MOST = 20;
/** A change without an answer goes again after 2 s, then twice as long each time, up to a minute apart. */
const RETRY_MS = 2_000;
const RETRY_MOST_MS = 60_000;
/** The messages a conversation can have waiting: the core's page reads this many (pendingRows), so a new one past them
 * is refused, as the oldest would go unseen. */
const WAITING_MOST = 100;

// As the API reads a room's mentions (parseMentionIDs): code blocks, then inline code, taken out first.
const CODE_BLOCK = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]+`/g;
const MENTION = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/g;

/** Whom a message's text names (PLAN-E2E-CLIENTES.md, «Enviar»): each `<@id>` outside code, once, 20 at most. */
export function mentionsIn(text: string): string[] {
	const outside = text.replace(CODE_BLOCK, "").replace(INLINE_CODE, "");
	return [...new Set([...outside.matchAll(MENTION)].map((match) => match[1]!))].slice(0, MENTIONS_MOST);
}

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);
/** No word on the message itself: a lost connection, a session's renewal, a rate limit, the server, the pause. */
const unanswered = (error: unknown) => {
	const status = statusOf(error);
	return status === undefined || status === 401 || status === 408 || status === 429 || status >= 500;
};
/** The core's word that no member could open the message's bytes any more. */
const staleBytes = (error: unknown) =>
	error instanceof CoreError && error.code === "rule_violation" && error.rule === "stale_message";
/** The API's (a 409): the bytes are of another generation of the group, or too many epochs behind it. */
const staleAnswer = (error: unknown) =>
	error instanceof FetchError && error.response?.status === 409 && error.response.data?.error === "stale message";

export class Sends {
	readonly #parts: EngineParts;
	readonly #groups: Conversations;
	/** Runs work in the engine's turn. */
	readonly #soon: (work: () => Promise<void>) => void;
	readonly #hooks: SendsHooks;
	/** Each message's changes not answered yet, by conversation and message (`changeKey`). */
	readonly #changes = new Map<string, Changes>();
	/** Conversations whose messages wait for the pause to end, and its end's call. */
	readonly #paused = new Map<string, () => void>();

	constructor(parts: EngineParts, groups: Conversations, soon: (work: () => Promise<void>) => void, hooks: SendsHooks) {
		this.#parts = parts;
		this.#groups = groups;
		this.#soon = soon;
		this.#hooks = hooks;
	}

	/**
	 * The person's message, sent after what waits in its conversation: the API's message, or null when it was sent
	 * already. What fails leaves it waiting, with its bytes, for the person's Retry or Dismiss; a new one is refused once
	 * 100 wait there.
	 */
	async send(out: Outgoing): Promise<DirectMessage | null> {
		const { conversation_id: id, nonce, text, ...clear } = out;
		await this.#groups.current(id);
		const rows = await pendingRows(this.#parts.host, id);
		if (!this.#nonceNow(rows, nonce)) {
			if (rows.length >= WAITING_MOST) throw new Error(`${WAITING_MOST} messages wait to be sent in this conversation`);
			this.#keep(nonce, { conversation_id: id, ...clear });
			try {
				await this.#encrypt(id, nonce, text ?? null);
			} catch (error) {
				// Its copy came back from the queue: it went.
				if (!(error instanceof CoreError && error.code === "exists")) throw error;
				this.#forget(nonce);
				return null;
			}
		}
		return this.#flush(id, nonce);
	}

	/** What waits in the conversation, in its order, each by the nonce the person sent it with and with its clear parts. */
	async pending(id: string): Promise<Pending[]> {
		const record = this.#record();
		return (await pendingRows(this.#parts.host, id)).map((row) => {
			const { first, ...clear }: Partial<Kept> = (row.nonce ? record[row.nonce] : undefined) ?? {};
			return { ...row, ...clear, nonce: first ?? row.nonce };
		});
	}

	/**
	 * The person's Dismiss, by the nonce they sent the message with. The conversation's queue is read first (`read`, while
	 * the device can): a message it settles went, and stays. One the API never took goes, with what was kept of it. A
	 * queue that can't be read keeps nothing from going: the person's Dismiss holds.
	 */
	async discard(id: string, first: string, read: boolean): Promise<void> {
		if (read) {
			await this.#groups.sync(id, true).catch((error: unknown) => {
				console.warn("[e2e] A conversation's queue wasn't read before a Dismiss:", error);
			});
		}
		const rows = await pendingRows(this.#parts.host, id);
		const nonce = this.#nonceNow(rows, first);
		if (nonce) await this.#drop(nonce);
		this.#prune(id, nonce ? rows.filter((row) => row.nonce !== nonce) : rows);
	}

	/**
	 * At the start and at each READY, the queues applied: what waits, in each conversation, and the changes. Those of an
	 * earlier start the record keeps are made again first; a change waiting for the pause's end waits on.
	 */
	async resendAll(): Promise<void> {
		const log = (error: unknown) => console.error("[e2e] What waits to be sent waits again:", error);
		const conversations = new Set(Object.values(this.#record()).map((kept) => kept.conversation_id));
		for (const id of conversations) await this.#flush(id).catch(log);
		for (const [key, kept] of Object.entries(this.#keptChanges())) {
			if (!this.#changes.has(key)) await this.#remake(key, kept).catch(log);
		}
		for (const [key, changes] of [...this.#changes]) if (!changes.paused) await this.#drain(key).catch(log);
	}

	/**
	 * An edit (with its text) or a deletion (null) of the user's message: made by the core, which shows it here at once,
	 * kept, and sent once the message's changes before it are answered; the entry its answer gives goes to the core.
	 * Without an answer its bytes go again later; refused for good, it's told (`refused`). A client too old for it (426)
	 * keeps it for after the update.
	 */
	async change(id: string, message: string, text: string | null): Promise<void> {
		await this.#groups.current(id);
		const kind = text === null ? "delete" : "edit";
		const change: Change = { conversation: id, message, kind, text, ciphertext: "", remade: false };
		change.ciphertext = await this.#make(change);
		const key = changeKey(id, message);
		this.#keepChange(key, change);
		this.#hooks.changed(id, [message]);
		const changes = this.#changesOf(key);
		changes.list.push(change);
		// One before it still waits for its answer: this one goes after it.
		if (changes.list.length === 1) await this.#drain(key);
	}

	/** Stops waiting: what waits stays, in the core and in the record, for the next start. */
	stop() {
		for (const changes of this.#changes.values()) changes.cancel?.();
		for (const cancel of this.#paused.values()) cancel();
		this.#changes.clear();
		this.#paused.clear();
	}

	/**
	 * What waits in the conversation, in its order (`wanted`: the nonce the person sent theirs with, whose message this
	 * gives). An older one the API refused stays, for the person's Retry or Dismiss, and the rest go on; one without an
	 * answer stops them all. Once one's bytes no member can open any more, it and each one after it are made again.
	 */
	async #flush(id: string, wanted?: string): Promise<DirectMessage | null> {
		let rows = await pendingRows(this.#parts.host, id);
		this.#prune(id, rows);
		let message: DirectMessage | null = null;
		let remade = false;
		for (let at = 0; at < rows.length; at++) {
			const { nonce, text } = rows[at]!;
			if (!nonce) continue;
			const kept = this.#record()[nonce];
			const first = kept?.first ?? nonce;
			// A message with nothing in it, and nothing kept of what went with it, waits for the person's Dismiss.
			if (first !== wanted && !kept && !text) continue;
			try {
				const sent = await this.#deliver(id, nonce, text, kept ?? { conversation_id: id });
				if (first === wanted) message = sent;
			} catch (error) {
				if (!remade && (staleBytes(error) || staleAnswer(error))) {
					// The core learns the epochs the API is at first, so the new bytes are of them.
					if (staleAnswer(error)) await this.#groups.sync(id, true);
					rows = [...rows.slice(0, at), ...(await this.#again(id, rows.slice(at)))];
					remade = true;
					at--;
					continue;
				}
				if (first === wanted || error instanceof UpdateRequiredError || unanswered(error)) throw error;
				console.warn("[e2e] A message that waits was refused: it stays, to send again or dismiss.", error);
			}
		}
		return message;
	}

	/** One message that waits: its bytes (the same as before, or new ones), its request, and `sent` once the API took it. */
	async #deliver(id: string, nonce: string, text: string | null, kept: Kept): Promise<DirectMessage> {
		const { ciphertext } = await this.#encrypt(id, nonce, text);
		let message: DirectMessage;
		try {
			message = await this.#parts.api.sendMessage(id, {
				...{ ciphertext, nonce },
				...(text && mentionsIn(text).length ? { mentions: mentionsIn(text) } : {}),
				...(kept.message_reference ? { message_reference: kept.message_reference } : {}),
				...(kept.allowed_mentions ? { allowed_mentions: kept.allowed_mentions } : {}),
				...(kept.sticker_attachment_id ? { sticker_attachment_id: kept.sticker_attachment_id } : {}),
			});
		} catch (error) {
			if (error instanceof PausedError) this.#afterPause(id, error.retryAfter);
			throw error;
		}
		const reply = kept.message_reference?.message_id;
		await this.#parts.host.handle({
			...{ cmd: "sent", conversation_id: id, nonce, message_id: message.id, seq: message.seq },
			...(reply ? { reply_to: reply } : {}),
		});
		this.#forget(nonce);
		this.#hooks.changed(id, [message.id]);
		this.#hooks.sent(id, kept.first ?? nonce, message);
		return message;
	}

	/**
	 * Messages no member could open any more, from the first whose bytes went stale to the last that waits: each dropped
	 * and encrypted again under a new nonce, in their order, so they go in the order they were made. Each keeps the nonce
	 * the person sent it with. One with nothing in it, and nothing kept of what went with it, stays for the Dismiss.
	 */
	async #again(id: string, rows: ShownMessage[]): Promise<ShownMessage[]> {
		const made: ShownMessage[] = [];
		for (const row of rows) {
			const kept = row.nonce ? this.#record()[row.nonce] : undefined;
			if (!row.nonce || (!kept && !row.text)) {
				made.push(row);
				continue;
			}
			await this.#drop(row.nonce);
			const nonce = crypto.randomUUID();
			this.#keep(nonce, { ...(kept ?? { conversation_id: id }), first: kept?.first ?? row.nonce });
			await this.#encrypt(id, nonce, row.text);
			made.push({ ...row, nonce });
		}
		return made;
	}

	/** A message the person dismissed, or made again: the core lets it go, and the record what went with it. */
	async #drop(nonce: string) {
		await this.#parts.host.handle({ cmd: "discard", nonce }).catch((error: unknown) => {
			// Gone already: sent, or dismissed in another tab.
			if (!(error instanceof CoreError && error.code === "not_found")) throw error;
		});
		this.#forget(nonce);
	}

	/** The nonce the message the person sent under `first` waits under now: null when it doesn't wait. */
	#nonceNow(rows: ShownMessage[], first: string): string | null {
		const record = this.#record();
		const row = rows.find(({ nonce }) => nonce && (nonce === first || record[nonce]?.first === first));
		return row?.nonce ?? null;
	}

	/**
	 * The core's encrypt: the message kept as pending, or, for a nonce it has, its bytes again. What keeps this device from
	 * sending there is dealt with once: users to observe, leaves and removals to commit, a commit of its own that waits
	 * for its word (settled as «Un commit sin respuesta» says), a group to join or make.
	 */
	async #encrypt(id: string, nonce: string, text: string | null): Promise<{ ciphertext: string }> {
		const run = () =>
			withIdentities(this.#parts, () =>
				this.#parts.host.handle<{ ciphertext: string }>({
					...{ cmd: "encrypt", conversation_id: id, nonce },
					envelope: text ? { text } : {},
				}),
			);
		try {
			return await run();
		} catch (error) {
			if (!(error instanceof CoreError)) throw error;
			if (error.code === "pending_proposals") await this.#groups.commitDue(id);
			else if (error.code === "pending_commit") await this.#groups.settle(id);
			else if (error.code === "not_found" && error.what === "group") await this.#groups.current(id);
			else throw error;
			return run();
		}
	}

	/** The messages of a conversation the pause held, sent once it ends: the API says when to try. */
	#afterPause(id: string, seconds: number) {
		if (this.#paused.has(id)) return;
		const cancel = this.#parts.clock.later(seconds * 1000, () => {
			this.#paused.delete(id);
			this.#soon(async () => void (await this.#flush(id)));
		});
		this.#paused.set(id, cancel);
	}

	/** An edit's or a deletion's bytes, as the core makes them now. */
	async #make(change: Change): Promise<string> {
		const { ciphertext } = await withIdentities(this.#parts, () =>
			this.#parts.host.handle<{ ciphertext: string }>({
				...{ cmd: change.kind, conversation_id: change.conversation, message_id: change.message },
				...(change.text === null ? {} : { text: change.text }),
			}),
		);
		return ciphertext;
	}

	/**
	 * A change the record kept from an earlier start, made again: a deletion as it was (the core takes one again on the
	 * row it erased), an edit from the row's text, which is its last edit's. A message no longer held here has none.
	 */
	async #remake(key: string, kept: KeptChange): Promise<void> {
		const { conversation_id: id, message_id: message, kind } = kept;
		let text: string | null = null;
		if (kind === "edit") {
			const [row] = await shownMessages(this.#parts.host, id, [message]);
			if (row?.status !== "ok") return this.#forgetChange(key);
			text = row.text ?? "";
		}
		const change: Change = { conversation: id, message, kind, text, ciphertext: "", remade: false };
		try {
			change.ciphertext = await this.#make(change);
		} catch (error) {
			// The core has nothing of the message any more (its conversation let go): nothing to send.
			if (error instanceof CoreError && error.code === "not_found") return this.#forgetChange(key);
			throw error;
		}
		this.#changesOf(key).list.push(change);
	}

	#changesOf(key: string): Changes {
		let changes = this.#changes.get(key);
		if (!changes) this.#changes.set(key, (changes = { list: [], tries: 0, paused: false, cancel: null }));
		return changes;
	}

	/**
	 * A message's changes, one after the other, each once the one before it is answered: taken, or refused for good. One
	 * without an answer waits (the pause as long as it says), and those after it with it. A 426 keeps it, and throws.
	 */
	async #drain(key: string): Promise<void> {
		const changes = this.#changes.get(key);
		if (!changes) return;
		changes.cancel?.();
		changes.cancel = null;
		changes.paused = false;
		for (let change = changes.list[0]; change; change = changes.list[0]) {
			const wait = await this.#sendChange(change, changes);
			if (wait !== null) return this.#later(key, changes, wait);
			changes.list.shift();
			changes.tries = 0;
		}
		this.#changes.delete(key);
		this.#forgetChange(key);
	}

	/**
	 * An edit's or a deletion's request, its bytes as they are: null once answered (its entry to the core, or a refusal
	 * for good, told), else how long to wait before it goes again (the pause's Retry-After). Bytes the API says no member
	 * could open now are made again, once.
	 */
	async #sendChange(change: Change, changes: Changes): Promise<number | null> {
		const { conversation: id, message, kind } = change;
		let entry: MlsEntry;
		try {
			const { api } = this.#parts;
			const answer =
				kind === "edit"
					? await api.editMessage(id, message, change.ciphertext)
					: await api.deleteMessage(id, message, change.ciphertext);
			entry = answer.entry;
		} catch (error) {
			if (error instanceof UpdateRequiredError) throw error;
			if (error instanceof PausedError) {
				changes.paused = true;
				return error.retryAfter * 1000;
			}
			if (unanswered(error)) return Math.min(RETRY_MOST_MS, RETRY_MS * 2 ** changes.tries++);
			if (staleAnswer(error) && !change.remade) {
				await this.#groups.sync(id, true);
				change.ciphertext = await this.#make(change);
				change.remade = true;
				return this.#sendChange(change, changes);
			}
			console.warn("[e2e] The API refused a change of the person's message:", error);
			this.#hooks.refused(id, message, kind);
			return null;
		}
		this.#hooks.changed(id, [message]);
		// The API has it: an entry the core can't take now is taken with the conversation's next turn.
		await this.#groups.take(id, [entry]).catch((error: unknown) => {
			console.error("[e2e] A change's entry waits for its conversation's next turn:", error);
		});
		return null;
	}

	/** A message's changes go again after `ms`, in the engine's turn. */
	#later(key: string, changes: Changes, ms: number) {
		changes.cancel = this.#parts.clock.later(ms, () => {
			changes.cancel = null;
			this.#soon(() => this.#drain(key));
		});
	}

	/** What the record keeps by each nonce: what it holds is checked as it's read, as any record's. */
	#record(): Record<string, Kept> {
		const kept = this.#parts.store.read<Record<string, Kept>>(PENDING_SENDS) ?? {};
		return Object.fromEntries(
			Object.entries(kept)
				.filter(([, clear]) => typeof clear?.conversation_id === "string")
				.map(([nonce, { first, ...clear }]) => [nonce, typeof first === "string" ? { ...clear, first } : clear]),
		);
	}

	#keep(nonce: string, kept: Kept) {
		this.#parts.store.write(PENDING_SENDS, { ...this.#record(), [nonce]: kept });
	}

	#forget(nonce: string) {
		const { [nonce]: _gone, ...rest } = this.#record();
		this.#parts.store.write(PENDING_SENDS, Object.keys(rest).length ? rest : null);
	}

	/** What the record keeps of the conversation's messages that no longer wait (sent, or dropped) goes. */
	#prune(id: string, rows: ShownMessage[]) {
		const waiting = new Set(rows.map((row) => row.nonce));
		for (const [nonce, kept] of Object.entries(this.#record())) {
			if (kept.conversation_id === id && !waiting.has(nonce)) this.#forget(nonce);
		}
	}

	/** The changes the record keeps, by `changeKey`: what each holds is checked as it's read. */
	#keptChanges(): Record<string, KeptChange> {
		const kept = this.#parts.store.read<Record<string, KeptChange>>(PENDING_CHANGES) ?? {};
		return Object.fromEntries(
			Object.entries(kept).filter(
				([, change]) =>
					typeof change?.conversation_id === "string" &&
					typeof change.message_id === "string" &&
					(change.kind === "edit" || change.kind === "delete"),
			),
		);
	}

	/** A change made: the record keeps its message's, a deletion over an edit. */
	#keepChange(key: string, change: Change) {
		const kept = this.#keptChanges();
		const kind = kept[key]?.kind === "delete" ? "delete" : change.kind;
		kept[key] = { conversation_id: change.conversation, message_id: change.message, kind };
		this.#parts.store.write(PENDING_CHANGES, kept);
	}

	/** A message's changes all answered: the record lets them go. */
	#forgetChange(key: string) {
		const { [key]: _gone, ...rest } = this.#keptChanges();
		this.#parts.store.write(PENDING_CHANGES, Object.keys(rest).length ? rest : null);
	}
}

/** A message's changes' key: its conversation's and its own IDs. */
const changeKey = (conversationId: string, messageId: string) => `${conversationId}:${messageId}`;
