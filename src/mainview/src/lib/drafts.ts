import { get, writable } from "svelte/store";
import type { Message } from "$lib/types";

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
