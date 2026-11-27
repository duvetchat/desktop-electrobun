// The record of a conversation's people (PLAN-E2E-CLIENTES.md, «Entrar a un grupo»; Ruling 14; #574): who this device
// can account for in it, which the group it founds and every welcome and external commit into it are held to (the
// core's `expected`). For a conversation from before the cutover, its owner and members as this device first listed
// them, until the person says yes to the members of today: then the record goes, and none is made again for that
// conversation. For one the person made here, this user and those they picked, of the kind they asked for, as it's
// made: it goes once this device holds its group, which changes only by its own rules from then on. For a group this
// device let go, as the API holds none or another one (#553), the core's record of it (forget_group's, `exact`): kept as
// the core gave it, in the place of what was kept, which is back once the device holds the group again. The session
// holds what it made or let go, so a store that can't keep it (its storage full or refused) still holds the
// conversation to it until the app closes.
import type { Conversation } from "$lib/api/conversations";
import { sameUsers } from "./members";
import type { EngineStore } from "./store";

/** The records, by conversation: false for one whose record the person let go. */
export const LEGACY_RECORDS = "legacy_records";

/** What this session made or let go, by store: it comes before what the store has, which may not have it. */
const session = new WeakMap<EngineStore, Map<string, Kept | false>>();

/** A record as the core's `expected` takes it: a group's with its owner, a DM's without one. */
export interface LegacyRecord {
	owner?: string;
	members: string[];
	/** A group this device let go (forget_group, #553): what brings it back has exactly these users and this owner. */
	exact?: true;
}

/**
 * A record as the store keeps it: `made`, the person's own (keepMade, keepChosen), which goes once its group is held;
 * `chosen`, their yes to the people a question named (keepChosen), which goes as the old yes did: let go, none made again;
 * `exact`, the core's of a group this device let go (keepForgotten), with what it took the place of (`under`), which is
 * back once the group is held.
 */
type Kept = LegacyRecord & { made?: true; chosen?: true; under?: Kept | false };

/** A record as the store kept it, or null for anything else. */
function recordIn(kept: unknown): Kept | false | null {
	if (kept === false) return false;
	if (typeof kept !== "object" || kept === null || !("members" in kept)) return null;
	const { members } = kept;
	const owner = "owner" in kept ? kept.owner : undefined;
	if (!Array.isArray(members) || !members.every((member) => typeof member === "string")) return null;
	if (owner !== undefined && typeof owner !== "string") return null;
	const record: Kept = owner === undefined ? { members } : { owner, members };
	if ("made" in kept && kept.made === true) record.made = true;
	if ("chosen" in kept && kept.chosen === true) record.chosen = true;
	if ("exact" in kept && kept.exact === true) {
		record.exact = true;
		// What it took the place of: one from before the cutover, or one let go, as afterHeld leaves them.
		const under = "under" in kept ? recordIn(kept.under) : null;
		if (under === false || (under && !under.exact && !under.made && !under.chosen)) record.under = under;
	}
	return record;
}

/**
 * What holding the conversation's group leaves of its record: one from before the cutover stays, the person's yes is
 * let go (false), their own picks go (none), and a forgotten group's gives back what it took the place of.
 */
function afterHeld(kept: Kept | false | undefined): Kept | false | undefined {
	if (kept === undefined || kept === false) return kept;
	if (kept.exact) return kept.under;
	if (kept.chosen) return false;
	return kept.made ? undefined : kept;
}

function records(store: EngineStore): Map<string, Kept | false> {
	const kept = store.read<unknown>(LEGACY_RECORDS);
	const read = new Map<string, Kept | false>();
	if (typeof kept === "object" && kept !== null) {
		for (const [id, value] of Object.entries(kept)) {
			const record = recordIn(value);
			if (record !== null) read.set(id, record);
		}
	}
	for (const [id, record] of session.get(store) ?? []) read.set(id, record);
	return read;
}

/** What this session holds of the store's records, made the first time it's asked. */
function heldBy(store: EngineStore): Map<string, Kept | false> {
	let held = session.get(store);
	if (!held) session.set(store, (held = new Map()));
	return held;
}

/** A conversation's record, kept for the session and in the store, with every other this session holds. */
function keep(store: EngineStore, conversationId: string, record: Kept | false) {
	heldBy(store).set(conversationId, record);
	store.write(LEGACY_RECORDS, Object.fromEntries(records(store)));
}

/**
 * The conversation's record: the one kept, of a conversation made here or from before the cutover; none for one whose
 * record went (let go, or its group held); else, for a conversation from before the cutover the first time this device
 * sees it, its owner (a group's) and members as listed now.
 */
export function legacyRecord(store: EngineStore, conv: Conversation): LegacyRecord | null {
	const record = records(store).get(conv.id);
	if (record !== undefined) return record ? peopleIn(record) : null;
	if (!conv.legacy) return null;
	const made = peopleOf(conv);
	keep(store, conv.id, made);
	return made;
}

/** A conversation's people as a record holds them: a group's owner and members, a DM's two users. */
export function peopleOf(conv: Conversation): LegacyRecord {
	const members = conv.members.map((member) => member.user_id);
	return conv.type === 2 ? { owner: conv.owner_id, members } : { members };
}

/** The record as the core's `expected` takes it, without the store's marks: a forgotten group's `exact` stays. */
const peopleIn = ({ made: _made, chosen: _chosen, under: _under, ...record }: Kept): LegacyRecord => record;

/** A record's people alone: its owner (a group's) and members, with nothing that holds the core more or less. */
const peopleAlone = ({ owner, members }: LegacyRecord): LegacyRecord =>
	owner === undefined ? { members } : { owner, members };

/**
 * The person made the conversation here: its record is this user and their picks, of the kind they asked for. Where one
 * is kept already (from before the cutover, made here, or let go), it stays (N-M2): the API's answer names the
 * conversation, a DM they already had or any it picks, and Ruling 14's question isn't the API's to take away.
 */
export function keepMade(store: EngineStore, conversationId: string, record: LegacyRecord) {
	if (!records(store).has(conversationId)) keep(store, conversationId, { ...record, made: true });
}

/**
 * Whether the conversation's record founds as it is: the person's own (their picks, their yes), or the core's of a group
 * this device let go (#553); never one made from a listing.
 */
export const recordMade = (store: EngineStore, conversationId: string) => {
	const record = records(store).get(conversationId);
	return !!record && (record.made === true || record.exact === true);
};

/**
 * The person's yes to the people its question named (N-M10): the record from now on, whatever was kept, which the
 * founding and every welcome and join are held to, and which goes once this device holds the group, as one made here.
 * A forgotten group's record goes with it, and so does what it took the place of: the yes is to the members of today.
 */
export const keepChosen = (store: EngineStore, conversationId: string, record: LegacyRecord) =>
	keep(store, conversationId, { ...peopleAlone(record), made: true, chosen: true });

/**
 * The core's record of a group this device let go (forget_group, #553), kept as it gave it (`exact`), in the place of
 * what was kept, which is back as holding the group leaves it (afterHeld) once the device holds the group again. Never
 * over the person's yes, which stands: the members they said yes to are the ones the group comes back with.
 */
export function keepForgotten(store: EngineStore, conversationId: string, record: LegacyRecord) {
	const kept = records(store).get(conversationId);
	if (kept && kept.chosen) return;
	const under = afterHeld(kept);
	keep(store, conversationId, { ...peopleAlone(record), exact: true, ...(under === undefined ? {} : { under }) });
}

/**
 * This device holds the conversation's group: a record the person made here goes from the store, and this session
 * holds none for it from now on; one of their yes is let go, none made again. One from before the cutover stays,
 * whatever the API says of the conversation now. A forgotten group's gives back what it took the place of (#553).
 */
export function forgetRecord(store: EngineStore, conversationId: string) {
	const kept = records(store);
	const record = kept.get(conversationId);
	if (!record) return;
	const after = afterHeld(record);
	if (after === record) return;
	// The person's yes to the members of today (Ruling 14), or what a forgotten group's record took the place of.
	if (after !== undefined) return keep(store, conversationId, after);
	heldBy(store).set(conversationId, false);
	kept.delete(conversationId);
	store.write(LEGACY_RECORDS, kept.size ? Object.fromEntries(kept) : null);
}

/**
 * Whether the conversation as the API lists it has the record's people (the core's is_record): its kind (a DM's
 * record has no owner) and a group's owner exactly, and its users whatever their order.
 */
export const isRecord = (conv: Conversation, record: LegacyRecord) =>
	conv.type === (record.owner === undefined ? 1 : 2) &&
	(record.owner === undefined || conv.owner_id === record.owner) &&
	sameUsers(
		conv.members.map((member) => member.user_id),
		record.members,
	);
