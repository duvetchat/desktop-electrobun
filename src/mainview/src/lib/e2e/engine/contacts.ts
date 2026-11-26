// Contacts (PLAN-E2E-CLIENTES.md, Task 28; decision 25): other users as this device's core pins them. A changed key is
// what observe_user says once for each new identity of theirs: its notice shows in every conversation with them until
// the person closes it, and when the identity it replaced was one the person had verified, what goes to those
// conversations waits for the person's yes first. The marks are the core's alone, from its answers to observe_user and
// verify_user: an observation it refuses (`rejected`, or an error) changes nothing here, and says nothing.
import { KEY_CHANGES, type EngineStore } from "./store";

/** What observe_user answers of a user (the core's contract). */
export interface Observation {
	state: "new" | "same" | "changed" | "rejected";
	/** Whether the person verified the identity now pinned. */
	verified: boolean;
	/** With `changed`: whether the person had verified the identity it replaced. */
	was_verified?: boolean;
	reason?: string;
}

/** A contact's changed key, until the person is done with it: kept by user, with nothing but these words. */
export interface KeyChange {
	/** The identity it replaced was one the person had verified: the strong notice, and what goes waits for their yes. */
	verified: boolean;
	/** The person closed its notice. */
	closed?: true;
	/** The person said to send all the same. */
	confirmed?: true;
}

/**
 * The security number with a contact (the core's safety_number): its 60 digits in 12 groups of 5, spaces between them,
 * and its QR's text, base64 of the two users' identities, which the other's phone hands to verify_user.
 */
export interface SafetyNumber {
	digits: string;
	qr: string;
}

/** What the views show of the person's contacts. */
export interface ContactsShown {
	/** Each contact's changed key the person isn't done with, by user. */
	changes: Record<string, KeyChange>;
	/** Whether the person verified each contact this device saw this session, by user. */
	verified: Record<string, boolean>;
}

/** Of a conversation's members, those whose changed key's notice shows there. */
export const changedIn = (changes: Record<string, KeyChange>, members: readonly string[]): string[] =>
	members.filter((user) => changes[user] !== undefined && !changes[user].closed);

/** Of a conversation's members, those whose changed key makes what goes there wait for the person's yes. */
export const waitingForYes = (changes: Record<string, KeyChange>, members: readonly string[]): string[] =>
	members.filter((user) => changes[user]?.verified === true && !changes[user].confirmed);

/** Whether a change is done with: its notice closed, and no yes left to give. */
const doneWith = (change: KeyChange) => change.closed === true && (!change.verified || change.confirmed === true);

export class Contacts {
	readonly #store: EngineStore;
	/** What the views are told, as it changes. */
	readonly #changed: () => void;
	readonly #verified = new Map<string, boolean>();
	/** The changes, as the record keeps them, and this session as far as the record refuses them (its storage full). */
	#changes: Record<string, KeyChange>;

	constructor(store: EngineStore, changed: () => void) {
		this.#store = store;
		this.#changed = changed;
		this.#changes = kept(store);
	}

	/** What the core answered of a user's observation: a refusal changes nothing. */
	observed(user: string, seen: Observation) {
		if (seen.state === "rejected") return;
		let news = this.#verified.get(user) !== seen.verified;
		this.#verified.set(user, seen.verified);
		if (seen.state === "changed") {
			const before = this.#changes[user];
			// A change before the person was done with a verified one's keeps it strong: they never said yes to it.
			const verified = seen.was_verified === true || (before?.verified === true && !before.confirmed);
			this.#write({ ...this.#changes, [user]: { verified } });
			news = true;
		}
		if (news) this.#changed();
	}

	/** What the core answered of the person's verification: once they verified a contact, their change is done with. */
	verifiedNow(user: string, verified: boolean) {
		this.#verified.set(user, verified);
		if (verified && this.#changes[user]) {
			const { [user]: _done, ...rest } = this.#changes;
			this.#write(rest);
		}
		this.#changed();
	}

	/** The person closed the notice of the user's changed key. */
	close(user: string) {
		this.#change(user, { closed: true });
	}

	/** The person's yes to sending, these users' changed keys known. */
	confirm(users: readonly string[]) {
		for (const user of users) this.#change(user, { confirmed: true });
	}

	/** Of these users, those whose changed key makes what goes to them wait for the person's yes. */
	holding(users: readonly string[]): string[] {
		return waitingForYes(this.#changes, users);
	}

	shown(): ContactsShown {
		return { changes: { ...this.#changes }, verified: Object.fromEntries(this.#verified) };
	}

	/** This device starts again with nothing (its core gone): what it pinned and noted goes with it. */
	forget() {
		this.#verified.clear();
		this.#write({});
		this.#changed();
	}

	#change(user: string, done: Partial<KeyChange>) {
		const change = this.#changes[user];
		if (!change) return;
		const now = { ...change, ...done };
		const { [user]: _was, ...rest } = this.#changes;
		this.#write(doneWith(now) ? rest : { ...rest, [user]: now });
		this.#changed();
	}

	#write(changes: Record<string, KeyChange>) {
		this.#changes = changes;
		this.#store.write(KEY_CHANGES, Object.keys(changes).length ? changes : null);
	}
}

/** The changes the record keeps: what each holds is checked as it's read, as any record's. */
function kept(store: EngineStore): Record<string, KeyChange> {
	const record = store.read<Record<string, Partial<KeyChange>>>(KEY_CHANGES);
	if (typeof record !== "object" || record === null) return {};
	return Object.fromEntries(
		Object.entries(record).flatMap(([user, change]): [string, KeyChange][] =>
			typeof change?.verified === "boolean"
				? [
						[
							user,
							{
								verified: change.verified,
								...(change.closed === true ? { closed: true as const } : {}),
								...(change.confirmed === true ? { confirmed: true as const } : {}),
							},
						],
					]
				: [],
		),
	);
}
