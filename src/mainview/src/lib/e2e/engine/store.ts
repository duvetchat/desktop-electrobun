// The engine's record (PLAN-E2E-CLIENTES.md, «El motor», its store): small and with no secret, by user. The page keeps
// it in localStorage under duvet.e2e.<user_id>.<key>, beside the device client.ts keeps there for the identify; a test
// keeps one in memory for each device. What it holds is the engine's: each reader checks what it reads.

/** This installation's device's public keys, which each sign-in registers again (bootstrap.ts). */
export const DEVICE_KEYS = "device_keys";
/** The inbox's approval frames waiting for their flow (Task 26), the transfers kept for later, and the messages whose
 * type a later task takes (a history or catch-up key: Tasks 22 and 30), as inbox.ts keeps them. */
export const KEPT_APPROVALS = "approvals";
export const KEPT_TRANSFERS = "transfers";
export const KEPT_LATER = "later";
/** What goes in the clear with each message still being sent, by its nonce (send.ts): never its text, which the core keeps. */
export const PENDING_SENDS = "pending_sends";
/** The person's edits and deletions not answered yet, by conversation and message (send.ts): never their text. */
export const PENDING_CHANGES = "pending_changes";
/** The devices a change of keys under way takes off the list (devices.ts), which it runs again with, until it's uploaded. */
export const KEPT_ROTATION = "rotation";
/**
 * A change of keys of this device's went on without devices another device took off (gone, duvetchat/e2e#49): one of
 * them may still hold its keys, so another change is offered, until one is made. True, or nothing.
 */
export const KEYS_AGAIN = "keys_again";
/**
 * Another device's change of keys kept a device this device's waiting change takes off, so the core refused its
 * transfer (removed_device_listed): that change can't finish, which a later start, with the transfer gone, still says.
 * True, or nothing, until the change ends.
 */
export const RELISTED = "relisted";
/** The identity a start over replaces (start-over.ts), from the person's tap until its upload is confirmed. */
export const KEPT_RESET = "reset";
/**
 * The generations this device joins only on its person's yes, by conversation (sync.ts): a restart's welcome its core
 * refused, a newer generation with members other than it holds. A conversation's ID and a number, nothing secret.
 */
export const REFUSED_GENERATIONS = "refused_generations";
/**
 * The packages of history whose key this device's core holds (history.ts): their IDs, conversations, sharers and kinds,
 * as the inbox brought them, which the inbox deletes once read. Nothing secret: the key stays in the core.
 */
export const SHARE_KEYS = "share_keys";
/**
 * Contacts' changed keys the person isn't done with (contacts.ts), by user: whether the identity replaced was verified,
 * the notice closed, the person's yes. Words alone, never a key; what this device's core pinned goes with it.
 */
export const KEY_CHANGES = "key_changes";
/** Whom the person verified on this device (contacts.ts), from their tap: user IDs, so a lost change is found again. */
export const VERIFIED_CONTACTS = "verified_contacts";
/**
 * The encrypted backup's (backup.ts), IDs, times and counts alone: a restore that's due, with the conversations it's
 * done with; the ID of the key this device last saw itself seal with, and how far the move of other keys' segments went
 * (the last segment it went past); since when a full storage paused it; and the days and segments that failed, by
 * conversation and day or by segment, with how many passes in a row did and since when one is set aside.
 */
export const BACKUP_RESTORE = "backup_restore";
export const BACKUP_KEY_SEEN = "backup_key_seen";
export const BACKUP_REENCRYPT = "backup_reencrypt";
export const BACKUP_PAUSE = "backup_paused";
export const BACKUP_SET_ASIDE = "backup_set_aside";
/** What a new device of this installation starts without. */
export const DEVICE_RECORD = [
	...[DEVICE_KEYS, KEPT_APPROVALS, KEPT_TRANSFERS, KEPT_LATER],
	...[PENDING_SENDS, PENDING_CHANGES, KEPT_ROTATION, KEYS_AGAIN, RELISTED, KEPT_RESET, REFUSED_GENERATIONS],
	...[SHARE_KEYS, KEY_CHANGES, VERIFIED_CONTACTS],
	...[BACKUP_RESTORE, BACKUP_KEY_SEEN, BACKUP_REENCRYPT, BACKUP_PAUSE, BACKUP_SET_ASIDE],
];
/** The user's devices the app told of, each once (devices.ts): those not seen in 45 days, and those added. */
export const TOLD_INACTIVE = "told_inactive";
export const TOLD_ADDED = "told_added";
/** The API's external sender as this installation first saw it (Ruling 32), which a new device of it keeps. */
export const EXTERNAL_SENDER = "external_sender";

export interface EngineStore {
	read<T>(key: string): T | null;
	/** Keeps a JSON value under the key; null forgets it. */
	write(key: string, value: unknown): void;
}

/** The page's record of the user's: a value that doesn't read is none, and one storage refuses is logged. */
export function pageStore(userId: string): EngineStore {
	const name = (key: string) => `duvet.e2e.${userId}.${key}`;
	return {
		read(key) {
			try {
				const kept = localStorage.getItem(name(key));
				return kept === null ? null : JSON.parse(kept);
			} catch {
				return null;
			}
		},
		write(key, value) {
			try {
				if (value === null) localStorage.removeItem(name(key));
				else localStorage.setItem(name(key), JSON.stringify(value));
			} catch (error) {
				console.error(`[e2e] The engine's record didn't take ${key}:`, error);
			}
		},
	};
}
