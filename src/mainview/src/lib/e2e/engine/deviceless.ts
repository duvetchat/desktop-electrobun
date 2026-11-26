// Members without a device (PLAN-E2E-CLIENTES.md, «Quien no tenía dispositivo»; decision 14): a member with no identity,
// or none of whose listed devices connected in 45 days, can't read what's sent meanwhile. The core is told who they are
// as the person opens the conversation and at each IDENTITY_UPDATE (without_devices, all of them each time), notes for
// them what this device sends, and names them in apply's catch_up_due once they have a device again: this device then
// hands them what it noted as a catch-up (PLAN-E2E-API.md, «Rutas», I), its parts up, its key to each of their devices'
// inbox, and only then confirmed (catch_up_delivered). Each runs in the engine's turn, so one at a time for each member
// of each conversation; one refused for its limit (a 429: the API takes one a day for each) waits a day, its notes kept.
import { FetchError } from "$lib/api/api";
import type { Conversation } from "$lib/api/conversations";
import { CoreError } from "../errors";
import type { ShareMade } from "../host";
import type { EngineParts } from "./engine";
import { observeUsers, withIdentities } from "./identity";

const DAY = 24 * 3600 * 1000;

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

/** The catch-ups this device hands members who had no device, each in the engine's turn (`soon`). */
export class CatchUps {
	readonly #parts: EngineParts;
	readonly #soon: (work: () => Promise<void>) => void;
	/** Catch-ups the API refused for its limit, by conversation and member: each waits its day (its timer). */
	readonly #waiting = new Map<string, () => void>();

	constructor(parts: EngineParts, soon: (work: () => Promise<void>) => void) {
		this.#parts = parts;
		this.#soon = soon;
	}

	/** apply named these members of the conversation due a catch-up: each one's goes in its turn, but one waiting its day. */
	due(conversationId: string, users: string[]) {
		for (const user of users) this.#soon(() => this.#deliver(conversationId, user));
	}

	stop() {
		for (const cancel of this.#waiting.values()) cancel();
		this.#waiting.clear();
	}

	async #deliver(conversationId: string, user: string) {
		const key = `${conversationId}:${user}`;
		if (this.#waiting.has(key)) return;
		if ((await deliver(this.#parts, conversationId, user)) !== "later") return;
		this.#waiting.set(
			key,
			this.#parts.clock.later(DAY, () => {
				this.#waiting.delete(key);
				this.due(conversationId, [user]);
			}),
		);
	}
}

/**
 * One member's catch-up in the conversation: what this device noted for them, sealed to their listed devices as the API
 * serves them, up, with its key in each of those devices' inbox, then confirmed, the member observed first so the core
 * holds the list it was sealed to. Nothing noted (or nothing their devices can take) is done; a 429 is `later`.
 */
async function deliver(parts: EngineParts, conversationId: string, user: string): Promise<"done" | "later"> {
	const { api, host } = parts;
	const identity = await api.identity(user).catch((error: unknown) => {
		if (statusOf(error) === 403 || statusOf(error) === 404) return null;
		throw error;
	});
	if (!identity) return "done";
	await observeUsers(parts, [user]);
	let made: ShareMade;
	try {
		made = await withIdentities(parts, () =>
			host.share({
				...{ cmd: "catch_up", conversation_id: conversationId, user_id: user },
				devices: identity.certificates,
			}),
		);
	} catch (error) {
		// Nothing noted that a catch-up carries, or the member still counted as without a device.
		if (error instanceof CoreError && error.code === "not_found" && error.what === "catch_up") return "done";
		throw error;
	}
	try {
		await api.putShare(conversationId, made.share_id, {
			...{ to_user_id: user, kind: "catch_up", range: "", starts_at: new Date(made.start).toISOString() },
			...{ size: made.size, parts: made.parts },
		});
		for (let n = 0; n < made.parts; n++) {
			const part = await host.sharePart(made.share_id, n);
			await api.putSharePart(conversationId, made.share_id, n, new Blob([part.slice()]));
		}
		await api.completeShare(conversationId, made.share_id);
		for (const { device_id, message } of made.keys) await api.sendToDevice(device_id, message);
	} catch (error) {
		if (statusOf(error) === 429) return "later";
		throw error;
	} finally {
		await host.dropShare(made.share_id);
	}
	await observeUsers(parts, [user]);
	await host
		.handle({ cmd: "catch_up_delivered", conversation_id: conversationId, user_id: user, share_id: made.share_id })
		.catch((error: unknown) => {
			// None of the devices it was sealed to is on their list any more: its notes stay for the next catch-up.
			if (!(error instanceof CoreError && error.code === "not_found")) throw error;
		});
	return "done";
}
