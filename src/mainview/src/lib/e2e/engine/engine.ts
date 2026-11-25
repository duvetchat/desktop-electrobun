// The encryption engine (PLAN-E2E-CLIENTES.md, «El motor»): it carries what the core makes to the API and what the API
// hands out to the core, never opening or making anything itself. A class with its parts given to it, so the app has
// one (lib/e2e/engine.svelte.ts) and a test as many as it needs, each with its own core, session and gateway connection.
//
// Its work goes one flow at a time, in the order it came: the start («Arranque», steps 1 to 7), the person's taps, and
// what the gateway's events ask for. bootstrap.ts, identity.ts, key-packages.ts and inbox.ts hold the steps, sync.ts
// each conversation's queue and group; this class keeps the state the views read, and what's due later.
import { FetchError, UpdateRequiredError, type UploadOptions } from "$lib/api/api";
import type { DirectMessage } from "$lib/api/conversations";
import type { E2eApi } from "$lib/api/e2e";
import { CoreError } from "../errors";
import type { EngineEvent, EngineEvents } from "../events";
import type { CoreHost, HostOpened } from "../host";
import { bindSession, coreStatus, ownDevice } from "./bootstrap";
import { heldBefore, shownMessages, type ShownMessage } from "./content";
import { Failures } from "./failures";
import { fileNames } from "./files";
import { identityState, publishIdentity, servedIdentity, type IdentityMade } from "./identity";
import { takeInbox } from "./inbox";
import { uploadKeyPackages } from "./key-packages";
import { Sends, type Outgoing, type Pending } from "./send";
import { DEVICE_RECORD, EXTERNAL_SENDER, type EngineStore } from "./store";
import { Conversations, type ConversationState } from "./sync";

export type { ConversationState } from "./sync";
export type { Outgoing, Pending } from "./send";
export type { OutgoingFile } from "./files";
export type { ShownMessage } from "./content";

/**
 * A conversation's messages changed on this device: `ids`, those whose rows changed (none: any of them), and
 * `through`, how far its queue is applied now, when that moved.
 */
export type MessagesListener = (
	conversationId: string,
	ids?: string[],
	through?: number | null,
	/** The messages the queue deleted, whose files go (task 18's review, M4). */
	deleted?: string[],
) => void;

/** What the engine waits with: the system's timers in the app, a test's clock in its tests. */
export interface Clock {
	/** Runs `run` once `ms` have passed; what it gives calls it off. */
	later(ms: number, run: () => void): () => void;
}

export const systemClock: Clock = {
	later(ms, run) {
		const timer = setTimeout(run, ms);
		return () => clearTimeout(timer);
	},
};

export interface EngineParts {
	host: CoreHost;
	/** The routes, for the session the engine works for. */
	api: E2eApi;
	/** The gateway's events of that session. */
	events: EngineEvents;
	store: EngineStore;
	clock: Clock;
	/** The session's user. */
	user: string;
	/** This installation's name among the user's devices (client.ts's deviceName). */
	deviceName: string;
	/** The session is bound to this device, which every identify names from now on (Ruling 30). */
	registered(deviceId: string): void;
}

/**
 * What the views show (PLAN-E2E-CLIENTES.md, «El motor», its states). A first device waits for the person's tap to
 * make its identity, then shows its recovery key (`recoveryKey`) until it's saved; `finishing` when an identity it made
 * before the app closed still waits for its upload. `failed` with `lostKey` is a database its key no longer opens.
 */
export type EngineState =
	| { name: "starting" }
	| { name: "first_device"; recoveryKey: string | null; finishing: boolean }
	| { name: "new_device" }
	| { name: "ready" }
	| { name: "removed" }
	| { name: "locked" }
	| { name: "unsupported" }
	| { name: "failed"; lostKey: boolean }
	| { name: "update"; minimum: string | null };

const DAY = 24 * 3600 * 1000;
/** A start that failed goes again after 2 s, then twice as long each time, up to a minute apart. */
const RETRY_MS = 2_000;
const RETRY_MOST_MS = 60_000;

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);

/**
 * The API's external sender as this device pinned it (Ruling 32): the first one it saw, which the record keeps, and
 * this session (`held`) where the record can't (its storage full or refused), so a later start in it keeps it too;
 * the record is asked again each time. Another one served later is refused, said in the log, and the pinned one stays:
 * groups under it are the only ones this device goes into.
 */
function pinnedSender(store: EngineStore, served: string, held: string | null): string {
	const kept = store.read<unknown>(EXTERNAL_SENDER);
	const recorded = typeof kept === "string" && kept ? kept : null;
	const pinned = recorded ?? held ?? served;
	if (!recorded) store.write(EXTERNAL_SENDER, pinned);
	if (pinned !== served) {
		console.warn(
			"[e2e] The API serves another external sender than the one this device pinned: it stays the pinned one.",
		);
	}
	return pinned;
}

/**
 * The binding's refusals that no try changes (a proof that doesn't verify, a body the API refuses): null, which ends
 * the tries with the failed bar. A rate limit, a renewal's 401 and an update's 426 go on as failures that pass.
 */
const refusedForGood = (error: unknown): null => {
	const status = statusOf(error);
	if (status === undefined || status < 400 || status >= 500 || [401, 426, 429].includes(status)) throw error;
	console.error("[e2e] The API refused this device:", error);
	return null;
};

export class E2EEngine {
	state: EngineState = { name: "starting" };
	/** The cutover's instant, as GET /api/e2e gave it: a conversation from before it says when its messages went. */
	cutoverAt: string | null = null;
	readonly #parts: EngineParts;
	readonly #listeners = new Set<(state: EngineState) => void>();
	/** The flow under way: each one waits for the one before. */
	#turn: Promise<void> = Promise.resolve();
	#stopped = false;
	#unlisten: (() => void) | null = null;
	/** A start that failed and goes again (calls it off), and the uploads every day. */
	#retry: (() => void) | null = null;
	#retries = 0;
	#daily: (() => void) | null = null;
	/** The device this session is bound to, once it is. */
	#device: string | null = null;
	/** What create_identity answered, until it's uploaded: never kept elsewhere, as the core gives it again. */
	#made: IdentityMade | null = null;
	/** How many rounds each inbox message's call was cut (inbox.ts). */
	readonly #tries = new Map<string, number>();
	/** What failed to open, waiting for its report. */
	readonly #failures: Failures;
	/** The conversations' queues and groups. */
	readonly #groups: Conversations;
	/** The external sender this session pinned (pinnedSender). */
	#pinned: string | null = null;
	/** Conversations the person opened before this device was ready: they open once it is (#settle). */
	readonly #toOpen = new Set<string>();
	readonly #conversationListeners = new Set<(conversationId: string, state: ConversationState | null) => void>();
	/** The messages this device sends, edits and deletes. */
	readonly #sends: Sends;
	readonly #messageListeners = new Set<MessagesListener>();
	readonly #refusedListeners = new Set<(conversationId: string, messageId: string, kind: "edit" | "delete") => void>();
	readonly #sentListeners = new Set<(conversationId: string, nonce: string, message: DirectMessage) => void>();

	constructor(parts: EngineParts) {
		this.#parts = parts;
		this.#failures = new Failures(parts.api, parts.clock);
		const soon = (work: () => Promise<void>) => this.#soon(() => this.#whenReady(work));
		const messagesChanged = (id: string, ids?: string[], through?: number | null, deleted?: string[]) => {
			for (const listener of this.#messageListeners) listener(id, ids, through, deleted);
		};
		this.#groups = new Conversations(
			parts,
			soon,
			this.#failures,
			(id, state) => {
				for (const listener of this.#conversationListeners) listener(id, state);
			},
			messagesChanged,
		);
		this.#sends = new Sends(parts, this.#groups, soon, (work) => this.#act(work), {
			changed: messagesChanged,
			sent: (id, nonce, message) => {
				for (const listener of this.#sentListeners) listener(id, nonce, message);
			},
			refused: (id, message, kind) => {
				for (const listener of this.#refusedListeners) listener(id, message, kind);
			},
		});
	}

	/** Each state the engine goes to, as it goes. */
	onState(listener: (state: EngineState) => void): () => void {
		this.#listeners.add(listener);
		return () => void this.#listeners.delete(listener);
	}

	/** What each conversation says of its group as it changes (null: nothing to say). */
	onConversation(listener: (conversationId: string, state: ConversationState | null) => void): () => void {
		this.#conversationListeners.add(listener);
		return () => void this.#conversationListeners.delete(listener);
	}

	/** Each conversation whose messages changed on this device: what the views show of them is read again. */
	onMessages(listener: MessagesListener): () => void {
		this.#messageListeners.add(listener);
		return () => void this.#messageListeners.delete(listener);
	}

	/** Each edit or deletion of the person's that the API refused for good: it shows on this device alone. */
	onChangeRefused(listener: (conversationId: string, messageId: string, kind: "edit" | "delete") => void): () => void {
		this.#refusedListeners.add(listener);
		return () => void this.#refusedListeners.delete(listener);
	}

	/** Each message of the person's that the API took, by the nonce they sent it with: their copy of it is the API's. */
	onSent(listener: (conversationId: string, nonce: string, message: DirectMessage) => void): () => void {
		this.#sentListeners.add(listener);
		return () => void this.#sentListeners.delete(listener);
	}

	/** What the conversation says of its group over its message box: null while it goes on. */
	conversationState(conversationId: string): ConversationState | null {
		return this.#groups.state(conversationId);
	}

	/**
	 * The person opened the conversation: its group goes on, or is made here when it has none and this user may. Before
	 * this device is ready, it opens once it is.
	 */
	openConversation(conversationId: string): Promise<void> {
		return this.#queue(async () => {
			if (this.state.name !== "ready") return void this.#toOpen.add(conversationId);
			await this.#whenReady(() => this.#groups.open(conversationId));
		});
	}

	/**
	 * The person's message, sent after what waits in its conversation (PLAN-E2E-CLIENTES.md, «Enviar»): the API's message,
	 * or null when it was sent already. A refusal or a lost answer rejects, the message kept for Retry and Dismiss. Its
	 * files go sealed («Adjuntos»), `upload` following their upload and stopping it: a Cancel is then its Dismiss. Only
	 * the core's calls take the engine's turn: its request waits in its conversation's lane.
	 */
	async sendMessage(message: Outgoing, upload?: UploadOptions): Promise<DirectMessage | null> {
		try {
			return await this.#sends.send(message, upload);
		} catch (error) {
			// Its request's 426, which came outside the turn: the device waits for its update.
			if (error instanceof UpdateRequiredError && this.state.name !== "update") {
				this.#set({ name: "update", minimum: error.minimum });
			}
			throw error;
		}
	}

	/**
	 * An edit of the user's message: shown here at once, then sent after the message's changes before it, and its answer's
	 * entry applied. Without an answer it's kept, and goes again later and at the next start; refused for good, it's told.
	 */
	editMessage(conversationId: string, messageId: string, text: string): Promise<void> {
		return this.#act(() => this.#sends.change(conversationId, messageId, text));
	}

	/** A deletion of the user's message, for everyone: done here at once, sent, and its answer's entry applied. */
	deleteMessage(conversationId: string, messageId: string): Promise<void> {
		return this.#act(() => this.#sends.change(conversationId, messageId, null));
	}

	/**
	 * The person's Dismiss of a message the API never took, by the nonce they sent it with, whatever the device's state:
	 * ready, its conversation's queue is read first, as a message it settles went. The API's ID of a message that went
	 * after all, whose copy the views show in its place; else null.
	 */
	async discardMessage(conversationId: string, nonce: string): Promise<string | null> {
		return (await this.#queue(() => this.#sends.discard(conversationId, nonce, this.state.name === "ready"))) ?? null;
	}

	/**
	 * A file of a message, its sealed bytes opened by this device's core with the key its message gives it, part by part
	 * («Adjuntos»): files.ts' openSealed checks what it opens to. Outside the engine's turn, as it changes nothing.
	 */
	openFile(key: string, attachmentId: string, sealed: Blob, progress?: (done: number) => void): Promise<Blob> {
		return this.#parts.host.openFile(key, attachmentId, sealed, progress);
	}

	/**
	 * What the conversations' sends do now, settled: their requests run outside the engine's turn, so what the turn took
	 * on can still be sending after it. A test's wait (testing/engines.ts' turnEnded).
	 */
	sendsSettled(): Promise<void> {
		return this.#sends.settled();
	}

	/** A file of a message that didn't open, or opened to other bytes than its message says: counted (decision 40). */
	fileFailed(): void {
		this.#failures.note("attachment");
	}

	/** The names of the files whose messages this device holds, by their IDs (Ruling 31): Settings → Attachments'. */
	fileNames(): Promise<Map<string, string>> {
		return fileNames(this.#parts.host);
	}

	/** What the device's database shows of these messages of the conversation: a row for each it holds. */
	messages(conversationId: string, ids: string[]): Promise<ShownMessage[]> {
		return shownMessages(this.#parts.host, conversationId, ids);
	}

	/**
	 * What the views read of these messages of the conversation: the device's rows, and how far its queue is applied this
	 * session, taken first, so a row the read doesn't find past it is one not applied yet (drawn as loading).
	 */
	async read(conversationId: string, ids: string[]): Promise<{ rows: ShownMessage[]; through?: number | null }> {
		const through = this.#groups.through(conversationId);
		return { rows: await shownMessages(this.#parts.host, conversationId, ids), through };
	}

	/** Whether the device holds a message of the conversation older than this number, which its list pages on to. */
	heldBefore(conversationId: string, seq: number): Promise<boolean> {
		return heldBefore(this.#parts.host, conversationId, seq);
	}

	/** The person's messages of the conversation still being sent, in their order, with what goes with them. */
	pendingMessages(conversationId: string): Promise<Pending[]> {
		return this.#sends.pending(conversationId);
	}

	/** The person's tap on Restart encryption, over a blocked group they may restart. */
	restartGroup(conversationId: string): Promise<void> {
		return this.#queue(() => this.#whenReady(() => this.#groups.restart(conversationId)));
	}

	/** The person's yes to a conversation's members of today, which its record from before the cutover didn't have. */
	acceptMembers(conversationId: string): Promise<void> {
		return this.#queue(() => this.#whenReady(() => this.#groups.accept(conversationId)));
	}

	/** Starts: hears the gateway's events, then runs «Arranque». It settles when the start's flow ended, whatever state. */
	start(): Promise<void> {
		this.#unlisten ??= this.#parts.events.listen((event) => this.#heard(event));
		return this.#queue(() => this.#boot());
	}

	/** Stops hearing and waiting, lets the flow under way end, and closes the core: its database stays (decision 13). */
	async stop(): Promise<void> {
		this.#stopped = true;
		this.#unlisten?.();
		this.#unlisten = null;
		this.#retry?.();
		this.#daily?.();
		this.#groups.stop();
		this.#sends.stop();
		this.#failures.stop();
		await this.#turn;
		await this.#parts.host.close();
	}

	/**
	 * The person's tap on a first device: create_identity, whose recovery key the views show next. On the desktop Bun
	 * asks in its own box first (Ruling 6), and a no (`refused`) means not yet: nothing changes.
	 */
	makeIdentity(): Promise<void> {
		return this.#queue(async () => {
			const { state } = this;
			if (state.name !== "first_device" || !(await this.#stillFirst())) return;
			try {
				this.#made = await this.#parts.host.handle<IdentityMade>({ cmd: "create_identity" });
			} catch (error) {
				if (error instanceof CoreError && error.code === "refused") return;
				throw error;
			}
			this.#set({ name: "first_device", recoveryKey: this.#made.recovery_key, finishing: state.finishing });
		});
	}

	/**
	 * The person saved the recovery key: the identity goes up, and only once the API took it is it confirmed. A refusal or
	 * a lost answer rejects, the key still shown, and the same bytes go next time; another first device's identity there
	 * (409) has this one start over as a new device (Ruling 26).
	 */
	keySaved(): Promise<void> {
		return this.#queue(async () => {
			const made = this.#made;
			if (!made || this.state.name !== "first_device") return;
			let published: boolean;
			try {
				published = await publishIdentity(this.#parts, made);
			} catch (error) {
				// Too old a client to upload it: the update says so, and the core keeps the identity for the upload.
				if (!(error instanceof UpdateRequiredError)) throw error;
				this.#made = null;
				return this.#set({ name: "update", minimum: error.minimum });
			}
			if (!published) return this.#startOver();
			// Published and confirmed: the key's sheet is done with, and the start's last steps follow.
			this.#made = null;
			this.#set({ name: "starting" });
			await this.#settle().catch((error: unknown) => this.#failed(error));
		});
	}

	/**
	 * The person closes the key's sheet after its upload failed, its key saved: the upload waits for Finish, which
	 * brings the same key and bytes back, as the core keeps them until identity_uploaded.
	 */
	uploadLater(): Promise<void> {
		return this.#queue(async () => {
			if (this.state.name !== "first_device" || !this.state.recoveryKey) return;
			this.#made = null;
			this.#set({ name: "first_device", recoveryKey: null, finishing: true });
		});
	}

	/**
	 * This installation starts again as a new device: what a removed device, or one whose key is lost, does on the
	 * person's word. Only from those states, whatever a stale tap asks: elsewhere its database is in use.
	 */
	startOver(): Promise<void> {
		return this.#queue(async () => {
			const { state } = this;
			if (state.name === "removed" || (state.name === "failed" && state.lostKey)) await this.#startOver();
		});
	}

	/**
	 * Whether this device is still its user's first: the API serves no identity, or its own (an upload cut before its
	 * answer). Another's served, the user was set up elsewhere, and a key made here would open nothing: the device
	 * becomes a new one, by starting over when it made an identity the core can't undo (Ruling 26).
	 */
	async #stillFirst(): Promise<boolean> {
		const served = await servedIdentity(this.#parts);
		if (!served) return true;
		const status = await coreStatus(this.#parts.host);
		if (served.identity_key === status.identity_key) return true;
		if (status.has_identity) await this.#startOver();
		else this.#set({ name: "new_device" });
		return false;
	}

	#set(state: EngineState) {
		this.state = state;
		for (const listener of this.#listeners) listener(state);
	}

	/** Runs `work` once the flow before it ended (nothing once stopped). What it throws rejects this call alone. */
	#queue<T>(work: () => Promise<T>): Promise<T | undefined> {
		const run = this.#turn.then(() => (this.#stopped ? undefined : work()));
		this.#turn = run.then(
			() => {},
			(error: unknown) => console.error("[e2e] The engine's work failed:", error),
		);
		return run;
	}

	/**
	 * The person's act on a conversation's messages, in the engine's turn: refused while this device isn't ready, or once
	 * the engine stopped; a client too old for it waits for its update.
	 */
	async #act<T>(work: () => Promise<T>): Promise<T> {
		const done = await this.#queue(async () => {
			// A code of its own, which crosses to another tab, for the view to say it (#508).
			if (this.state.name !== "ready")
				throw new CoreError("not_ready", "encrypted conversations aren't ready on this device");
			try {
				return { value: await work() };
			} catch (error) {
				if (error instanceof UpdateRequiredError) this.#set({ name: "update", minimum: error.minimum });
				throw error;
			}
		});
		if (!done) throw new Error("the encryption engine stopped");
		return done.value;
	}

	/** Work an event asks for: what fails is logged, and goes again with the next event that asks for it. */
	#soon(work: () => Promise<void>) {
		this.#queue(work).catch(() => {});
	}

	/** Conversations' work, only while this device is ready: a client too old for it waits for its update. */
	async #whenReady(work: () => Promise<void>): Promise<void> {
		if (this.state.name !== "ready") return;
		try {
			await work();
		} catch (error) {
			if (!(error instanceof UpdateRequiredError)) throw error;
			this.#set({ name: "update", minimum: error.minimum });
		}
	}

	#heard(event: EngineEvent) {
		const own = (device: string) => device === this.#device;
		// A conversation's entries only while ready: before, the queue has them all, which the start reads.
		if (this.state.name === "ready") this.#groups.heard(event);
		switch (event.type) {
			case "READY":
				// A new gateway session: a start that failed goes again now, and the inbox and the conversations' queues may
				// have filled meanwhile.
				if (this.#retry) {
					this.#retry();
					this.#retry = null;
					this.#soon(() => this.#boot());
				} else if (this.#device) {
					this.#soon(() => this.#inbox());
					this.#soon(() => this.#whenReady(() => this.#groups.all()));
					// What waits to be sent goes once the queues are applied («Enviar»).
					this.#soon(() => this.#whenReady(() => this.#sends.resendAll()));
				}
				break;
			case "DM_MESSAGE_CREATE":
				// The person's message made again goes under a new nonce, which only the engine knows it by.
				this.#sends.heard(event.data);
				break;
			case "DEVICE_MESSAGE":
				if (own(event.data.device_id)) this.#soon(() => this.#inbox());
				break;
			case "KEY_PACKAGES_LOW":
				if (own(event.data.device_id)) this.#soon(() => this.#keyPackages());
				break;
			case "DEVICE_REMOVE":
				if (own(event.data.device_id)) this.#set({ name: "removed" });
				break;
			case "IDENTITY_UPDATE":
				// The user's own: another device changed the list or the keys, which may leave this one off it, or
				// published the identity this first device was to make, if it hasn't shown a key yet.
				if (event.data.user_id !== this.#parts.user) break;
				this.#soon(async () => {
					const { state } = this;
					// Ready, the device's own list may now leave out a device that still has leaves: the groups say whether
					// a commit is due to take them out.
					if (state.name === "ready") {
						this.#set(await this.#identity());
						await this.#whenReady(() => this.#groups.all());
					} else if (state.name === "first_device" && !state.recoveryKey) await this.#stillFirst();
				});
				break;
		}
	}

	/** Step 5, with the inbox for a rotation's transfer this device may need first. */
	#identity(): Promise<EngineState> {
		return identityState(this.#parts, () => takeInbox(this.#parts, this.#tries, this.#failures));
	}

	/** The inbox; once it brought a rotation's transfer, the own user observed, which may change what this device is. */
	async #inbox(): Promise<void> {
		if (await takeInbox(this.#parts, this.#tries, this.#failures)) this.#set(await this.#identity());
	}

	/** «Arranque»: the API's configuration, the user's database, this installation's device and the session bound to it. */
	async #boot(): Promise<void> {
		const parts = this.#parts;
		try {
			const { external_sender, cutover_at } = await parts.api.config();
			this.cutoverAt = cutover_at;
			this.#pinned = pinnedSender(parts.store, external_sender, this.#pinned);
			this.#groups.start(this.#pinned);
			const opened = await parts.host.open(parts.user);
			if (opened.state !== "ready") return this.#closed(opened);
			const { status, keys } = await ownDevice(parts);
			const device = status.device_id;
			const bound = device && (await bindSession(parts, device, keys).catch(refusedForGood));
			if (bound === null) return this.#set({ name: "failed", lostKey: false });
			if (!device || !bound) return this.#set({ name: "removed" });
			this.#device = device;
			parts.registered(device);
			this.#retries = 0;
			// An identity made before the app closed, still waiting for its upload: the same command gives it again, its
			// recovery key with it, from the person's tap as the first time (step 4).
			if (status.waiting_upload === "create_identity") {
				return this.#set({ name: "first_device", recoveryKey: null, finishing: true });
			}
			await this.#settle();
		} catch (error) {
			this.#failed(error);
		}
	}

	/** A start that failed: a client too old waits for its update; anything else goes again later. */
	#failed(error: unknown) {
		if (error instanceof UpdateRequiredError) return this.#set({ name: "update", minimum: error.minimum });
		console.error("[e2e] The engine didn't start:", error);
		this.#later();
	}

	/**
	 * Steps 5 to 7: what the user's identity makes of this device, the inbox, then a listed device's conversations' queues,
	 * before its key packages, so a welcome waiting there takes its keys before key_packages lets them go, and those the
	 * person opened before it was ready; then the leaf renewals due («Lo periódico»), as every day after.
	 */
	async #settle(): Promise<void> {
		const state = await this.#identity();
		this.#set(state);
		await this.#inbox();
		if (this.state.name !== "ready") return;
		await this.#whenReady(() => this.#groups.all());
		for (const id of [...this.#toOpen]) {
			this.#toOpen.delete(id);
			await this.#whenReady(() => this.#groups.open(id)).catch((error: unknown) => {
				console.error("[e2e] A conversation's group didn't open:", error);
			});
		}
		// What waits to be sent goes once the queues are applied, before anything new («Enviar»).
		await this.#whenReady(() => this.#sends.resendAll());
		await this.#keyPackages();
		await this.#whenReady(() => this.#groups.renew()).catch((error: unknown) => {
			console.error("[e2e] The leaf renewals wait for tomorrow's:", error);
		});
		this.#daily ??= this.#everyDay();
	}

	/** Uploads the key packages: nothing while this device isn't on the list, which the API refuses (e2eListed). */
	async #keyPackages(): Promise<void> {
		if (this.state.name === "ready") await uploadKeyPackages(this.#parts);
	}

	#everyDay(): () => void {
		return this.#parts.clock.later(DAY, () => {
			this.#daily = this.#everyDay();
			this.#soon(() => this.#keyPackages());
			this.#soon(() => this.#whenReady(() => this.#groups.renew()));
		});
	}

	/** The core didn't open: unsupported for good, a lost key until the person starts over, anything else again later. */
	#closed(opened: HostOpened) {
		if (opened.state === "unsupported") return this.#set({ name: "unsupported" });
		const lostKey = opened.state === "failed" && opened.reason === "bad_key";
		this.#set(opened.state === "locked" ? { name: "locked" } : { name: "failed", lostKey });
		if (!lostKey) this.#later();
	}

	/** The start goes again after a while, or at the next READY. */
	#later() {
		const ms = Math.min(RETRY_MOST_MS, RETRY_MS * 2 ** this.#retries++);
		this.#retry = this.#parts.clock.later(ms, () => {
			this.#retry = null;
			this.#soon(() => this.#boot());
		});
	}

	/**
	 * This installation as a new device (Ruling 26): its database destroyed with its key, then a new device registered,
	 * which this session binds to, and only then the old one's registration deleted, as deleting it ends its sessions.
	 * A device still on the list can't be deleted (409): another device of the user's takes it off.
	 */
	async #startOver(): Promise<void> {
		const { api, host, user, store } = this.#parts;
		const old = (await api.devices()).find((device) => device.current)?.id ?? null;
		await host.destroy(user);
		for (const key of DEVICE_RECORD) store.write(key, null);
		this.#made = null;
		this.#device = null;
		this.#tries.clear();
		this.#groups.forget();
		this.#sends.stop();
		this.#daily?.();
		this.#daily = null;
		this.#set({ name: "starting" });
		await this.#boot();
		// Not before the session is bound to the new device: it would end with the old one.
		if (!old || !this.#device || old === this.#device) return;
		await api.deleteDevice(old).catch((error: unknown) => {
			const status = statusOf(error);
			if (status !== 404 && status !== 409) throw error;
		});
	}
}
