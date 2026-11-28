import type { ChatDraft } from "$lib/drafts";
import type { MessageContent } from "$lib/e2e/engine/content";
import type { Conversation, DirectMessage } from "$lib/api/conversations";
import { directMessageToMessage, type Message } from "$lib/types";

/**
 * A conversation's thread as the API answers it, each row built as the chat's list builds its own (lib/types'
 * directMessageToMessage, #613): a text or voice message and every quote draw what this device's own database holds of
 * them (PLAN-E2E-CLIENTES.md, «La vista de una conversación»), its files are the device's, a notice draws its own fields,
 * and nothing else the API sends draws as a member's: its components, its flags, its files, a row it made up.
 */
export const conversationThread = (
	thread: DirectMessage[],
	members: Conversation["members"],
	content: MessageContent,
): Message[] => thread.flatMap((message) => directMessageToMessage(message, members, content) ?? []);

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
