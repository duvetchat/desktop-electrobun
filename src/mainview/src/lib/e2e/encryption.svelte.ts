// What the views read of encryption (PLAN-E2E-CLIENTES.md, «El motor», its states), apart from the engine that writes
// it (engine.svelte.ts, in the tab that runs it; the other tabs follow theirs): a page of another window, which runs
// no engine, reads it without loading the engine or the gateway's connection. Space settings' members list a member's
// menu there too, whose Verify security number waits for a ready engine.
import { writable } from "svelte/store";
import type { ContactsShown } from "./engine/contacts";
import type { EngineState } from "./engine/engine";
import type { ConversationState } from "./engine/sync";

export const encryption = $state<{
	state: EngineState;
	conversations: Record<string, ConversationState>;
	/** The cutover's instant, as the API gives it: a conversation from before it says when its messages went. */
	cutoverAt: string | null;
	/** The person's contacts as the engine holds them (contacts.ts): their changed keys, and whom they verified. */
	contacts: ContactsShown;
}>({
	state: { name: "starting" },
	conversations: {},
	cutoverAt: null,
	contacts: { changes: {}, verified: {} },
});

/**
 * Whose security number the app's dialog opens on (SafetyNumberDialog, in the main window): a contact's profile and
 * menu, and a changed key's notice, ask for it.
 */
export const safetyNumberRequest = writable<{ id: string; name: string } | null>(null);
