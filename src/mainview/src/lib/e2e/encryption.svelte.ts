// What the views read of encryption (PLAN-E2E-CLIENTES.md, «El motor», its states), apart from the engine that writes
// it (engine.svelte.ts, in the tab that runs it; the other tabs follow theirs): a page of another window, which runs
// no engine, reads it without loading the engine or the gateway's connection. Space settings' members list a member's
// menu there too, whose Verify security number waits for a ready engine.
import { writable } from "svelte/store";
import type { BackupShown } from "./engine/backup";
import type { ContactsShown } from "./engine/contacts";
import type { EngineState, SharedOffer } from "./engine/engine";
import type { ConversationState } from "./engine/sync";

export const encryption = $state<{
	state: EngineState;
	conversations: Record<string, ConversationState>;
	/** The members' shares of each conversation's history this device offers, until the person adds them (Task 30). */
	offers: Record<string, SharedOffer[]>;
	/** The cutover's instant, as the API gives it: a conversation from before it says when its messages went. */
	cutoverAt: string | null;
	/** The person's contacts as the engine holds them (contacts.ts): their changed keys, and whom they verified. */
	contacts: ContactsShown;
	/** What a ready device's encrypted backup shows (backup.ts): until the engine says, nothing is known to be up. */
	backup: BackupShown;
}>({
	state: { name: "starting" },
	conversations: {},
	offers: {},
	cutoverAt: null,
	contacts: { changes: {}, verified: {} },
	backup: { state: "uploading" },
});

/**
 * Whose security number the app's dialog opens on (SafetyNumberDialog, in the main window): a contact's profile and
 * menu, and a changed key's notice, ask for it.
 */
export const safetyNumberRequest = writable<{ id: string; name: string } | null>(null);
