import type { ChatDraft } from "$lib/drafts";
import type { Held } from "$lib/e2e/engine/content";
import { MessageType, type Message } from "$lib/types";

/**
 * A conversation's message of a thread, as the API gives it without its text, with what this device's own database
 * holds of it (PLAN-E2E-CLIENTES.md, «La vista de una conversación»): its text and its edit, or waiting for it once asked
 * and not held. A notice (a pin's, a call's, a share's) keeps its own.
 */
export function withHeld(message: Message, held: Held): Message {
	if (message.type !== MessageType.Text && message.type !== MessageType.Voice) return message;
	const shown = held?.status === "ok" ? held : null;
	return {
		...message,
		content: shown?.text ?? null,
		waiting: held !== undefined && !shown,
		updated_at: shown?.edited_at ? new Date(shown.edited_at).toISOString() : message.updated_at,
	};
}

/**
 * A thread as it is now: its messages as loaded, each as the chat's list has it now when it has it, and the replies to
 * any of them that the list has since, the user's own being sent among them, oldest first.
 */
export function threadNow(loaded: Message[], list: Message[]): Message[] {
	if (loaded.length === 0) return loaded;
	const listed = new Map(list.map((m) => [m.id, m]));
	const shown = new Map(loaded.map((m) => [m.id, listed.get(m.id) ?? m]));
	for (let grew = true; grew; ) {
		grew = false;
		for (const m of list) {
			const to = m.ref_message_id ?? m.referenced_message?.message_id;
			if (to && shown.has(to) && !shown.has(m.id)) {
				shown.set(m.id, m);
				grew = true;
			}
		}
	}
	return [...shown.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/**
 * What a reply in the thread of root replies to, from the thread's draft: the message of the thread picked there, with
 * its reply bar's @, or else root, mentioning its author as a reply does by default, as the mobile app's thread replies
 * to its root.
 */
export function threadReplyTarget(draft: ChatDraft, root: Message): { replyTo: Message; replyMention: boolean } {
	return draft.replyTo
		? { replyTo: draft.replyTo, replyMention: draft.replyMention }
		: { replyTo: root, replyMention: true };
}
