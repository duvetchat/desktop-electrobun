// Members without a device (PLAN-E2E-CLIENTES.md, «Quien no tenía dispositivo»; decision 14): a member with no identity,
// or none of whose listed devices connected in 45 days, can't read what's sent meanwhile. The core is told who they are
// as the person opens the conversation, at each IDENTITY_UPDATE and once its group's members change (without_devices,
// all of them each time), notes for them what this device sends, and names them in apply's catch_up_due once they have
// a device again: this device then hands them what it noted as a catch-up (PLAN-E2E-API.md, «Rutas», I), its parts up,
// its key to each of their devices' inbox, and only then confirmed (catch_up_delivered). One at a time for each member
// of each conversation, however many applies name them meanwhile. Only the core's calls take the engine's turn: the
// upload goes outside it, and the confirmation in a turn after (task 22's review, M6). The package stays with the host
// until it's delivered, so a try that failed once the API took it goes again with it, which the API takes again (its
// day's one spent on it already). A try that failed waits: as long as a 429 says (a day without a Retry-After), else a
// minute, then twice as long each time, up to an hour.
import { FetchError } from "$lib/api/api";
import type { Conversation } from "$lib/api/conversations";
import { retryAfterMs } from "$lib/emoji-retry";
import { CoreError } from "../errors";
import type { ShareMade } from "../host";
import type { EngineParts } from "./engine";
import { observeUsers, withIdentities } from "./identity";

const DAY = 24 * 3600 * 1000;
const RETRY_MS = 60_000;
const RETRY_MOST_MS = 3_600_000;
/** Answers that say nothing of the package itself (a session's renewal, a full inbox, a rate limit, the server). */
const passing = (status: number) => [401, 408, 409, 429].includes(status) || status >= 500;

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);

/**
 * The conversation's members without a device, as the API serves their identities, told to the core: of those its
 * group holds (`held`), all but this user. The core refuses a user its group doesn't list, which a change the queue
 * hasn't brought yet can be.
 */
export async function withoutDevices(parts: EngineParts, conv: Conversation, held: string[]): Promise<string[]> {
	const { api, host, user } = parts;
	const members = conv.members.map((member) => member.user_id).filter((id) => id !== user && held.includes(id));
	const active = new Map<string, boolean>();
	for (let at = 0; at < members.length; at += 50) {
		for (const identity of await api.identities(members.slice(at, at + 50)))
			active.set(identity.user_id, identity.active);
	}
	// Without an identity (left out of the answer), or with none of their devices seen lately.
	const users = members.filter((id) => active.get(id) !== true);
	await host.handle({ cmd: "without_devices", conversation_id: conv.id, users });
	return users;
}

/**
 * One member's catch-up in a conversation, from the apply that named them due to its confirmation: what's left of it,
 * where it is, and the wait before its next try.
 */
interface CatchUp {
	conversationId: string;
	user: string;
	/** The package made for them, which the host keeps until it's delivered or the API refuses it. */
	made: ShareMade | null;
	/** The API took the package (its PUT): a 429 then is the moment's, not the package's. */
	taken: boolean;
	/** Its parts up so far, in order, and the devices its key went to. */
	partsUp: number;
	keysSent: Set<string>;
	/** Up, its keys sent: its confirmation is what's left. */
	up: boolean;
	/** The engine's turn it waits for (its number): one that came while the engine wasn't ready is asked for again. */
	turn: number | null;
	/** Its member's changed key waits for the person's yes: it tries nothing until again(), which keeps its package. */
	held: boolean;
	tries: number;
	/** The wait before its next try. */
	cancel: (() => void) | null;
}

const keyOf = (conversationId: string, user: string) => `${conversationId}:${user}`;

/** The catch-ups this device hands members who had no device, their core calls each in the engine's turn (`soon`). */
export class CatchUps {
	readonly #parts: EngineParts;
	readonly #soon: (work: () => Promise<void>) => void;
	/** The catch-ups due, by conversation and member, from the apply that named them until they're confirmed. */
	readonly #due = new Map<string, CatchUp>();
	/** The uploads going on, outside the engine's turn. */
	readonly #uploads = new Set<Promise<void>>();
	#turns = 0;

	constructor(parts: EngineParts, soon: (work: () => Promise<void>) => void) {
		this.#parts = parts;
		this.#soon = soon;
	}

	/** apply named these members of the conversation due a catch-up: one goes for each that has none going (item 12). */
	due(conversationId: string, users: string[]) {
		for (const user of users) {
			const key = keyOf(conversationId, user);
			if (this.#due.has(key)) continue;
			const catchUp: CatchUp = {
				...{ conversationId, user, made: null, taken: false, partsUp: 0, keysSent: new Set<string>() },
				...{ up: false, turn: null, held: false, tries: 0, cancel: null },
			};
			this.#due.set(key, catchUp);
			this.#queue(catchUp);
		}
	}

	/**
	 * The engine is ready again: a catch-up whose turn came while it wasn't, and was skipped, is asked for again (task 23's
	 * review, M3), not left until the engine starts anew; and so is one held for the person's yes, which may have come.
	 */
	again() {
		for (const catchUp of this.#due.values()) {
			if (catchUp.turn === null && !catchUp.held) continue;
			catchUp.held = false;
			this.#queue(catchUp);
		}
	}

	/** A conversation this device is no longer in: its catch-ups go, their packages with them. */
	forget(conversationId: string) {
		for (const catchUp of [...this.#due.values()]) if (catchUp.conversationId === conversationId) this.#done(catchUp);
	}

	stop() {
		for (const catchUp of this.#due.values()) catchUp.cancel?.();
		this.#due.clear();
	}

	/** The uploads going on now, settled, whatever they end as. */
	settled(): Promise<void> {
		return Promise.all([...this.#uploads]).then(() => {});
	}

	#holds(catchUp: CatchUp): boolean {
		return this.#due.get(keyOf(catchUp.conversationId, catchUp.user)) === catchUp;
	}

	/** Its next step in the engine's turn: the turn asked for last is the one that goes. */
	#queue(catchUp: CatchUp) {
		const turn = ++this.#turns;
		catchUp.turn = turn;
		this.#soon(async () => {
			if (catchUp.turn !== turn || !this.#holds(catchUp)) return;
			catchUp.turn = null;
			await this.#step(catchUp);
		});
	}

	/** In the turn: the package made (once), then its upload started outside the turn; or, up, its confirmation. */
	async #step(catchUp: CatchUp) {
		try {
			if (catchUp.up) return await this.#confirm(catchUp);
			catchUp.made ??= await makeCatchUp(this.#parts, catchUp.conversationId, catchUp.user);
		} catch (error) {
			// Held for the person's yes: it stays due, without a try, until the yes asks for it again.
			if (error instanceof CoreError && error.code === "key_changed") {
				catchUp.held = true;
				return;
			}
			return this.#failed(catchUp, error);
		}
		if (!catchUp.made) return this.#done(catchUp);
		const upload: Promise<void> = this.#upload(catchUp, catchUp.made).finally(() => this.#uploads.delete(upload));
		this.#uploads.add(upload);
	}

	/**
	 * Outside the turn: the package, the parts not up yet, its keys (a device the API no longer has, or no longer lets
	 * this user's reach, takes none), then its completion, as a share goes (#550), and its confirmation's turn. A member
	 * whose changed key waits for the person's yes holds it, before its PUT and again before its keys and completion, as
	 * the make's own identity round can bring the change (#530): it keeps its package, which again() goes on with.
	 */
	async #upload(catchUp: CatchUp, made: ShareMade) {
		const { api, host } = this.#parts;
		const { conversationId, user } = catchUp;
		try {
			if (this.#waitsForYes(catchUp)) return;
			await api.putShare(conversationId, made.share_id, {
				...{ to_user_id: user, kind: "catch_up", range: "", starts_at: new Date(made.start).toISOString() },
				...{ size: made.size, parts: made.parts },
			});
			catchUp.taken = true;
			for (; catchUp.partsUp < made.parts; catchUp.partsUp++) {
				const part = await host.sharePart(made.share_id, catchUp.partsUp);
				await api.putSharePart(conversationId, made.share_id, catchUp.partsUp, new Blob([part.slice()]));
			}
			if (this.#waitsForYes(catchUp)) return;
			for (const { device_id, message } of made.keys) {
				if (catchUp.keysSent.has(device_id)) continue;
				await api.sendToDevice(device_id, message).catch((error: unknown) => {
					if (statusOf(error) !== 403 && statusOf(error) !== 404) throw error;
				});
				catchUp.keysSent.add(device_id);
			}
			await api.completeShare(conversationId, made.share_id);
		} catch (error) {
			return this.#failed(catchUp, error);
		}
		if (!this.#holds(catchUp)) return;
		catchUp.up = true;
		this.#queue(catchUp);
	}

	/** Whether its member's changed key waits for the person's yes (Task 28), which holds it, untried, until again(). */
	#waitsForYes(catchUp: CatchUp): boolean {
		catchUp.held = !!this.#parts.contacts?.holding([catchUp.user]).length;
		return catchUp.held;
	}

	/** In a turn after its upload: the member observed again, so the core holds the list it was sealed to, then done. */
	async #confirm(catchUp: CatchUp) {
		const { conversationId, user, made } = catchUp;
		await observeUsers(this.#parts, [user]);
		await this.#parts.host
			.handle({ cmd: "catch_up_delivered", conversation_id: conversationId, user_id: user, share_id: made!.share_id })
			.catch((error: unknown) => {
				// None of the devices it was sealed to is on their list any more: its notes stay for the next catch-up.
				if (!(error instanceof CoreError && error.code === "not_found")) throw error;
			});
		this.#done(catchUp);
	}

	/**
	 * A try that failed waits for the next: a 429 as long as it says, a day without a Retry-After (the plan's day), any
	 * other a minute, then twice as long each time, up to an hour. The package goes when the API refused it, or a 429
	 * came before the API took it (none of it is the API's, and the host keeps few), or the host lost it.
	 */
	#failed(catchUp: CatchUp, error: unknown) {
		if (!this.#holds(catchUp)) return;
		const status = statusOf(error);
		const refused = status !== undefined && !passing(status);
		const lost = error instanceof CoreError && error.code === "not_found" && catchUp.made !== null && !catchUp.up;
		if (refused || lost || (status === 429 && !catchUp.taken)) this.#letGo(catchUp);
		const asked =
			status === 429 && error instanceof FetchError
				? (retryAfterMs(error.response?.headers.get("Retry-After") ?? null, Date.now()) ?? DAY)
				: null;
		const wait = asked ?? Math.min(RETRY_MOST_MS, RETRY_MS * 2 ** catchUp.tries++);
		console.error("[e2e] A catch-up waits for its next try:", error);
		catchUp.cancel = this.#parts.clock.later(wait, () => {
			catchUp.cancel = null;
			if (this.#holds(catchUp)) this.#queue(catchUp);
		});
	}

	/** The package goes from the host, and the next try makes another, with what's noted then. */
	#letGo(catchUp: CatchUp) {
		const { made } = catchUp;
		if (!made) return;
		Object.assign(catchUp, { made: null, taken: false, partsUp: 0, up: false });
		catchUp.keysSent.clear();
		void this.#parts.host.dropShare(made.share_id).catch((error: unknown) => {
			console.error("[e2e] A catch-up's package stays with the host until it closes:", error);
		});
	}

	#done(catchUp: CatchUp) {
		catchUp.cancel?.();
		this.#letGo(catchUp);
		if (this.#holds(catchUp)) this.#due.delete(keyOf(catchUp.conversationId, catchUp.user));
	}
}

/**
 * What this device noted for the member in the conversation, made into a catch-up sealed to their listed devices as
 * the API serves them, the member observed first: none when there's nothing to hand them (nothing noted their devices
 * can take, no identity, or the member still counted as without a device).
 */
async function makeCatchUp(parts: EngineParts, conversationId: string, user: string): Promise<ShareMade | null> {
	const { api, host } = parts;
	const identity = await api.identity(user).catch((error: unknown) => {
		if (statusOf(error) === 403 || statusOf(error) === 404) return null;
		throw error;
	});
	if (!identity) return null;
	await observeUsers(parts, [user]);
	// Their changed key waits for the person's yes (Task 28's review, I3): what was noted for them waits with it.
	if (parts.contacts?.holding([user]).length) {
		throw new CoreError("key_changed", "a verified contact's key changed: their catch-up waits for the person's yes", {
			users: [user],
		});
	}
	try {
		return await withIdentities(parts, () =>
			host.share({
				...{ cmd: "catch_up", conversation_id: conversationId, user_id: user },
				devices: identity.certificates,
			}),
		);
	} catch (error) {
		if (error instanceof CoreError && error.code === "not_found" && error.what === "catch_up") return null;
		throw error;
	}
}
