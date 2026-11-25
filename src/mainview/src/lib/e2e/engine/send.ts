// What this device sends to a conversation (PLAN-E2E-CLIENTES.md, «Enviar», and «Qué se manda», its message rows): the
// person's messages, their edits and their deletions. The core encrypts a message and keeps it as pending, its bytes
// with it, until `sent` binds it to the API's ID: the same nonce gives the same bytes again, so one whose answer was lost
// goes again as it was, and the API answers it with the message it posted. What waits in a conversation goes first, in
// the order it was made, its queue applied before; one whose bytes no member could open any more is dropped and its
// text encrypted again, under another nonce. An edit and a deletion the core makes anew each time, so their bytes are
// kept here until an answer comes, and the entry that answer gives goes to the core. Only the core keeps text: the
// record keeps what goes with each message in the clear, by its nonce, so it goes whole after a restart.
import { FetchError, PausedError, UpdateRequiredError } from "$lib/api/api";
import type { DirectMessage } from "$lib/api/conversations";
import type { AllowedMentions, MessageReference, MlsEntry } from "$lib/types";
import { CoreError } from "../errors";
import { pendingRows, type ShownMessage } from "./content";
import type { EngineParts } from "./engine";
import { withIdentities } from "./identity";
import { PENDING_SENDS } from "./store";
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

/** A message of the person's still being sent: the core's row, with what goes with it in the clear. */
export type Pending = ShownMessage & Partial<Clear>;

/** An edit or a deletion whose request goes on: its bytes, sent again as they are until an answer comes. */
interface Change {
	conversation: string;
	message: string;
	kind: "edit" | "delete";
	/** An edit's text, made into bytes again when the API says no member could open them any more. */
	text: string | null;
	ciphertext: string;
	remade: boolean;
	tries: number;
	cancel: (() => void) | null;
}

/** The most users a message names: the API takes 20. */
const MENTIONS_MOST = 20;
/** A change without an answer goes again after 2 s, then twice as long each time, up to a minute apart. */
const RETRY_MS = 2_000;
const RETRY_MOST_MS = 60_000;

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
	/** A conversation's messages changed on this device. */
	readonly #changed: (conversationId: string) => void;
	/** A message the person sent (its first nonce) is the API's message now. */
	readonly #sent: (conversationId: string, nonce: string, message: DirectMessage) => void;
	readonly #changes = new Map<string, Change>();
	/** Conversations whose messages wait for the pause to end, and its end's call. */
	readonly #paused = new Map<string, () => void>();

	constructor(
		parts: EngineParts,
		groups: Conversations,
		soon: (work: () => Promise<void>) => void,
		changed: (conversationId: string) => void,
		sent: (conversationId: string, nonce: string, message: DirectMessage) => void,
	) {
		this.#parts = parts;
		this.#groups = groups;
		this.#soon = soon;
		this.#changed = changed;
		this.#sent = sent;
	}

	/**
	 * The person's message, sent after what waits in its conversation: the API's message, or null when it was sent
	 * already. What fails leaves it waiting, with its bytes, for the person's Retry or Dismiss.
	 */
	async send(out: Outgoing): Promise<DirectMessage | null> {
		const { conversation_id: id, nonce, text, ...clear } = out;
		this.#keep(nonce, { conversation_id: id, ...clear });
		await this.#groups.current(id);
		if (!(await pendingRows(this.#parts.host, id)).some((row) => row.nonce === nonce)) {
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

	/** What waits in the conversation, in its order, with what goes with each in the clear. */
	async pending(id: string): Promise<Pending[]> {
		const record = this.#record();
		return (await pendingRows(this.#parts.host, id)).map((row) => ({
			...row,
			...(row.nonce ? record[row.nonce] : {}),
		}));
	}

	/** The person's Dismiss: the message the API never took goes, with what was kept of it. */
	async discard(nonce: string): Promise<void> {
		await this.#parts.host.handle({ cmd: "discard", nonce }).catch((error: unknown) => {
			// Gone already: sent, or dismissed in another tab.
			if (!(error instanceof CoreError && error.code === "not_found")) throw error;
		});
		this.#forget(nonce);
	}

	/** At the start and at each READY, the queues applied: what waits, in each conversation, and the changes. */
	async resendAll(): Promise<void> {
		const conversations = new Set(Object.values(this.#record()).map((clear) => clear.conversation_id));
		for (const id of conversations) {
			await this.#flush(id).catch((error: unknown) => console.error("[e2e] What waits to be sent waits again:", error));
		}
		for (const change of [...this.#changes.values()]) {
			await this.#sendChange(change).catch((error: unknown) => console.error("[e2e] A change wasn't sent:", error));
		}
	}

	/**
	 * An edit (with its text) or a deletion (null) of the user's message: made by the core, which shows it here at once,
	 * sent, and the entry its answer gives taken by the core. Without an answer its bytes go again later.
	 */
	async change(id: string, message: string, text: string | null): Promise<void> {
		await this.#groups.current(id);
		const kind = text === null ? "delete" : "edit";
		const change: Change = {
			conversation: id,
			message,
			kind,
			text,
			ciphertext: "",
			remade: false,
			tries: 0,
			cancel: null,
		};
		change.ciphertext = await this.#make(change);
		this.#changed(id);
		await this.#sendChange(change);
	}

	/** Stops waiting: what waits stays, in the core and in the record, for the next start. */
	stop() {
		for (const change of this.#changes.values()) change.cancel?.();
		for (const cancel of this.#paused.values()) cancel();
		this.#changes.clear();
		this.#paused.clear();
	}

	/**
	 * What waits in the conversation, in its order (`wanted`: the person's, whose message this gives). An older one the
	 * API refused stays, for the person's Retry or Dismiss, and the rest go on; one without an answer stops them all.
	 */
	async #flush(id: string, wanted?: string): Promise<DirectMessage | null> {
		const rows = await pendingRows(this.#parts.host, id);
		// What the record keeps of a message that no longer waits (sent, or dropped) goes.
		const waiting = new Set(rows.map((row) => row.nonce));
		for (const [nonce, clear] of Object.entries(this.#record())) {
			if (clear.conversation_id === id && !waiting.has(nonce)) this.#forget(nonce);
		}
		let message: DirectMessage | null = null;
		for (const { nonce, text } of rows) {
			if (!nonce) continue;
			const clear = this.#record()[nonce];
			// A message with nothing in it, and nothing kept of what went with it, waits for the person's Dismiss.
			if (nonce !== wanted && !clear && !text) continue;
			try {
				const sent = await this.#deliver(id, nonce, text, clear ?? { conversation_id: id });
				if (nonce === wanted) message = sent;
			} catch (error) {
				if (nonce === wanted || error instanceof UpdateRequiredError || unanswered(error)) throw error;
				console.warn("[e2e] A message that waits was refused: it stays, to send again or dismiss.", error);
			}
		}
		return message;
	}

	/**
	 * One message that waits: its bytes (the same as before, or made again under a new nonce once no member could open
	 * them), its request, and `sent` once the API took it.
	 */
	async #deliver(id: string, first: string, text: string | null, clear: Clear): Promise<DirectMessage> {
		let nonce = first;
		for (let remade = false; ; remade = true) {
			let ciphertext: string;
			try {
				({ ciphertext } = await this.#encrypt(id, nonce, text));
			} catch (error) {
				if (remade || !staleBytes(error)) throw error;
				nonce = await this.#again(id, nonce, text, clear);
				continue;
			}
			let message: DirectMessage;
			try {
				message = await this.#parts.api.sendMessage(id, {
					...{ ciphertext, nonce },
					...(text && mentionsIn(text).length ? { mentions: mentionsIn(text) } : {}),
					...(clear.message_reference ? { message_reference: clear.message_reference } : {}),
					...(clear.allowed_mentions ? { allowed_mentions: clear.allowed_mentions } : {}),
					...(clear.sticker_attachment_id ? { sticker_attachment_id: clear.sticker_attachment_id } : {}),
				});
			} catch (error) {
				if (error instanceof PausedError) this.#afterPause(id, error.retryAfter);
				if (remade || !staleAnswer(error)) throw error;
				// The core learns the epochs the API is at first, so the new bytes are of them.
				await this.#groups.sync(id, true);
				nonce = await this.#again(id, nonce, text, clear);
				continue;
			}
			const reply = clear.message_reference?.message_id;
			await this.#parts.host.handle({
				...{ cmd: "sent", conversation_id: id, nonce, message_id: message.id, seq: message.seq },
				...(reply ? { reply_to: reply } : {}),
			});
			this.#forget(nonce);
			this.#changed(id);
			this.#sent(id, first, message);
			return message;
		}
	}

	/** A message no member could open any more, dropped and encrypted again under a new nonce: the new nonce. */
	async #again(id: string, nonce: string, text: string | null, clear: Clear): Promise<string> {
		await this.discard(nonce);
		const fresh = crypto.randomUUID();
		this.#keep(fresh, clear);
		await this.#encrypt(id, fresh, text);
		return fresh;
	}

	/**
	 * The core's encrypt: the message kept as pending, or, for a nonce it has, its bytes again. What keeps this device from
	 * sending there is dealt with once: users to observe, leaves and removals to commit, a group to join or make.
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
	 * An edit's or a deletion's request, its bytes as they are: its answer's entry to the core. Without an answer it goes
	 * again later and at each READY; bytes the API says no member could open now are made again, once.
	 */
	async #sendChange(change: Change): Promise<void> {
		const { conversation: id, message, kind } = change;
		const key = `${kind}:${id}:${message}`;
		let entry: MlsEntry;
		try {
			const { api } = this.#parts;
			const answer =
				kind === "edit"
					? await api.editMessage(id, message, change.ciphertext)
					: await api.deleteMessage(id, message, change.ciphertext);
			entry = answer.entry;
		} catch (error) {
			if (!(error instanceof UpdateRequiredError) && unanswered(error)) {
				this.#changes.set(key, change);
				return this.#retryLater(change);
			}
			this.#changes.delete(key);
			if (!staleAnswer(error) || change.remade) throw error;
			await this.#groups.sync(id, true);
			change.ciphertext = await this.#make(change);
			change.remade = true;
			return this.#sendChange(change);
		}
		change.cancel?.();
		this.#changes.delete(key);
		this.#changed(id);
		// The API has it: an entry the core can't take now is taken with the conversation's next turn.
		await this.#groups.take(id, [entry]).catch((error: unknown) => {
			console.error("[e2e] A change's entry waits for its conversation's next turn:", error);
		});
	}

	#retryLater(change: Change) {
		change.cancel?.();
		const ms = Math.min(RETRY_MOST_MS, RETRY_MS * 2 ** change.tries++);
		change.cancel = this.#parts.clock.later(ms, () => {
			change.cancel = null;
			this.#soon(() => this.#sendChange(change));
		});
	}

	/** What the record keeps by each nonce: what it holds is checked as it's read, as any record's. */
	#record(): Record<string, Clear> {
		const kept = this.#parts.store.read<Record<string, Clear>>(PENDING_SENDS) ?? {};
		return Object.fromEntries(Object.entries(kept).filter(([, clear]) => typeof clear?.conversation_id === "string"));
	}

	#keep(nonce: string, clear: Clear) {
		this.#parts.store.write(PENDING_SENDS, { ...this.#record(), [nonce]: clear });
	}

	#forget(nonce: string) {
		const { [nonce]: _gone, ...rest } = this.#record();
		this.#parts.store.write(PENDING_SENDS, Object.keys(rest).length ? rest : null);
	}
}
