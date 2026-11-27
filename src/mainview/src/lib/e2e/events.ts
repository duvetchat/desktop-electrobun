// What the encryption engine hears of the gateway (PLAN-E2E-CLIENTES.md, «El motor»: its `events`): connection.ts hands
// it end-to-end encryption's events (PLAN-E2E-API.md, its events) and READY, in the order they come. The first nine are
// the engine's alone: nothing else in the app reads them. A DM's messages, a conversation's change (its owner handed on,
// #550) and READY are the app's too: the engine hears a DM's message first, so its entry reaches the core before the
// views ask it for its text, and the others once the app took them. Listeners read what they're handed, and change none
// of it.
import type { GatewayEventPayload } from "$lib/types";

const ENGINE_EVENTS = [
	"MLS_COMMIT",
	"MLS_WELCOME",
	"MLS_PROPOSAL",
	"DEVICE_MESSAGE",
	"KEY_PACKAGES_LOW",
	"DEVICE_ADD",
	"DEVICE_REMOVE",
	"IDENTITY_UPDATE",
	"HISTORY_SHARE_CREATE",
	"DM_MESSAGE_CREATE",
	"DM_MESSAGE_UPDATE",
	"DM_MESSAGE_DELETE",
	"CONVERSATION_UPDATE",
	"READY",
] as const;

export type EngineEvent = Extract<GatewayEventPayload, { type: (typeof ENGINE_EVENTS)[number] }>;

/** The engine's `events`: each listener hears every event, until it stops. */
export interface EngineEvents {
	listen(listener: (event: EngineEvent) => void): () => void;
}

const listeners = new Set<(event: EngineEvent) => void>();

export const engineEvents: EngineEvents = {
	listen(listener) {
		listeners.add(listener);
		return () => void listeners.delete(listener);
	},
};

export function isEngineEvent(payload: GatewayEventPayload): payload is EngineEvent {
	return (ENGINE_EVENTS as readonly string[]).includes(payload.type);
}

/** Hands the event to each listener: one that throws is logged, and the others hear it all the same. */
export function toEngine(event: EngineEvent): void {
	for (const listener of listeners) {
		try {
			listener(event);
		} catch (error) {
			console.error(`[e2e] The engine failed on ${event.type}:`, error);
		}
	}
}
