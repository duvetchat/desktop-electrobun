// What this device's own database holds of the conversations' messages, by conversation and the API's IDs, as the views
// draw them (PLAN-E2E-CLIENTES.md, «La vista de una conversación»): the rows a view shows are asked for together, in the
// next batch, and asked again when the engine says it touched them (an apply, a send, an edit, a deletion), with how
// far it applied the conversation's queue. The person's own text, as typed, waits beside them until its row is there:
// never in a message the API wrote. Reads are reactive (createSubscriber, as lib/i18n.ts's t()), so what draws a message
// draws it again when its row comes; a row read the same keeps its object. The text lives in memory alone, and goes as
// its list lets it go or the engine stops. No rune: Bun's tests load it as it is, through the components that read it.
import { createSubscriber } from "svelte/reactivity";
import type { Held, MessageContent, ShownMessage } from "./engine/content";

/**
 * Reads the device's rows of these messages of the conversation, and how far its queue is applied: none (undefined)
 * before this session's first apply, null while this device is out of its group.
 */
export type Reader = (
	conversationId: string,
	ids: string[],
) => Promise<{ rows: ShownMessage[]; through?: number | null }>;

/** By conversation, then message ID: its row, or null for one this device doesn't hold. */
const held = new Map<string, Map<string, ShownMessage | null>>();
/** By conversation, then ID (a message's, or a nonce while it's being sent): the text the person typed. */
const typed = new Map<string, Map<string, string>>();
/** By conversation: how far the engine applied its queue (null: out of its group), once a read or an apply said. */
const through = new Map<string, number | null>();
/** The IDs asked for, by conversation, which a change asks for again. */
const asked = new Map<string, Set<string>>();
/** The IDs the next batch asks for, by conversation. */
const next = new Map<string, Set<string>>();
/** By conversation: the notices waiting for a message's text, each woken when the engine says it changed. */
const waiting = new Map<string, Set<() => void>>();
let reader: Reader | null = null;
let scheduled = false;

// What reads a row from an effect or a template runs again when the rows change: changed() tells them.
let changed = () => {};
const track = createSubscriber((update) => {
	changed = update;
	return () => (changed = () => {});
});

const mapOf = <T>(maps: Map<string, Map<string, T>>, key: string): Map<string, T> => {
	let map = maps.get(key);
	if (!map) maps.set(key, (map = new Map()));
	return map;
};
const setOf = (sets: Map<string, Set<string>>, key: string): Set<string> => {
	let set = sets.get(key);
	if (!set) sets.set(key, (set = new Set()));
	return set;
};

/** What reads the rows from now on, which reads again what was asked; none forgets everything read and typed. */
export function useReader(read: Reader | null) {
	reader = read;
	if (read) return refreshAll();
	for (const kept of [held, typed, through, asked, next]) kept.clear();
	changed();
}

/** What the device holds of a message of the conversation: undefined while not asked, null when it holds none. */
export function heldRow(conversationId: string, id: string): Held {
	track();
	return held.get(conversationId)?.get(id);
}

/**
 * What a view reads of the conversation's messages (lib/types' directMessageToMessage, lib/threads' withHeld), for
 * `user`, the person: their typed text only under a row naming them its author (#575, N-M5), whatever another names.
 */
export function contentOf(conversationId: string, user: string | undefined): MessageContent {
	return {
		held: (id) => heldRow(conversationId, id),
		typed: (id, author) => {
			track();
			return user !== undefined && author === user ? typed.get(conversationId)?.get(id) : undefined;
		},
		through: () => {
			track();
			return through.get(conversationId);
		},
	};
}

/** How long a message's notice waits for its text (PLAN-E2E-CLIENTES.md, task 20). */
export const NOTICE_WAIT_MS = 2_000;

/**
 * A message's text for its notice (task 20): what this device's database holds of it, from the author the API names,
 * read now and again each time the engine says the conversation changed (its entry applied), for `ms` at most. Null
 * without it by then, or for one without text: the notice says a message came. On the web, a tab without the core reads
 * it from the tab that has it, which tells it what changed. It isn't kept: it's the notice's alone.
 */
export async function deviceText(
	conversationId: string,
	id: string,
	author: string,
	ms = NOTICE_WAIT_MS,
): Promise<string | null> {
	const read = reader;
	if (!read) return null;
	let wake = () => {};
	const waiter = () => wake();
	let wakes = waiting.get(conversationId);
	if (!wakes) waiting.set(conversationId, (wakes = new Set()));
	wakes.add(waiter);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)));
	try {
		for (;;) {
			// A change that comes while it reads has it read again.
			const woke = new Promise<void>((resolve) => (wake = resolve));
			const answer = await Promise.race([read(conversationId, [id]).catch(() => undefined), late]);
			if (answer === null) return null;
			const row = answer?.rows.find((shown) => shown.message_id === id);
			if (row?.status === "ok" && row.user_id === author) return row.text;
			if ((await Promise.race([woke, late])) === null) return null;
		}
	} finally {
		clearTimeout(timer);
		wakes.delete(waiter);
		if (!wakes.size) waiting.delete(conversationId);
	}
}

/** The text the person typed of their own message (by its nonce while it's sent, then by its ID), until its row is there. */
export function keepTyped(conversationId: string, id: string, text: string) {
	mapOf(typed, conversationId).set(id, text);
	changed();
}

/** The person's own message just sent is known by its ID now, not its nonce: the text they typed goes with it, until
 * its row is there. */
export function moveTyped(conversationId: string, nonce: string, id: string) {
	const texts = typed.get(conversationId);
	const text = texts?.get(nonce);
	if (text === undefined) return;
	texts?.delete(nonce);
	if (held.get(conversationId)?.get(id)?.status !== "ok") texts?.set(id, text);
	changed();
}

/** Its pending row went (sent under another ID, or dismissed): its typed text goes with it. */
export function dropTyped(conversationId: string, id: string) {
	if (typed.get(conversationId)?.delete(id)) changed();
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

/**
 * The engine touched these messages of the conversation (all of them without `ids`), and says how far its queue is
 * applied: those the views asked for are asked again, and a notice waiting for one reads it again (deviceText).
 */
export function refresh(conversationId: string, ids?: readonly string[], applied?: number | null) {
	for (const wake of waiting.get(conversationId) ?? []) wake();
	if (applied !== undefined && through.get(conversationId) !== applied) {
		through.set(conversationId, applied);
		changed();
	}
	const known = asked.get(conversationId);
	if (!known?.size) return;
	for (const id of ids ?? known) if (known.has(id)) setOf(next, conversationId).add(id);
	schedule();
}

/** Every conversation's rows asked for again: as the device becomes ready, they may be there now. */
export function refreshAll() {
	for (const conversationId of asked.keys()) refresh(conversationId);
}

/**
 * The conversation's list let go of its rows but `keep` (all of them without it): so does this, to read them again if
 * they show again. The typed text stays, which a pending row's Retry sends.
 */
export function letGo(conversationId: string, keep?: ReadonlySet<string>) {
	for (const sets of [asked, next]) {
		const ids = sets.get(conversationId);
		for (const id of ids ?? []) if (!keep?.has(id)) ids?.delete(id);
	}
	const rows = held.get(conversationId);
	for (const id of rows?.keys() ?? []) if (!keep?.has(id)) rows?.delete(id);
	if (!keep) through.delete(conversationId);
	changed();
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
			const answer = await read(conversationId, [...ids]);
			const byId = new Map(answer.rows.map((row) => [row.message_id, row]));
			const rows = mapOf(held, conversationId);
			// A read's number fills it in or moves it on: one taken before an apply never sets back what that apply said.
			const was = through.get(conversationId);
			const now = answer.through;
			const fills = now !== undefined && (was === undefined || (was !== null && now !== null && now > was));
			let any = fills;
			if (fills) through.set(conversationId, now);
			for (const id of ids) {
				// Asked meanwhile no more (its list let it go): not kept.
				if (!asked.get(conversationId)?.has(id)) continue;
				const row = byId.get(id) ?? null;
				if (row?.status === "ok") typed.get(conversationId)?.delete(id);
				// The same row again keeps the one held, which its message is drawn from.
				if (rows.has(id) && JSON.stringify(rows.get(id)) === JSON.stringify(row)) continue;
				rows.set(id, row);
				any = true;
			}
			if (any) changed();
		} catch (error) {
			// Not now (no core open yet, or it closed): asked for again with the next change, or as the device is ready.
			console.error("[e2e] A conversation's messages weren't read from this device:", error);
		}
	}
}
