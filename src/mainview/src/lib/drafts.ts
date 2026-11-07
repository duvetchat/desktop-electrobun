import { get, writable } from "svelte/store";
import type { Message, ReferencedMessage } from "$lib/types";

/**
 * What's unsent in a room or a conversation, which stays when the user leaves it: the message box's text, mentions and
 * emojis as the API takes them, the files picked for it, and the reply being written. A command being filled in and an
 * edit in progress aren't part of it: they end on leaving.
 */
export interface ChatDraft {
	text: string;
	files: File[];
	replyTo: Message | null;
	/** The reply bar's @: whether the reply mentions the author of the message it replies to. */
	replyMention: boolean;
}

const NO_DRAFT: ChatDraft = { text: "", files: [], replyTo: null, replyMention: true };

/**
 * Each chat's draft, by its ID: one a chat, whichever panes show it. In memory only, so a READY, which remounts the
 * app, keeps them, and signing out, which loads another page, drops them.
 */
export const chatDrafts = writable<Record<string, ChatDraft>>({});

export function draftOf(drafts: Record<string, ChatDraft>, chatId: string): ChatDraft {
	return drafts[chatId] ?? NO_DRAFT;
}

/** Changes a chat's draft, and only that one. A draft left with nothing in it is forgotten. */
export function changeDraft(chatId: string, change: Partial<ChatDraft>) {
	chatDrafts.update((drafts) => {
		const draft = { ...draftOf(drafts, chatId), ...change };
		if (draft.text || draft.files.length > 0 || draft.replyTo) return { ...drafts, [chatId]: draft };
		if (!(chatId in drafts)) return drafts;
		const rest = { ...drafts };
		delete rest[chatId];
		return rest;
	});
}

/** The message a chat's draft replies to is gone: the draft goes on, as no reply. */
export function dropReplyTo(chatId: string, messageId: string) {
	if (get(chatDrafts)[chatId]?.replyTo?.id === messageId) changeDraft(chatId, { replyTo: null });
}

/** What a send took from its chat's draft, for a Cancel of its upload to give back: its text as the API takes it, its
 * files, and the message it replies to (null: none) with the reply bar's @. */
export interface SentDraft {
	text: string;
	files: File[];
	replyTo: Message | null;
	replyMention: boolean;
}

/**
 * What a message whose upload was cancelled took from its chat's draft goes back to it. Its files go after those the
 * draft has, as the mobile app puts them back in its tray. Its text and its reply, with its @, come back with them while
 * the draft has neither (blanks count as none): what the user wrote or picked since stays, and gets the files alone.
 */
export function putBack(chatId: string, sent: SentDraft) {
	const draft = draftOf(get(chatDrafts), chatId);
	const change: Partial<ChatDraft> = {};
	if (sent.files.length > 0) change.files = [...draft.files, ...sent.files];
	if (!draft.text.trim() && !draft.replyTo) {
		if (sent.text) change.text = sent.text;
		if (sent.replyTo) Object.assign(change, { replyTo: sent.replyTo, replyMention: sent.replyMention });
	}
	if (Object.keys(change).length > 0) changeDraft(chatId, change);
}

/** A send's reply as its Cancel can give it back: none once the message it replies to is deleted, which the send's copy
 * in the list says by its quote, left without a date ("Original message was deleted"), as the API refuses a reply to a
 * deleted message. */
export function withoutDeletedReply(
	sent: SentDraft,
	sending: { referenced_message?: ReferencedMessage | null },
): SentDraft {
	const quote = sending.referenced_message;
	const deleted = !!sent.replyTo && quote?.message_id === sent.replyTo.id && !quote.created_at;
	return deleted ? { ...sent, replyTo: null } : sent;
}
