// The inbox (PLAN-E2E-CLIENTES.md, «El buzón»): what other devices sent this one, read oldest first at start, at each
// READY and on DEVICE_MESSAGE. Each message is handled, then deleted with every one before it (DELETE …?through=): one
// that can't be handled yet ends the round, and waits with those after it for the next one. Tasks 22, 26, 30 and 32 add
// what their messages are for.
import { FetchError } from "$lib/api/api";
import type { Identity, InboxMessage } from "$lib/api/e2e";
import { certificateDevice } from "../cbor";
import { readApprovalFrame } from "../conventions";
import { CoreError } from "../errors";
import type { EngineParts } from "./engine";
import type { Failures } from "./failures";
import { isShareKey, type ShareKey } from "./history";
import { withIdentities } from "./identity";
import { KEPT_APPROVALS, KEPT_LATER, KEPT_TRANSFERS, type EngineStore } from "./store";

/** The most messages a page of the inbox has (the API's most). */
const PAGE = 100;
/** The most messages the record keeps of each kind. */
const KEPT = 20;
/** What a later round may get past: a cut call, the database, another instance; five rounds a message at most. */
export const AGAIN = new Set(["internal", "storage", "locked"]);
const MOST_TRIES = 5;

/** The messages the record keeps under `key`. */
function keptIn(store: EngineStore, key: string): InboxMessage[] {
	const kept = store.read<InboxMessage[]>(key);
	return Array.isArray(kept) ? kept : [];
}

/**
 * Keeps a message in the record under `key`, once, with the newest of those before it: whether the record holds it
 * now. The page's record logs a write its storage refuses (full, or refused) and goes on, so it's read back.
 */
function keep(store: EngineStore, key: string, message: InboxMessage): boolean {
	const others = keptIn(store, key).filter((one) => one?.id !== message.id);
	store.write(key, [...others, message].slice(-KEPT));
	return keptIn(store, key).some((one) => one?.id === message.id);
}

/**
 * A message the core can't take with what the inbox gives it yet, which its type's task gives (a history or catch-up
 * key, Tasks 22 and 30): a field it lacks, or the users to observe first. Kept for that task: its sender won't send it
 * again.
 */
const forLater = ({ code, field }: CoreError) =>
	(code === "bad_command" && field !== undefined && field !== "message") || code === "needs_identities";

/**
 * Reads the inbox and handles each message. An approval's step from one of the user's own devices is kept for its flow
 * (Task 26), so deleting the inbox through it loses nothing, and another user's is dropped. Anything else goes to
 * receive_direct, with the identity the API serves for the user today (what a rotation's transfer is checked against)
 * and its sender's certificate, from the sender's served identity. A package's key goes to `onKey` (Task 30), which
 * keeps it; one it couldn't keep stays in the inbox. A transfer the core keeps for later (`not_found` `code`: an
 * approval whose code wasn't accepted yet) is kept in the record, as is one the core can't take yet (`forLater`), which
 * each round tries again first; one no core here can read goes, as does one whose call is cut five rounds running
 * (`tries`, by its ID). One that doesn't open is counted for the API as a failure to decrypt (`direct`). A rotation's
 * transfer that keeps a device this device's own waiting change takes off is refused (`removed_device_listed`,
 * duvetchat/e2e#49), which `relisted` hears: that change can never finish. True when the inbox brought a rotation's
 * transfer, after which the own user is observed (the core's rule).
 */
export async function takeInbox(
	parts: EngineParts,
	tries: Map<string, number>,
	failures?: Failures,
	onKey: (key: ShareKey) => boolean = () => true,
	relisted?: () => void,
): Promise<boolean> {
	const { api, host, store, user } = parts;
	let rotated = false;
	// Users' identities as served, read once a round when a message needs one: null for one that can't be read.
	const identities = new Map<string, Promise<Identity | null>>();
	const identityOf = (of: string): Promise<Identity | null> => {
		const read =
			identities.get(of) ??
			api.identity(of).catch((error: unknown) => {
				const status = error instanceof FetchError ? error.response?.status : undefined;
				if (status === 403 || status === 404) return null;
				throw error;
			});
		identities.set(of, read);
		return read;
	};

	/**
	 * Whether the message is done with: handled, kept, or one that never will be. One the record couldn't keep isn't: it
	 * stays in the inbox for the next round, as its sender won't send it again (a catch-up's key). `later`, whether it's
	 * one the core can't take yet, which the record keeps.
	 */
	let later = false;
	const handle = async (message: InboxMessage): Promise<boolean> => {
		later = false;
		try {
			if (readApprovalFrame(message.message)) {
				// Approvals are between the user's own devices.
				return message.from_user_id !== user || keep(store, KEPT_APPROVALS, message);
			}
			const own = await identityOf(user);
			const sender = await identityOf(message.from_user_id);
			const certificate = sender?.certificates.find((one) => certificateDevice(one) === message.from_device_id);
			// A catch-up's key (Task 22) or a history's is taken once its sender's identity is known here: observed first.
			const received = await withIdentities(parts, () =>
				host.handle<{ type: string }>({
					cmd: "receive_direct",
					message: message.message,
					...(own ? { identity_key: own.identity_key } : {}),
					...(certificate ? { from_certificate: certificate } : {}),
				}),
			);
			if (received.type === "rotation.transfer") rotated = true;
			// The core keeps a package's key, which the engine must know of once the inbox lets it go.
			if (isShareKey(received) && !onKey(received)) return false;
		} catch (error) {
			if (!(error instanceof CoreError)) {
				console.error("[e2e] The inbox waits for its next round:", error);
				return false;
			}
			if (AGAIN.has(error.code)) {
				const tried = (tries.get(message.id) ?? 0) + 1;
				tries.set(message.id, tried);
				if (tried < MOST_TRIES) {
					console.error(`[e2e] The inbox waits for its next round (${error.code}).`);
					return false;
				}
				console.warn(`[e2e] A message from another device failed ${tried} times (${error.code}), and goes.`);
			} else if (error.code === "not_found" && error.what === "code") {
				if (!keep(store, KEPT_TRANSFERS, message)) return false;
			} else if (forLater(error)) {
				if (!keep(store, KEPT_LATER, message)) return false;
				later = true;
			} else if (error.code === "rule_violation" && error.rule === "removed_device_listed") {
				console.warn("[e2e] Another device's change of keys keeps a device this one's change takes off, and goes.");
				relisted?.();
			} else {
				if (error.code === "decrypt_failed") failures?.note("direct");
				console.warn(`[e2e] A message from another device can't be read here (${error.code}), and goes.`);
			}
		}
		tries.delete(message.id);
		return true;
	};

	// What the core couldn't take before (a key whose sender it didn't know yet), first: one done with leaves the record.
	for (const message of keptIn(store, KEPT_LATER)) {
		if (!(await handle(message)) || later) continue;
		store.write(
			KEPT_LATER,
			keptIn(store, KEPT_LATER).filter((one) => one?.id !== message.id),
		);
	}

	let after: string | undefined;
	for (;;) {
		const page = await api.inbox(after);
		let handled: string | undefined;
		for (const message of page) {
			if (!(await handle(message))) break;
			handled = message.id;
		}
		if (handled) await api.clearInbox(handled);
		if (page.length < PAGE || handled !== page.at(-1)?.id) return rotated;
		after = handled;
	}
}
