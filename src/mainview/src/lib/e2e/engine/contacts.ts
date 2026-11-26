// Contacts (PLAN-E2E-CLIENTES.md, Task 28; decision 25): other users as this device's core pins them. A changed key is
// what observe_user says once for each new identity of theirs: its notice shows in every conversation with them until
// the person closes it, and when the identity it replaced was one the person had verified, what goes to those
// conversations waits for the person's yes first. Each change has an ID of its own, which a yes or a close names, so
// neither reaches one that came after what the person was shown. The marks are the core's alone, from its answers to
// observe_user and verify_user: a refusal (`rejected`) still says whether the identity the core holds is verified, and
// says no change. Whom the person verified is kept too, from their tap, so a change the record never took is found
// again: the core then holds that contact unverified, and nothing was noted.
import { KEY_CHANGES, VERIFIED_CONTACTS, type EngineStore } from "./store";

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
	/** Which change it is, a new ID each time: a yes or a close names the one the person was shown. */
	change: string;
}

/** A change as the person was shown it, which their yes names. */
export interface ShownChange {
	user: string;
	change: string;
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

/** Of a conversation's people, those whose changed key's notice shows there. */
export const changedIn = (changes: Record<string, KeyChange>, members: readonly string[]): string[] =>
	members.filter((user) => changes[user] !== undefined && !changes[user].closed);

/** Of a conversation's people, those whose changed key makes what goes there wait for the person's yes. */
export const waitingForYes = (changes: Record<string, KeyChange>, members: readonly string[]): string[] =>
	members.filter((user) => changes[user]?.verified === true && !changes[user].confirmed);

/** Whether a change is done with: its notice closed, and no yes left to give. */
const doneWith = (change: KeyChange) => change.closed === true && (!change.verified || change.confirmed === true);

export class Contacts {
	readonly #store: EngineStore;
	/** The device's own user, whose observations are no contact's. */
	readonly #own: string;
	/** What the views are told, as it changes. */
	readonly #changed: () => void;
	readonly #verified = new Map<string, boolean>();
	/** The changes, as the record keeps them, and this session as far as the record refuses them (its storage full). */
	#changes: Record<string, KeyChange>;
	/** Whom the person verified on this device, from their tap until they're done with a change of theirs. */
	readonly #listed: Set<string>;

	constructor(store: EngineStore, own: string, changed: () => void) {
		this.#store = store;
		this.#own = own;
		this.#changed = changed;
		this.#changes = kept(store);
		this.#listed = new Set(listed(store));
	}

	/** Whom the person verified, by the record: a start looks at them again, as a change of theirs may have been lost. */
	verifiedUsers(): string[] {
		return [...this.#listed];
	}

	/** What the core answered of a user's observation. */
	observed(user: string, seen: Observation) {
		if (user === this.#own) return;
		let news = this.#verified.get(user) !== seen.verified;
		this.#verified.set(user, seen.verified);
		if (seen.verified) this.#list(user, true);
		const before = this.#changes[user];
		// A change before the person was done with a verified one's keeps it strong: they never said yes to it; and so is
		// one of a contact they verified whose earlier change the record never took.
		const strong = (before?.verified === true && !before.confirmed) || this.#listed.has(user);
		if (seen.state === "changed") {
			this.#write({ ...this.#changes, [user]: { verified: seen.was_verified === true || strong, change: newId() } });
			news = true;
		} else if (!seen.verified && !before && this.#listed.has(user)) {
			this.#write({ ...this.#changes, [user]: { verified: true, change: newId() } });
			news = true;
		}
		if (news) this.#changed();
	}

	/** What the core answered of the person's verification: once they verified a contact, their change is done with. */
	verifiedNow(user: string, verified: boolean) {
		this.#verified.set(user, verified);
		if (verified) {
			this.#list(user, true);
			const { [user]: _done, ...rest } = this.#changes;
			if (_done) this.#write(rest);
		}
		this.#changed();
	}

	/** The person closed the notice of the user's change they were shown. */
	close(user: string, change: string) {
		this.#change(user, change, { closed: true });
	}

	/** The person's yes to sending, these changes known: none that came since they were shown. */
	confirm(shown: readonly ShownChange[]) {
		for (const { user, change } of shown) this.#change(user, change, { confirmed: true });
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
		this.#listed.clear();
		this.#store.write(VERIFIED_CONTACTS, null);
		this.#write({});
		this.#changed();
	}

	#change(user: string, change: string, done: Partial<KeyChange>) {
		const now = this.#changes[user];
		if (now?.change !== change) return;
		const next = { ...now, ...done };
		// Their yes, or a change done with: the person dealt with that change, so it's found no more.
		if (done.confirmed || doneWith(next)) this.#list(user, false);
		const { [user]: _was, ...rest } = this.#changes;
		this.#write(doneWith(next) ? rest : { ...rest, [user]: next });
		this.#changed();
	}

	#write(changes: Record<string, KeyChange>) {
		this.#changes = changes;
		this.#store.write(KEY_CHANGES, Object.keys(changes).length ? changes : null);
	}

	#list(user: string, on: boolean) {
		if (this.#listed.has(user) === on) return;
		if (on) this.#listed.add(user);
		else this.#listed.delete(user);
		this.#store.write(VERIFIED_CONTACTS, this.#listed.size ? [...this.#listed] : null);
	}
}

const newId = () => crypto.randomUUID();

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
								change: typeof change.change === "string" ? change.change : newId(),
							},
						],
					]
				: [],
		),
	);
}

/** Whom the record says the person verified: user IDs, checked as they're read. */
function listed(store: EngineStore): string[] {
	const record = store.read<unknown>(VERIFIED_CONTACTS);
	return Array.isArray(record) ? record.filter((user): user is string => typeof user === "string") : [];
}
