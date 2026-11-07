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

/** How long what a Cancel put back is remembered for its message's create event (takeBack): longer than the API takes
 * to store a message's files once it has their bytes. */
export const PUT_BACK_KEPT_MS = 5 * 60_000;

// What each Cancel put back in its chat's draft, by the send's nonce, and until when it's remembered.
const putBacks = new Map<string, { chatId: string; back: SentDraft; until: number }>();

// Forgets what was put back too long ago, and its files with it.
function forgetOld(now: number) {
	for (const [nonce, put] of putBacks) if (put.until <= now) putBacks.delete(nonce);
}

/**
 * What a message whose upload was cancelled took from its chat's draft goes back to it. Its files go after those the
 * draft has, as the mobile app puts them back in its tray. Its text and its reply, with its @, come back with them while
 * the draft has neither (blanks count as none): what the user wrote or picked since stays, and gets the files alone.
 * What went back is remembered by the send's nonce, for takeBack.
 */
export function putBack(chatId: string, nonce: string, sent: SentDraft) {
	const now = Date.now();
	forgetOld(now);
	const draft = draftOf(get(chatDrafts), chatId);
	const whole = !draft.text.trim() && !draft.replyTo;
	const back: SentDraft = { ...sent, text: whole ? sent.text : "", replyTo: whole ? sent.replyTo : null };
	const change: Partial<ChatDraft> = {};
	if (back.files.length > 0) change.files = [...draft.files, ...back.files];
	if (back.text) change.text = back.text;
	if (back.replyTo) Object.assign(change, { replyTo: back.replyTo, replyMention: back.replyMention });
	if (Object.keys(change).length === 0) return;
	changeDraft(chatId, change);
	putBacks.set(nonce, { chatId, back, until: now + PUT_BACK_KEPT_MS });
}

/**
 * The message a Cancel stopped was posted after all, its create event says by its nonce: the API had its whole body as
 * the client gave up. What the Cancel put back in its chat's draft and is still there as it was (the same files, the
 * same text, the same reply with its @) leaves it, so that sending it can't post the message twice; what the user
 * changed since stays. Says whether the nonce was one of those.
 */
export function takeBack(chatId: string, nonce: string): boolean {
	forgetOld(Date.now());
	const put = putBacks.get(nonce);
	if (!put || put.chatId !== chatId) return false;
	putBacks.delete(nonce);
	const { back } = put;
	const draft = draftOf(get(chatDrafts), chatId);
	const change: Partial<ChatDraft> = {};
	const files = draft.files.filter((f) => !back.files.includes(f));
	if (files.length < draft.files.length) change.files = files;
	if (back.text && draft.text === back.text) change.text = "";
	if (back.replyTo && draft.replyTo?.id === back.replyTo.id && draft.replyMention === back.replyMention) {
		Object.assign(change, { replyTo: null, replyMention: true });
	}
	if (Object.keys(change).length > 0) changeDraft(chatId, change);
	return true;
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
