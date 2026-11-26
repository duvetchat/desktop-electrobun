// The encryption engine (PLAN-E2E-CLIENTES.md, «El motor»): it carries what the core makes to the API and what the API
// hands out to the core, never opening or making anything itself. A class with its parts given to it, so the app has
// one (lib/e2e/engine.svelte.ts) and a test as many as it needs, each with its own core, session and gateway connection.
//
// Its work goes one flow at a time, in the order it came: the start («Arranque», steps 1 to 7), the person's taps, and
// what the gateway's events ask for. bootstrap.ts, identity.ts, key-packages.ts and inbox.ts hold the steps, sync.ts
// each conversation's queue and group; this class keeps the state the views read, and what's due later.
import { FetchError, UpdateRequiredError, type UploadOptions } from "$lib/api/api";
import type { Conversation, ConversationMember, DirectMessage } from "$lib/api/conversations";
import type { E2eApi, NewConversationRequest } from "$lib/api/e2e";
import { CoreError } from "../errors";
import type { EngineEvent, EngineEvents } from "../events";
import type { CoreHost, HostOpened } from "../host";
import type { UserDevice } from "$lib/types";
import { bindSession, coreStatus, ownDevice } from "./bootstrap";
import { heldBefore, shownMessages, type ShownMessage } from "./content";
import {
	addedToTell,
	confirmKeys,
	devicesAlong,
	inactiveToTell,
	makeKeys,
	publishKeys,
	removeDevice,
	type KeysMade,
} from "./devices";
import { Approvals, type ApprovalRole, type DeviceApproval, type DeviceSetup } from "./approval";
import { Contacts, type ContactsShown, type KeyChange, type SafetyNumber, type ShownChange } from "./contacts";
import { Failures } from "./failures";
import { fileNames } from "./files";
import {
	firstListWaits,
	identityState,
	observeUsers,
	publishIdentity,
	servedIdentity,
	withIdentities,
	type IdentityMade,
} from "./identity";
import { takeInbox } from "./inbox";
import { uploadKeyPackages } from "./key-packages";
import { checkRoom } from "./members";
import { checkRecoveryKey, putFirstList, recoverIdentity, type FirstList } from "./recover";
import { searchDevice, type DeviceFound, type DeviceSearch } from "./search";
import { Sends, type Outgoing, type Pending } from "./send";
import { makeReset, replacedByReset } from "./start-over";
import { DEVICE_RECORD, EXTERNAL_SENDER, KEPT_RESET, TOLD_ADDED, TOLD_INACTIVE, type EngineStore } from "./store";
import { Conversations, type ConversationState } from "./sync";

export type { ConversationState } from "./sync";
export type { DeviceApproval, DeviceSetup } from "./approval";
export type { Outgoing, Pending } from "./send";
export type { OutgoingFile } from "./files";
export type { ShownMessage } from "./content";
export type { ContactsShown, KeyChange, SafetyNumber, ShownChange } from "./contacts";

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
	/** The time now, in ms since the epoch. */
	now(): number;
}

export const systemClock: Clock = {
	now: () => Date.now(),
	later(ms, run) {
		const timer = setTimeout(run, ms);
		return () => clearTimeout(timer);
	},
};

/** What the engine tells of the user's devices (decisions 13 and 52), each device once: one added to their account, and
 * one not seen in 45 days. */
export interface DeviceNotice {
	kind: "added" | "inactive";
	device: UserDevice;
}

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
	/**
	 * The engine's contacts (contacts.ts), set by the engine itself: what the core answers of each other user observed,
	 * whichever flow observes them (identity.ts' observeUsers), and whose changed key holds what goes to them.
	 */
	contacts?: Contacts;
}

/**
 * What the views show (PLAN-E2E-CLIENTES.md, «El motor», its states). A first device waits for the person's tap to
 * make its identity, then shows its recovery key (`recoveryKey`) until it's saved; `finishing` when an identity it made
 * before the app closed still waits for its upload. A ready device changing its keys (Task 24) shows their new recovery
 * key the same way (`rotation`), or, with none, one made before the app closed that the person's Finish brings back;
 * `stuck`, one that can't finish, as another device took off a device it keeps or changed the keys first.
 * `failed` with `lostKey` is a database its key no longer opens.
 */
export type EngineState =
	| { name: "starting" }
	| { name: "first_device"; recoveryKey: string | null; finishing: boolean }
	| { name: "new_device"; setup?: DeviceSetup }
	| { name: "ready"; rotation?: { recoveryKey: string | null; stuck?: true }; approval?: DeviceApproval }
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
	/** What rotate_keys answered, until it's uploaded: never kept elsewhere, as the core runs the same change again. */
	#keys: KeysMade | null = null;
	/** The change of keys under way can't finish (stuckKeys): until the core lets it go, Finish says so. */
	#stuck = false;
	/** This installation's device, as its database names it, whether or not the session is bound to it yet. */
	#self: string | null = null;
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
	readonly #deviceListeners = new Set<(notice: DeviceNotice) => void>();
	/** A new device's approval, and the approvals this device takes part in for the user's new ones (Task 26). */
	readonly #approvals: Approvals;
	/** A new device whose core holds an identity already: starting over's, until its upload, or one whose first list
	 * hasn't gone up (Task 26). */
	#setup: Extract<DeviceSetup, { way: "reset" | "finishing" }> | null = null;
	/** The identity the start over under way replaces (also kept in the record, which a later start reads). */
	#replaces: string | null = null;
	/** The person's contacts: whom they verified, and their changed keys (Task 28). */
	readonly #contacts: Contacts;
	readonly #contactListeners = new Set<() => void>();

	constructor(given: EngineParts) {
		this.#contacts = new Contacts(given.store, given.user, () => {
			for (const listener of this.#contactListeners) listener();
		});
		const parts: EngineParts = { ...given, contacts: this.#contacts };
		this.#parts = parts;
		this.#approvals = new Approvals(
			parts,
			(work) => this.#soon(work),
			() => this.#set(this.state),
		);
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
		this.#sends = new Sends(
			parts,
			this.#groups,
			soon,
			(work) => this.#act(work),
			(work) => this.#queue(work),
			{
				changed: messagesChanged,
				sent: (id, nonce, message) => {
					for (const listener of this.#sentListeners) listener(id, nonce, message);
				},
				refused: (id, message, kind) => {
					for (const listener of this.#refusedListeners) listener(id, message, kind);
				},
				// A verified contact's changed key holds what goes to their conversations until the person's yes: whom the
				// group holds here, with those the API lists (review, I1).
				held: async (id) => this.#contacts.holding(await this.#groups.people(id)),
			},
		);
	}

	/** What the views show of the person's contacts (contacts.ts): their changed keys, and whom they verified. */
	contacts(): ContactsShown {
		return this.#contacts.shown();
	}

	/** Each change of what the views show of the person's contacts. */
	onContacts(listener: () => void): () => void {
		this.#contactListeners.add(listener);
		return () => void this.#contactListeners.delete(listener);
	}

	/**
	 * Whether the person verified the user, as this device's core holds them once it observed them as the API serves them
	 * now: a changed key leaves its notice, and one the core refuses changes nothing. False for one the API serves no
	 * identity of, and before this device is ready.
	 */
	async contact(userId: string): Promise<boolean> {
		// One that fails (logged by the turn) leaves what the core held before.
		await this.#queue(() => this.#whenReady(() => observeUsers(this.#parts, [userId]))).catch(() => {});
		return this.#contacts.shown().verified[userId] ?? false;
	}

	/**
	 * The security number with a contact (decision 25): its 60 digits in 12 groups of 5, and its QR's text, the core's
	 * `qr` as it gives it, which the other's phone scans (e2e-conventions.json's safety_qr). The contact is observed as
	 * the API serves them first, so the number is of the identity they have now; one the core refuses leaves the number
	 * of the identity this device holds of them.
	 */
	safetyNumber(userId: string): Promise<SafetyNumber> {
		return this.#act(async () => {
			await observeUsers(this.#parts, [userId]).catch((error: unknown) => {
				console.warn("[e2e] A contact wasn't observed before their security number:", error);
			});
			return this.#safetyNumber(userId);
		});
	}

	/**
	 * The person marks the contact verified, having compared these digits with theirs: only while they're still the
	 * number the core holds, read again in the same turn, so a key that changed meanwhile is never verified unseen.
	 * Whether they're verified now.
	 */
	verifyContact(userId: string, digits: string): Promise<boolean> {
		return this.#act(async () => {
			if ((await this.#safetyNumber(userId)).digits !== digits) return false;
			const { host } = this.#parts;
			// The digits go along: on the desktop, Bun's own box names them, and marks by the QR of that number (Ruling 6).
			const { verified } = await host.handle<{ verified: boolean }>({ cmd: "verify_user", user_id: userId, digits });
			this.#contacts.verifiedNow(userId, verified);
			// Verifying the new number is a yes too (review, Minor 7).
			if (verified) this.#released();
			return verified;
		});
	}

	/**
	 * The changed keys of the conversation's people (Task 28's review, I1): the users its group holds on this device,
	 * members and leaves, with those the API lists, as a server could list it without someone its group still holds.
	 */
	keyChangesIn(conversationId: string): Promise<Record<string, KeyChange>> {
		return this.#act(async () => {
			const { changes } = this.#contacts.shown();
			const people = await this.#groups.people(conversationId);
			return Object.fromEntries(people.flatMap((user) => (changes[user] ? [[user, changes[user]]] : [])));
		});
	}

	/** The person closes the notice of the contact's change they were shown: it shows no more, wherever it showed. */
	async closeKeyChange(userId: string, change: string): Promise<void> {
		this.#contacts.close(userId, change);
	}

	/**
	 * The person's yes to sending, the changes they were shown known (decision 25): what waited for it goes, as at a
	 * READY.
	 */
	async confirmKeyChanges(changes: ShownChange[]): Promise<void> {
		this.#contacts.confirm(changes);
		this.#released();
	}

	/** What waited for the person's yes goes: messages and edits, as at a READY, and the catch-ups held for it. */
	#released() {
		this.#soon(() => this.#whenReady(() => this.#sends.resendAll()));
		this.#groups.ready();
	}

	/** The core's security number with the contact, as it holds them now: observed first when it asks. */
	#safetyNumber(userId: string): Promise<SafetyNumber> {
		const { host } = this.#parts;
		return withIdentities(this.#parts, () => host.handle<SafetyNumber>({ cmd: "safety_number", user_id: userId }));
	}

	/** What the engine tells of the user's devices, as it comes: each device once. */
	onDevice(listener: (notice: DeviceNotice) => void): () => void {
		this.#deviceListeners.add(listener);
		return () => void this.#deviceListeners.delete(listener);
	}

	/**
	 * The person's removal of another device of theirs (Settings → Devices): by its registration when it's off the list,
	 * by a list without it when it's on it, or, for one that was lost (`changeKeys`), with new keys whose recovery key the
	 * views show next. On the desktop Bun asks in its own box first, and its no changes nothing.
	 */
	removeDevice(deviceId: string, { changeKeys = false }: { changeKeys?: boolean } = {}): Promise<void> {
		return this.#act(async () => {
			// A list now would be the new identity's, which the API doesn't have yet.
			if (this.state.name === "ready" && this.state.rotation)
				throw new Error("the change of keys under way goes first");
			this.#holdForApproval();
			const device = (await this.#parts.api.devices()).find(({ id }) => id === deviceId);
			if (!device) return;
			if (device.current) throw new Error("this device goes with its data, never by its own list");
			if (changeKeys && device.listed) return this.#makeKeys([deviceId]);
			try {
				await removeDevice(this.#parts, device);
			} catch (error) {
				if (!(error instanceof CoreError && error.code === "refused")) throw error;
			}
		});
	}

	/**
	 * The person's Change security keys (rotate_keys), taking off the devices `remove` names, or Finish of a change made
	 * before the app closed, which is that one again: its recovery key, which the views show next, goes up once saved.
	 */
	changeKeys(remove: string[] = []): Promise<void> {
		return this.#act(() => {
			this.#holdForApproval();
			return this.#makeKeys(remove);
		});
	}

	/**
	 * A device this one approved hasn't put up its list yet (task 24's review, M2): it has no certificate of the identity
	 * until then, so a list or a change of keys now would leave it out, and its own list would lose to it (409).
	 */
	#holdForApproval() {
		if (this.#approvals.holds()) {
			throw new CoreError("approval_waits", "a device this one approved hasn't put up its list yet");
		}
	}

	/**
	 * The devices of the user's that a list of this device's the API never took leaves out (M3): the next list or change
	 * of keys takes them along, which the page names before it asks.
	 */
	alsoRemoved(): Promise<string[]> {
		return this.#act(() => devicesAlong(this.#parts));
	}

	/**
	 * This device's data deleted, on the person's word (decision 13): its database with its key, then its record, and
	 * the engine does nothing more; then its registration, when it's off the list, which the API takes away. The page
	 * signs out after. On the list, it stays there for the user's other devices to take off, as the API takes no list
	 * without the session's device. The database goes first: a deletion that can't take it leaves the device as it was,
	 * its session too, for the person to try again.
	 */
	removeThisDevice(): Promise<void> {
		return this.#queue(async () => {
			const { api, host, store, user } = this.#parts;
			const device = this.#device;
			const unlisted =
				device !== null &&
				(await api.devices().then(
					(own) => own.some(({ current, listed }) => current && !listed),
					(error: unknown) => {
						console.error("[e2e] This device's registration wasn't read:", error);
						return false;
					},
				));
			await host.destroy(user);
			for (const key of [...DEVICE_RECORD, TOLD_INACTIVE, TOLD_ADDED]) store.write(key, null);
			this.#contacts.forget();
			this.#halt();
			this.#made = null;
			this.#keys = null;
			this.#stuck = false;
			this.#setup = null;
			this.#replaces = null;
			this.#set({ name: "starting" });
			if (!unlisted || !device) return;
			await api.deleteDevice(device).catch((error: unknown) => {
				console.error("[e2e] This device's registration stays for the user's other devices to take off:", error);
			});
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
	 * The person opened the conversation: its group goes on, or is made here when it has none and this user may, and its
	 * members without a device are asked for («Quien no tenía dispositivo»). Before this device is ready, it opens once
	 * it is.
	 */
	openConversation(conversationId: string): Promise<void> {
		return this.#queue(async () => {
			if (this.state.name !== "ready") return void this.#toOpen.add(conversationId);
			await this.#whenReady(() => this.#open(conversationId));
		});
	}

	/**
	 * The person's new DM or group (PLAN-E2E-CLIENTES.md, Task 22): the API makes the conversation, then this device its
	 * group at once, as any member of a DM and a group's owner may; one past 20 members, its owner among them, is refused
	 * before anything is asked. Before this device is ready, its group is made once it is. The API's conversation.
	 */
	async createConversation(made: NewConversationRequest): Promise<Conversation> {
		if (made.type === 2) checkRoom(new Set([this.#parts.user, ...made.user_ids]).size);
		let conv: Conversation;
		try {
			conv = await this.#parts.api.createConversation(made);
		} catch (error) {
			if (error instanceof UpdateRequiredError && this.state.name !== "update") {
				this.#set({ name: "update", minimum: error.minimum });
			}
			throw error;
		}
		await this.openConversation(conv.id).catch((error: unknown) => {
			console.error("[e2e] The new conversation's group waits for its next open:", error);
		});
		return conv;
	}

	/** The owner's addition of a user to a group, one commit of exactly that user (sync.ts' add): the member added. */
	addMember(conversationId: string, userId: string): Promise<ConversationMember> {
		return this.#act(() => this.#groups.add(conversationId, userId));
	}

	/** The owner's removal of a member of a group, one commit that takes them and their devices out. */
	removeMember(conversationId: string, userId: string): Promise<void> {
		return this.#act(() => this.#groups.remove(conversationId, userId));
	}

	/** The person leaves a group, with the statement this device signs: a member's commit takes them out later. */
	leaveConversation(conversationId: string): Promise<void> {
		return this.#act(() => this.#groups.leave(conversationId));
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
		// Its request out stops first, outside the turn, which its `sent` takes: a message the API took is bound (N1).
		const took = await this.#sends.stopDelivery(nonce);
		const went = await this.#queue(() => this.#sends.discard(conversationId, nonce, this.state.name === "ready"));
		return took ?? went ?? null;
	}

	/**
	 * A file of a message, its sealed bytes opened by this device's core with the key its message gives it, part by part
	 * («Adjuntos»): files.ts' openSealed checks what it opens to. Outside the engine's turn, as it changes nothing.
	 */
	openFile(key: string, attachmentId: string, sealed: Blob, progress?: (done: number) => void): Promise<Blob> {
		return this.#parts.host.openFile(key, attachmentId, sealed, progress);
	}

	/**
	 * What the conversations' sends and catch-ups do now, settled: their requests run outside the engine's turn, so what
	 * the turn took on can still be sending after it. A test's wait (testing/engines.ts' turnEnded).
	 */
	sendsSettled(): Promise<void> {
		return Promise.all([this.#sends.settled(), this.#groups.settled()]).then(() => {});
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

	/** A page of what this device's own search finds of its conversations' messages (engine/search.ts). */
	search(request: DeviceSearch): Promise<DeviceFound> {
		return searchDevice(this.#parts.host, request);
	}

	/** The person's messages of the conversation still being sent, in their order, with what goes with them. */
	pendingMessages(conversationId: string): Promise<Pending[]> {
		return this.#sends.pending(conversationId);
	}

	/**
	 * The person's tap on Restart encryption, over a blocked group they may restart: whom it would leave out, that the
	 * person hasn't confirmed yet (`leaving`), and nothing restarted while there are some; else it restarts, and answers
	 * none.
	 */
	async restartGroup(conversationId: string, leaving: readonly string[] = []): Promise<string[]> {
		const out = await this.#queue(async () => {
			if (this.state.name !== "ready") return [];
			return this.#groups.restart(conversationId, leaving);
		});
		return out ?? [];
	}

	/** The person's yes to a conversation's members of today, which its record from before the cutover didn't have. */
	acceptMembers(conversationId: string): Promise<void> {
		return this.#queue(() => this.#whenReady(() => this.#groups.accept(conversationId)));
	}

	/**
	 * A new device set up with the person's recovery key (Task 26), typed as they like, spaces and dashes too: a mistyped
	 * one is the core's refusal (`bad_command` `recovery_key`) before the API is asked for anything; one that doesn't open
	 * the identity is `decrypt_failed`. Then the device's first list goes up, and it's ready.
	 */
	recover(recoveryKey: string): Promise<void> {
		return this.#queue(async () => {
			if (!this.#isNew()) return;
			await checkRecoveryKey(this.#parts, recoveryKey);
			await recoverIdentity(this.#parts, recoveryKey);
			// One way per attempt: an approval under way is over.
			this.#approvals.end();
			await this.#listThisDevice(false);
		});
	}

	/** The person sets this new device up: an approval's attempt begins, shown as its QR (approval.ts). */
	beginApproval(): Promise<void> {
		return this.#queue(async () => {
			if (this.#isNew()) await this.#approvals.begin();
		});
	}

	/** The person's «Use a code instead»: an attempt by the code, its commitment to the user's listed devices. */
	useCode(): Promise<void> {
		return this.#queue(async () => {
			if (this.#isNew()) await this.#approvals.useCode();
		});
	}

	/** The code the person typed, from the approving device's screen: accepted, a transfer kept for it is taken. */
	acceptCode(code: string): Promise<void> {
		return this.#queue(async () => {
			if (this.#isNew() && (await this.#approvals.accept(code))) await this.#takeApprovals();
		});
	}

	/** The setup's card closed: the attempt shows no more, and no new QR is made. */
	endApproval(): Promise<void> {
		return this.#queue(async () => this.#approvals.end());
	}

	/**
	 * The person's start over (decision 47), after the page's warning: a new identity in the place of the one the API
	 * serves, its recovery key shown next, which goes up once saved (keySaved). On the desktop Bun asks in its own box
	 * first, and its no changes nothing.
	 */
	resetIdentity(): Promise<void> {
		return this.#queue(async () => {
			if (!this.#isNew()) return;
			const served = await servedIdentity(this.#parts);
			if (!served) return;
			try {
				this.#made = await makeReset(this.#parts, served.identity_key, false);
			} catch (error) {
				if (error instanceof CoreError && error.code === "refused") return;
				throw error;
			}
			this.#replaces = served.identity_key;
			this.#approvals.end();
			this.#setup = { way: "reset", recoveryKey: this.#made.recovery_key, finishing: false };
			this.#set({ name: "new_device" });
		});
	}

	/**
	 * The person's Finish on a new device whose setup waits: its first list (signed without the devices the API took
	 * away, on the desktop after Bun's box), or starting over's recovery key again, made before the app closed.
	 */
	finishSetup(): Promise<void> {
		return this.#queue(async () => {
			if (this.state.name !== "new_device") return;
			const setup = this.#setup;
			if (setup?.way === "finishing") return this.#listThisDevice(true);
			const replaces = this.#replaces;
			if (setup?.way !== "reset" || !setup.finishing || !replaces) return;
			try {
				this.#made = await makeReset(this.#parts, replaces, true);
			} catch (error) {
				if (error instanceof CoreError && error.code === "refused") return;
				throw error;
			}
			this.#setup = { way: "reset", recoveryKey: this.#made.recovery_key, finishing: true };
			this.#set({ name: "new_device" });
		});
	}

	/**
	 * The person's yes to «Is this device yours?»: this device offers to approve it (never without it). Its identity
	 * replaced meanwhile, its inbox goes first, which may bring the change of keys' transfer, and the yes is tried again.
	 */
	approveDevice(deviceId: string): Promise<void> {
		return this.#queue(async () => {
			if (this.#role() !== "approver") return;
			if ((await this.#approvals.approve(deviceId)) === "replaced") {
				await this.#inbox();
				if (this.#role() !== "approver" || (await this.#approvals.approve(deviceId)) === "replaced") return;
			}
			// A reveal kept from before the app started again: taken now.
			await this.#approvals.take("approver");
		});
	}

	/** The person's no: the new device's request goes, and another one waiting its turn is asked. */
	declineDevice(deviceId: string): Promise<void> {
		return this.#queue(async () => {
			this.#approvals.decline(deviceId);
			await this.#takeApprovals();
		});
	}

	/**
	 * The person's Confirm, once the new device accepted the code: on the desktop Bun asks in its own box first, its no
	 * keeping the code shown; then the transfer goes, and this device's lists and keys wait for the new device's list.
	 */
	confirmApproval(deviceId: string): Promise<void> {
		return this.#queue(async () => {
			if (this.#role() !== "approver") return;
			await this.#approvals.confirm(deviceId);
			await this.#takeApprovals();
		});
	}

	/** Starts: hears the gateway's events, then runs «Arranque». It settles when the start's flow ended, whatever state. */
	start(): Promise<void> {
		this.#unlisten ??= this.#parts.events.listen((event) => this.#heard(event));
		return this.#queue(() => this.#boot());
	}

	/** Stops hearing and waiting, lets the flow under way end, and closes the core: its database stays (decision 13). */
	async stop(): Promise<void> {
		this.#halt();
		await this.#turn;
		await this.#parts.host.close();
	}

	/** Nothing more: no event heard, nothing waited for, and no work queued from now on runs. */
	#halt() {
		this.#stopped = true;
		this.#unlisten?.();
		this.#unlisten = null;
		this.#retry?.();
		this.#retry = null;
		this.#daily?.();
		this.#daily = null;
		this.#groups.stop();
		this.#sends.stop();
		this.#failures.stop();
		this.#approvals.stop();
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
			if (this.#keys && this.state.name === "ready") return this.#keysSaved(this.#keys);
			if (this.state.name === "new_device" && this.#setup?.way === "reset") return this.#resetSaved();
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
			const { state } = this;
			// New keys too: their change waits for Finish, which brings the same ones back.
			if (state.name === "ready" && state.rotation?.recoveryKey) {
				this.#keys = null;
				return this.#set({ name: "ready", rotation: { recoveryKey: null } });
			}
			// And starting over's: its upload waits for Finish, which brings the same identity and key back.
			if (state.name === "new_device" && this.#setup?.way === "reset" && this.#setup.recoveryKey) {
				this.#made = null;
				this.#setup = { way: "reset", recoveryKey: null, finishing: true };
				return this.#set({ name: "new_device" });
			}
			if (state.name !== "first_device" || !state.recoveryKey) return;
			this.#made = null;
			this.#set({ name: "first_device", recoveryKey: null, finishing: true });
		});
	}

	/**
	 * New keys (rotate_keys), made once at a time: a change already showing its key goes on. A no in Bun's own box means
	 * not yet, and changes nothing.
	 */
	async #makeKeys(remove: readonly string[]): Promise<void> {
		if (this.#keys) return;
		try {
			this.#keys = await makeKeys(this.#parts, remove);
		} catch (error) {
			if (error instanceof CoreError && error.code === "refused") return;
			// The same change again needs the served certificate of each device it keeps, signed by the identity it
			// replaces: one taken off meanwhile has none, and another device's change signed them all anew (I1).
			const refusedAgain =
				error instanceof CoreError &&
				((error.code === "bad_command" && error.field === "certificates") || error.code === "invalid_signature");
			if (refusedAgain && (await coreStatus(this.#parts.host)).waiting_upload === "rotate_keys") {
				return this.#stuckKeys();
			}
			throw error;
		}
		this.#set({ name: "ready", rotation: { recoveryKey: this.#keys.recovery_key } });
	}

	/**
	 * A change of keys that can't finish (I1): another device took off a device it keeps, or changed the keys first, and
	 * the core runs only the same change again until its upload, refusing another change's transfer meanwhile
	 * (invalid_signature; duvetchat/e2e#49). Only deleting this device's data ends it; the views say so.
	 */
	#stuckKeys() {
		this.#keys = null;
		this.#stuck = true;
		this.#set({ name: "ready", rotation: { recoveryKey: null, stuck: true } });
	}

	/**
	 * The person saved the new recovery key: the keys go up, and only once the API took them are they confirmed. A refusal
	 * or a lost answer rejects, the key still shown, and the same bytes go next time. Another device's change of keys
	 * there first (409) leaves this one unable to finish, unless the inbox's transfer let it go.
	 */
	async #keysSaved(made: KeysMade): Promise<void> {
		try {
			await publishKeys(this.#parts, made);
		} catch (error) {
			if (error instanceof UpdateRequiredError) {
				this.#keys = null;
				return this.#set({ name: "update", minimum: error.minimum });
			}
			// A transfer to a device the API took away, which the same change can't leave out.
			const refusal: unknown = error instanceof FetchError ? error.response?.data?.error : undefined;
			if (
				statusOf(error) === 400 &&
				typeof refusal === "string" &&
				/isn't a registered device of yours/.test(refusal)
			) {
				return this.#stuckKeys();
			}
			if (statusOf(error) !== 409) throw error;
			this.#keys = null;
			await this.#inbox();
			// The API holds another device's keys, whose transfer the core can't take while this change waits: the same
			// bytes are refused every time (I1).
			if ((await coreStatus(this.#parts.host)).waiting_upload === "rotate_keys") return this.#stuckKeys();
		}
		this.#keys = null;
		this.#set(await this.#identity());
		// A new device's request kept while the change waited is asked now.
		await this.#takeApprovals();
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

	/**
	 * A conversation the person opened: its members observed as the API serves them now (a changed key leaves its notice
	 * there), and those without a device asked for once its group goes on.
	 */
	async #open(conversationId: string): Promise<void> {
		await this.#groups.open(conversationId);
		const others = this.#groups.members(conversationId).filter((user) => user !== this.#parts.user);
		await observeUsers(this.#parts, others).catch((error: unknown) => {
			console.warn("[e2e] A conversation's members weren't observed:", error);
		});
		await this.#groups.checkDevices(conversationId);
	}

	#set(state: EngineState) {
		const was = this.state.name;
		this.state = this.#shown(state);
		// Ready again: what the conversations' turns skipped while it wasn't is asked for again (the catch-ups).
		if (state.name === "ready" && was !== "ready") this.#groups.ready();
		for (const listener of this.#listeners) listener(this.state);
	}

	/**
	 * The state with what a new device shows of its setup, and a ready one of a new device's approval (Task 26), as they
	 * are now: none while a change of keys waits, which approves nothing.
	 */
	#shown(state: EngineState): EngineState {
		if (state.name === "new_device") {
			const setup = this.#setup ?? this.#approvals.setup();
			return setup ? { name: "new_device", setup } : { name: "new_device" };
		}
		if (state.name !== "ready") return state;
		const { approval: _shown, ...ready } = state;
		const approval = ready.rotation ? null : this.#approvals.shown();
		return approval ? { ...ready, approval } : ready;
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
			case "DEVICE_ADD":
				// Its registration, then its listing: told once, and never of this installation's own device.
				if (event.data.id !== this.#self && addedToTell(this.#parts.store, event.data)) {
					this.#tell({ kind: "added", device: event.data });
				}
				break;
			case "IDENTITY_UPDATE":
				// Another user's: they're observed as the API serves them now (a changed key leaves its notice, contacts.ts),
				// and whether they have a device may have changed, which their conversations tell the core.
				if (event.data.user_id !== this.#parts.user) {
					const { user_id } = event.data;
					this.#soon(() =>
						this.#whenReady(async () => {
							await observeUsers(this.#parts, [user_id]).catch((error: unknown) => {
								console.warn("[e2e] A contact whose identity changed wasn't observed:", error);
							});
							await this.#groups.identityChanged(user_id);
						}),
					);
					break;
				}
				// The user's own: another device changed the list or the keys, which may leave this one off it, or
				// published the identity this first device was to make, if it hasn't shown a key yet.
				this.#soon(async () => {
					const { state } = this;
					// Ready, the device's own list may now leave out a device that still has leaves: the groups say whether
					// a commit is due to take them out.
					if (state.name === "ready") {
						this.#set(await this.#identity());
						// The list of a device this one approved, up: this device's own changes go on.
						if (this.#approvals.holds()) {
							const served = await servedIdentity(this.#parts);
							if (served) this.#approvals.listed(served);
						}
						await this.#whenReady(() => this.#groups.all());
					} else if (state.name === "first_device" && !state.recoveryKey) await this.#stillFirst();
				});
				break;
		}
	}

	/**
	 * Step 5, with the inbox for a rotation's transfer this device may need first; ready, with the change of keys under
	 * way, if the core still waits for its upload: its key while it shows, else one to finish. A change the core let go
	 * of (another device's took its place) is forgotten.
	 */
	async #identity(): Promise<EngineState> {
		const state = await identityState(this.#parts, () => takeInbox(this.#parts, this.#tries, this.#failures));
		if (state.name === "ready" && (await coreStatus(this.#parts.host)).waiting_upload === "rotate_keys") {
			const recoveryKey = this.#keys?.recovery_key ?? null;
			return { name: "ready", rotation: this.#stuck ? { recoveryKey, stuck: true } : { recoveryKey } };
		}
		this.#keys = null;
		this.#stuck = false;
		return state;
	}

	#tell(notice: DeviceNotice) {
		for (const listener of this.#deviceListeners) listener(notice);
	}

	/** The user's devices not seen in 45 days, each told of once, on a device that can take them off (ready). */
	async #tellInactive(): Promise<void> {
		if (this.state.name !== "ready") return;
		for (const device of inactiveToTell(this.#parts.store, await this.#parts.api.devices())) {
			this.#tell({ kind: "inactive", device });
		}
	}

	/**
	 * A change of keys this device made whose upload the API took, its answer lost: the person saved its key before it
	 * went, so only its confirmation is left (the record's devices let go of with it).
	 */
	async #settleKeys(): Promise<void> {
		const status = await coreStatus(this.#parts.host);
		if (status.waiting_upload !== "rotate_keys") return;
		const served = await servedIdentity(this.#parts);
		if (served && served.identity_key === status.identity_key)
			await confirmKeys(this.#parts, served.device_list_version);
	}

	/**
	 * The inbox; once it brought a rotation's transfer, the own user observed, which may change what this device is. Then
	 * the approval frames it kept, for this device's role (approval.ts).
	 */
	async #inbox(): Promise<void> {
		if (await takeInbox(this.#parts, this.#tries, this.#failures)) this.#set(await this.#identity());
		await this.#takeApprovals();
	}

	/** Which approvals this device takes part in: as a new one, or as one that may approve the user's new ones. */
	#role(): ApprovalRole {
		const { state } = this;
		if (state.name === "new_device") return this.#setup ? null : "new";
		return state.name === "ready" && !state.rotation ? "approver" : null;
	}

	/** A new device with no identity in its core yet: one way of setting it up may begin. */
	#isNew(): boolean {
		return this.#role() === "new";
	}

	/** The kept approval frames, by this device's role; a transfer that set it up lists it next. */
	async #takeApprovals(): Promise<void> {
		if (!(await this.#approvals.take(this.#role()))) return;
		this.#approvals.end();
		await this.#listThisDevice(false);
	}

	/**
	 * This device, holding the user's identity now (recovered, or approved), puts up its first list (recover.ts), and
	 * once it's listed starts its last steps. One that must leave devices out names them and waits for the person's
	 * Finish (`signOff`, when Bun asks in its own box: review M6); one that fails, or their no there, leaves Finish too.
	 * One that lost to another list (409) can't be listed any more, as the core adds no device to a list: the
	 * installation starts again as a new device (Ruling 26), and the person sets it up again.
	 */
	async #listThisDevice(signOff: boolean): Promise<void> {
		let listed: FirstList;
		try {
			listed = await putFirstList(this.#parts, signOff);
		} catch (error) {
			this.#waitToFinish(this.#setup?.way === "finishing" ? this.#setup.leavingOut : undefined);
			if (error instanceof CoreError && error.code === "refused") return;
			throw error;
		}
		if (typeof listed === "object") return this.#waitToFinish(listed.leavingOut.map((id) => id.slice(0, 8)));
		if (listed === "lost") {
			await this.#startOver();
			throw new CoreError("list_changed", "another device's list went up first: this device starts again as a new one");
		}
		this.#setup = null;
		this.#set({ name: "starting" });
		await this.#settle();
	}

	/** Finish is left for the person, naming the devices the list leaves out by their IDs' start (as Settings does). */
	#waitToFinish(leavingOut?: string[]) {
		this.#setup = leavingOut?.length ? { way: "finishing", leavingOut: leavingOut.toSorted() } : { way: "finishing" };
		this.#set({ name: "new_device" });
	}

	/**
	 * The person saved starting over's recovery key: the new identity goes up in the place of the one it replaces, and
	 * only once the API took it is it confirmed; the record lets go of it then. A refusal or a lost answer rejects, the
	 * key still shown, and the same bytes go next time. Another identity there meanwhile (409) can't be replaced by this
	 * one, made for the one before: the installation starts again as a new device (Ruling 26).
	 */
	async #resetSaved(): Promise<void> {
		const made = this.#made;
		const replaces = this.#replaces;
		if (!made || !replaces) return;
		let published: boolean;
		try {
			published = await publishIdentity(this.#parts, made, replaces);
		} catch (error) {
			if (!(error instanceof UpdateRequiredError)) throw error;
			this.#made = null;
			this.#setup = { way: "reset", recoveryKey: null, finishing: true };
			return this.#set({ name: "update", minimum: error.minimum });
		}
		this.#made = null;
		this.#setup = null;
		this.#replaces = null;
		this.#parts.store.write(KEPT_RESET, null);
		if (!published) return this.#startOver();
		this.#set({ name: "starting" });
		await this.#settle().catch((error: unknown) => this.#failed(error));
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
			this.#self = device ?? null;
			const bound = device && (await bindSession(parts, device, keys).catch(refusedForGood));
			if (bound === null) return this.#set({ name: "failed", lostKey: false });
			if (!device || !bound) return this.#set({ name: "removed" });
			this.#device = device;
			parts.registered(device);
			this.#retries = 0;
			// An identity made before the app closed, still waiting for its upload: the same command gives it again, its
			// recovery key with it, from the person's tap as the first time (step 4). A start over's, as its record says,
			// is a new device's (Task 26), never a first device's that lost its race.
			if (status.waiting_upload === "create_identity") {
				this.#replaces = replacedByReset(parts.store);
				if (!this.#replaces) return this.#set({ name: "first_device", recoveryKey: null, finishing: true });
				this.#setup = { way: "reset", recoveryKey: null, finishing: true };
				return this.#set({ name: "new_device" });
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
		await this.#settleKeys();
		const state = await this.#identity();
		// Set up here before the app closed, its first list not up: it goes up now, or waits for the person's Finish.
		if (state.name === "new_device" && (await this.#firstListWaits())) return this.#listThisDevice(false);
		this.#set(state);
		await this.#inbox();
		if (this.state.name !== "ready") return;
		// Whom the person verified, looked at again: a change of theirs the record never took holds from the start (review,
		// Minor 5).
		await observeUsers(this.#parts, this.#contacts.verifiedUsers()).catch((error: unknown) => {
			console.warn("[e2e] The verified contacts weren't observed:", error);
		});
		await this.#whenReady(() => this.#groups.all());
		for (const id of [...this.#toOpen]) {
			this.#toOpen.delete(id);
			await this.#whenReady(() => this.#open(id)).catch((error: unknown) => {
				console.error("[e2e] A conversation's group didn't open:", error);
			});
		}
		// What waits to be sent goes once the queues are applied, before anything new («Enviar»).
		await this.#whenReady(() => this.#sends.resendAll());
		await this.#keyPackages();
		await this.#whenReady(() => this.#groups.renew()).catch((error: unknown) => {
			console.error("[e2e] The leaf renewals wait for tomorrow's:", error);
		});
		await this.#tellInactive().catch((error: unknown) => console.error("[e2e] The devices weren't read:", error));
		this.#daily ??= this.#everyDay();
	}

	/** This device holds the identity the API serves, and the API's list doesn't name it yet. */
	async #firstListWaits(): Promise<boolean> {
		const served = await servedIdentity(this.#parts);
		return served !== null && firstListWaits(served, await coreStatus(this.#parts.host));
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
			this.#soon(() => this.#tellInactive());
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
		this.#contacts.forget();
		this.#made = null;
		this.#keys = null;
		this.#setup = null;
		this.#replaces = null;
		this.#approvals.stop();
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
