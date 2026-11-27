// The record of a conversation's people (PLAN-E2E-CLIENTES.md, «Entrar a un grupo»; Ruling 14; #574): who this device
// can account for in it, which the group it founds and every welcome and external commit into it are held to (the
// core's `expected`). For a conversation from before the cutover, its owner and members as this device first listed
// them, until the person says yes to the members of today: then the record goes, and none is made again for that
// conversation. For one the person made here, this user and those they picked, of the kind they asked for, as it's
// made: it goes once this device holds its group, which changes only by its own rules from then on. The session holds
// what it made or let go, so a store that can't keep it (its storage full or refused) still holds the conversation to
// it until the app closes.
import type { Conversation } from "$lib/api/conversations";
import { sameUsers } from "./members";
import type { EngineStore } from "./store";

/** The records, by conversation: false for one whose record the person let go. */
export const LEGACY_RECORDS = "legacy_records";

/** What this session made or let go, by store: it comes before what the store has, which may not have it. */
const session = new WeakMap<EngineStore, Map<string, LegacyRecord | false>>();

/** A record as the core's `expected` takes it: a group's with its owner, a DM's without one. */
export interface LegacyRecord {
	owner?: string;
	members: string[];
}

/** A record as the store kept it, or null for anything else. */
function recordIn(kept: unknown): LegacyRecord | false | null {
	if (kept === false) return false;
	if (typeof kept !== "object" || kept === null || !("members" in kept)) return null;
	const { members } = kept;
	const owner = "owner" in kept ? kept.owner : undefined;
	if (!Array.isArray(members) || !members.every((member) => typeof member === "string")) return null;
	if (owner !== undefined && typeof owner !== "string") return null;
	return owner === undefined ? { members } : { owner, members };
}

function records(store: EngineStore): Map<string, LegacyRecord | false> {
	const kept = store.read<unknown>(LEGACY_RECORDS);
	const read = new Map<string, LegacyRecord | false>();
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
function heldBy(store: EngineStore): Map<string, LegacyRecord | false> {
	let held = session.get(store);
	if (!held) session.set(store, (held = new Map()));
	return held;
}

/** A conversation's record, kept for the session and in the store, with every other this session holds. */
function keep(store: EngineStore, conversationId: string, record: LegacyRecord | false) {
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
	if (record !== undefined) return record || null;
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

/** The person made the conversation here: its record is this user and their picks, of the kind they asked for. */
export const keepMade = (store: EngineStore, conversationId: string, record: LegacyRecord) =>
	keep(store, conversationId, record);

/** The person said yes to the members of today: the record goes, and none is made again. */
export const dropRecord = (store: EngineStore, conversationId: string) => keep(store, conversationId, false);

/**
 * This device holds the group of a conversation made after the cutover: its record goes from the store, and this
 * session holds none for it from now on.
 */
export function forgetRecord(store: EngineStore, conversationId: string) {
	const kept = records(store);
	if (!kept.get(conversationId)) return;
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
