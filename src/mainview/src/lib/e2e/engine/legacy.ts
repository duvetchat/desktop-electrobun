// The record of a conversation from before the cutover (PLAN-E2E-CLIENTES.md, «Entrar a un grupo»; Ruling 14): its
// owner and members as this device first listed them, which every welcome and external commit into its group is held to
// (the core's `expected`), until the person says yes to the members of today. Then the record goes, and none is made
// again for that conversation. The session holds what it made or let go, so a store that can't keep it (its storage full
// or refused) still holds the conversation to it until the app closes.
import type { Conversation } from "$lib/api/conversations";
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

/** A conversation's record, kept for the session and in the store, with every other this session holds. */
function keep(store: EngineStore, conversationId: string, record: LegacyRecord | false) {
	let held = session.get(store);
	if (!held) session.set(store, (held = new Map()));
	held.set(conversationId, record);
	store.write(LEGACY_RECORDS, Object.fromEntries(records(store)));
}

/**
 * The conversation's record: none for one from after the cutover, or one whose record the person let go; else the one
 * kept, or, the first time this device sees the conversation, its owner (a group's) and members as listed now.
 */
export function legacyRecord(store: EngineStore, conv: Conversation): LegacyRecord | null {
	if (!conv.legacy) return null;
	const kept = records(store);
	const record = kept.get(conv.id);
	if (record !== undefined) return record || null;
	const members = conv.members.map((member) => member.user_id);
	const made = conv.type === 2 ? { owner: conv.owner_id, members } : { members };
	keep(store, conv.id, made);
	return made;
}

/** The person said yes to the members of today: the record goes, and none is made again. */
export const dropRecord = (store: EngineStore, conversationId: string) => keep(store, conversationId, false);
