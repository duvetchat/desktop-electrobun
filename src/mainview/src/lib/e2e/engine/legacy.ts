// The record of a conversation from before the cutover (PLAN-E2E-CLIENTES.md, «Entrar a un grupo»; Ruling 14): its
// owner and members as this device first listed them, which every welcome and external commit into its group is held to
// (the core's `expected`), until the person says yes to the members of today. Then the record goes, and none is made
// again for that conversation.
import type { Conversation } from "$lib/api/conversations";
import type { EngineStore } from "./store";

/** The records, by conversation: false for one whose record the person let go. */
export const LEGACY_RECORDS = "legacy_records";

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
	if (typeof kept !== "object" || kept === null) return read;
	for (const [id, value] of Object.entries(kept)) {
		const record = recordIn(value);
		if (record !== null) read.set(id, record);
	}
	return read;
}

const write = (store: EngineStore, kept: Map<string, LegacyRecord | false>) =>
	store.write(LEGACY_RECORDS, Object.fromEntries(kept));

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
	kept.set(conv.id, made);
	write(store, kept);
	return made;
}

/** The person said yes to the members of today: the record goes, and none is made again. */
export function dropRecord(store: EngineStore, conversationId: string) {
	const kept = records(store);
	kept.set(conversationId, false);
	write(store, kept);
}
