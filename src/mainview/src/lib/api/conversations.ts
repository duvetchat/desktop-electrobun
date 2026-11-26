import api from "$lib/api/api";
import { createAckThrottle } from "$lib/api/ack";
import { messageSearchParams, type MessageSearch, type MessageSearchResponse } from "$lib/api/messages";
import type { CallNotice, GatewayMessage, MessageType, Presence } from "$lib/types";

export type ConversationType = 1 | 2; // 1 = DM, 2 = group

/** Its presence is the member's when the conversations list was read, or the conversation's CONVERSATION_CREATE sent
 * (their status and client status): rememberConversationStatuses and CONVERSATION_CREATE take it. An API from before
 * it leaves it out. */
export interface ConversationMember extends Partial<Presence> {
	id: string;
	conversation_id: string;
	user_id: string;
	created_at: string;
	updated_at: string;
	user: {
		id: string;
		username: string;
		alias: string | null;
		avatar: string | null;
		banner: string | null;
		/** The bio. */
		custom?: string;
		badges?: number;
		is_bot?: boolean;
	};
}

/** A conversation's MLS group (PLAN-E2E-API.md, E): its generation and epoch, its queue's last number and the number
 * it's whole from, and the number from which this session's device has had a leaf in it, null without one. Only a REST
 * answer has it: an event's conversation is a new one, with no group yet. */
export interface ConversationGroup {
	generation: number;
	epoch: number;
	last_seq: number;
	floor_seq: number;
	joined_seq: number | null;
}

export interface Conversation {
	id: string;
	type: ConversationType;
	name: string | null;
	owner_id: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	members: ConversationMember[];
	/** Made before end-to-end encryption came: any member may make its group (PLAN-E2E-API.md, E). The API always says. */
	legacy?: boolean;
	/** Its group, null without one. The API always says. */
	mls?: ConversationGroup | null;
}

export interface DirectMessage {
	id: string;
	conversation_id: string | null;
	/** Always set for a DM: the API's type allows null only because webhook room messages share the table. */
	author_id: string;
	content: string | null;
	type: MessageType;
	created_at: string;
	updated_at: string;
	nonce?: string;
	/** A message that didn't send whose only way on is its Dismiss: why, which shows under it (its files went with the
	 * app). Client-only. */
	unsent_note?: string;
	/** A message being sent: the newest message of its conversation the client knew of when it sent it (withPresent). */
	known_newest?: string;
	referenced_message?: import("$lib/types").ReferencedMessage | null;
	user?: {
		id: string;
		username: string;
		alias: string | null;
		avatar: string | null;
		banner: string | null;
		is_bot?: boolean;
	};
	attachments?: import("$lib/types").Attachment[] | null;
	reactions?: import("$lib/types").MessageReaction[] | null;
	embeds?: import("$lib/types").Embed[] | null;
	sticker_attachment_id?: string | null;
	/** When it was pinned; null while it isn't. Events that create or edit a message leave it out. */
	pinned_at?: string | null;
	/** A call notice's call: who was in it, and when. No other message has one. */
	call?: CallNotice;
	// An encrypted message's own (PLAN-E2E-API.md, G); a notice has none of them.
	/** Its MLS message, standard base64, which the core opens. */
	ciphertext?: string;
	/** Its number in its conversation's queue, and when the API took it (Unix ms): its entry's. */
	seq?: number;
	sent_at?: number;
	/** The group's generation and epoch it was made in. */
	generation?: number;
	epoch?: number;
	sender_device_id?: string;
	/** When its author last edited it. */
	edited_at?: string;
	/** Whom it mentions, as its sender listed them. */
	mentions?: string[];
	/** A shared history's notice (type 4): whom it was shared with, and how far back. */
	history_share?: { to_user_id: string; range: string };
}

export async function getConversations(): Promise<Conversation[]> {
	const res = await api.get("/api/users/@me/conversations");
	return res.data;
}

export async function createDM(userId: string): Promise<Conversation> {
	const res = await api.post("/api/users/@me/conversations", { type: 1, user_id: userId });
	return res.data;
}

export async function createGroup(name: string, userIds: string[]): Promise<Conversation> {
	const res = await api.post("/api/users/@me/conversations", { type: 2, name, user_ids: userIds });
	return res.data;
}

export async function updateConversation(conversationId: string, name: string): Promise<Conversation> {
	const res = await api.patch(`/api/users/@me/conversations/${conversationId}`, { name });
	return res.data;
}

export async function addConversationMember(conversationId: string, userId: string): Promise<ConversationMember> {
	const res = await api.post(`/api/users/@me/conversations/${conversationId}/members`, {
		user_id: userId,
	});
	return res.data;
}

export async function removeConversationMember(conversationId: string, userId: string): Promise<void> {
	await api.delete(`/api/users/@me/conversations/${conversationId}/members/${userId}`);
}

export async function leaveConversation(conversationId: string): Promise<void> {
	await api.delete(`/api/users/@me/conversations/${conversationId}/members/@me`);
}

export async function getDirectMessages(
	conversationId: string,
	before?: string,
	signal?: AbortSignal,
): Promise<DirectMessage[]> {
	const res = await api.get(`/api/users/@me/conversations/${conversationId}/messages`, {
		params: { count: "100", before },
		signal,
	});
	return res.data;
}

/** How many call notices a page of the call history asks for (the API takes 1 to 100). */
export const CALLS_PAGE_SIZE = 50;

/** The user's call notices, from every conversation they're in, the newest first: the page before `before` (a notice's
 * ID, the last of the page before), or the newest one. As a conversation's messages route gives them. */
export async function getCallHistory(before: string | null, signal?: AbortSignal): Promise<DirectMessage[]> {
	const res = await api.get<DirectMessage[]>("/api/users/@me/calls", {
		params: { before, limit: CALLS_PAGE_SIZE },
		signal,
	});
	return res.data;
}

export async function getDirectMessageById(
	conversationId: string,
	messageId: string,
	signal?: AbortSignal,
): Promise<DirectMessage> {
	const res = await api.get(`/api/users/@me/conversations/${conversationId}/messages/${messageId}`, { signal });
	return res.data;
}

/** A conversation message's reply thread, oldest first, shaped as a room's thread is. */
export async function getConversationMessageThread(
	conversationId: string,
	messageId: string,
	signal?: AbortSignal,
): Promise<GatewayMessage[]> {
	const res = await api.get(`/api/users/@me/conversations/${conversationId}/messages/${messageId}/thread`, { signal });
	return res.data;
}

/** A conversation's pinned messages, the last pinned first. */
export async function getConversationPins(conversationId: string, signal?: AbortSignal): Promise<DirectMessage[]> {
	const res = await api.get(`/api/users/@me/conversations/${conversationId}/pins`, { signal });
	return res.data;
}

/** Pins a message of a conversation, which posts the conversation's pin notice. */
export async function pinConversationMessage(conversationId: string, messageId: string): Promise<void> {
	await api.put(`/api/users/@me/conversations/${conversationId}/pins/${messageId}`);
}

export async function unpinConversationMessage(conversationId: string, messageId: string): Promise<void> {
	await api.delete(`/api/users/@me/conversations/${conversationId}/pins/${messageId}`);
}

export async function searchConversationMessages(
	conversationId: string,
	search: MessageSearch,
	signal?: AbortSignal,
): Promise<MessageSearchResponse<DirectMessage>> {
	const res = await api.get(
		`/api/users/@me/conversations/${conversationId}/messages/search?${messageSearchParams(search)}`,
		{ signal },
	);
	return res.data;
}

export async function getDirectMessagesAfter(
	conversationId: string,
	after: string,
	signal?: AbortSignal,
): Promise<DirectMessage[]> {
	const res = await api.get(`/api/users/@me/conversations/${conversationId}/messages/after`, {
		params: { count: "100", after },
		signal,
	});
	return res.data;
}

/** Tells the conversation the user is typing. */
export async function sendConversationTyping(conversationId: string): Promise<void> {
	await api.post(`/api/users/@me/conversations/${conversationId}/typing`);
}

/** Tells the conversation the user is recording a voice message. */
export async function sendConversationRecording(conversationId: string): Promise<void> {
	await api.post(`/api/users/@me/conversations/${conversationId}/recording`);
}

/** Deletes a conversation's notice (a pin's, a call's, a share's), its group's owner's, or either member's in a DM. An
 * encrypted message is its author's, deleted with their device's tombstone (lib/e2e: PLAN-E2E-CLIENTES.md, «Enviar»). */
export async function deleteDirectMessage(conversationId: string, messageId: string): Promise<void> {
	await api.delete(`/api/users/@me/conversations/${conversationId}/messages/${messageId}`);
}

const throttledConversationAck = createAckThrottle((conversationId, messageId) =>
	api.post(`/api/users/@me/conversations/${conversationId}/ack`, { message_id: messageId }).then(
		() => undefined,
		(err) => console.error(`[ack] failed for conversation=${conversationId} msg=${messageId}`, err),
	),
);

export function ackConversation(conversationId: string, messageId: string): Promise<void> {
	return throttledConversationAck(conversationId, messageId);
}
