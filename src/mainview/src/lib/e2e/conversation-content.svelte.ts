// What this device's own database holds of the conversations' messages, by the API's IDs, as the views draw them
// (PLAN-E2E-CLIENTES.md, «La vista de una conversación»): the rows a view shows are asked for together, in the next
// batch, and asked again when the engine says their conversation's messages changed (after each apply, send, edit or
// deletion). `heldRow` is a reactive read (createSubscriber, as lib/i18n.ts's t()), so what draws a message draws it
// again when its row comes; a row read again the same keeps its object. The text lives in memory alone, and goes as the
// engine stops. No rune: Bun's tests load it as it is, through the components that read it.
import { createSubscriber } from "svelte/reactivity";
import type { Held, ShownMessage } from "./engine/content";

/** Reads the device's rows of these messages of the conversation: the page's engine, or the tab that leads. */
export type Reader = (conversationId: string, ids: string[]) => Promise<ShownMessage[]>;

/** By message ID: its row, or null for one this device doesn't hold. */
const held = new Map<string, ShownMessage | null>();
/** The IDs asked for, by conversation, which a change asks for again. */
const asked = new Map<string, Set<string>>();
/** The IDs the next batch asks for, by conversation. */
const next = new Map<string, Set<string>>();
let reader: Reader | null = null;
let scheduled = false;

// What reads a row from an effect or a template runs again when the rows change: changed() tells them.
let changed = () => {};
const track = createSubscriber((update) => {
	changed = update;
	return () => (changed = () => {});
});

/** What reads the rows from now on, which reads again what was asked; none forgets everything read. */
export function useReader(read: Reader | null) {
	reader = read;
	if (read) return refreshAll();
	held.clear();
	asked.clear();
	next.clear();
	changed();
}

/** What the device holds of a message: undefined while it hasn't been asked, null when it holds nothing of it. */
export function heldRow(id: string): Held {
	track();
	return held.get(id);
}

/** A view shows these messages of the conversation: those not asked for yet go in the next batch. */
export function want(conversationId: string, ids: Iterable<string>) {
	const known = setOf(asked, conversationId);
	for (const id of ids) {
		if (known.has(id)) continue;
		known.add(id);
		setOf(next, conversationId).add(id);
	}
	schedule();
}

/** The conversation's messages changed on this device: what the views asked of it is asked again. */
export function refresh(conversationId: string) {
	const known = asked.get(conversationId);
	if (!known?.size) return;
	for (const id of known) setOf(next, conversationId).add(id);
	schedule();
}

/** Every conversation's rows asked for again: as the device becomes ready, they may be there now. */
export function refreshAll() {
	for (const conversationId of asked.keys()) refresh(conversationId);
}

function setOf(sets: Map<string, Set<string>>, key: string): Set<string> {
	let set = sets.get(key);
	if (!set) sets.set(key, (set = new Set()));
	return set;
}

function schedule() {
	if (scheduled || next.size === 0) return;
	scheduled = true;
	queueMicrotask(() => void readNext());
}

async function readNext() {
	scheduled = false;
	const read = reader;
	if (!read) return;
	for (const [conversationId, ids] of [...next]) {
		next.delete(conversationId);
		try {
			const rows = await read(conversationId, [...ids]);
			const byId = new Map(rows.map((row) => [row.message_id, row]));
			let any = false;
			for (const id of ids) {
				const row = byId.get(id) ?? null;
				// The same row again keeps the one held, which its message is drawn from.
				if (held.has(id) && JSON.stringify(held.get(id)) === JSON.stringify(row)) continue;
				held.set(id, row);
				any = true;
			}
			if (any) changed();
		} catch (error) {
			// Not now (no core open yet, or it closed): asked for again with the next change, or as the device is ready.
			console.error("[e2e] A conversation's messages weren't read from this device:", error);
		}
	}
}
