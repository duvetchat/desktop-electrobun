// The inbox (PLAN-E2E-CLIENTES.md, «El buzón»): what other devices sent this one, read oldest first at start, at each
// READY and on DEVICE_MESSAGE. Each message is handled, then deleted with every one before it (DELETE …?through=): one
// that can't be handled yet ends the round, and waits with those after it for the next one. Tasks 26, 30 and 32 add
// what their messages are for.
import type { InboxMessage } from "$lib/api/e2e";
import { FetchError } from "$lib/api/api";
import { readApprovalFrame } from "../conventions";
import { CoreError } from "../errors";
import type { EngineParts } from "./engine";
import { KEPT_APPROVALS, KEPT_TRANSFERS, type EngineStore } from "./store";

/** The most messages a page of the inbox has (the API's most). */
const PAGE = 100;
/** The most messages the record keeps of each kind: steps of approvals, which take minutes, and transfers for later. */
const KEPT = 20;
/** What a later round may get past: a cut call, the database, another instance, users to observe first (Task 30's). */
const AGAIN = new Set(["internal", "storage", "locked", "needs_identities"]);

/** Keeps a message in the record under `key`, once, with the newest of those before it. */
function keep(store: EngineStore, key: string, message: InboxMessage) {
	const kept = store.read<InboxMessage[]>(key);
	const others = (Array.isArray(kept) ? kept : []).filter((one) => one?.id !== message.id);
	store.write(key, [...others, message].slice(-KEPT));
}

/**
 * Reads the inbox and handles each message: an approval's step is kept for its flow (Task 26), so deleting the inbox
 * through it loses nothing; anything else goes to receive_direct, with the identity the API serves for the user today
 * (what a rotation's transfer is checked against). A transfer the core keeps for later (`not_found` `code`: an approval
 * whose code wasn't accepted yet) is kept, sealed, in the record; one no core here can read goes. True when the inbox
 * brought a rotation's transfer, after which the own user is observed (the core's rule).
 */
export async function takeInbox(parts: EngineParts): Promise<boolean> {
	const { api, host, store, user } = parts;
	let rotated = false;
	// The user's identity key as served, read once a round, when a message needs it: null without one.
	let served: string | null | undefined;
	const identityKey = async () =>
		(served ??= await api.identity(user).then(
			(identity) => identity.identity_key,
			(error: unknown) => {
				if (error instanceof FetchError && error.response?.status === 404) return null;
				throw error;
			},
		));

	/** Whether the message is done with: handled, kept, or one that never will be. */
	const handle = async (message: InboxMessage): Promise<boolean> => {
		try {
			if (readApprovalFrame(message.message)) {
				keep(store, KEPT_APPROVALS, message);
				return true;
			}
			const key = await identityKey();
			const received = await host.handle<{ type: string }>({
				cmd: "receive_direct",
				message: message.message,
				...(key ? { identity_key: key } : {}),
			});
			if (received.type === "rotation.transfer") rotated = true;
		} catch (error) {
			if (!(error instanceof CoreError) || AGAIN.has(error.code)) {
				console.error("[e2e] The inbox waits for its next round:", error);
				return false;
			}
			if (error.code === "not_found" && error.what === "code") keep(store, KEPT_TRANSFERS, message);
			else console.warn(`[e2e] A message from another device can't be read here (${error.code}), and goes.`);
		}
		return true;
	};

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
