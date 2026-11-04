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

export interface Conversation {
	id: string;
	type: ConversationType;
	name: string | null;
	owner_id: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	members: ConversationMember[];
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

export async function sendDirectMessage(
	conversationId: string,
	content: string,
	nonce?: string,
	messageReference?: import("$lib/types").MessageReference,
	files?: File[],
	msgEmbeds?: import("$lib/types").Embed[],
	stickerAttachmentId?: string,
	allowedMentions?: import("$lib/types").AllowedMentions,
): Promise<DirectMessage> {
	if (files && files.length > 0) {
		const form = new FormData();
		form.append("content", content);
		if (nonce) form.append("nonce", nonce);
		if (messageReference) form.append("message_reference", JSON.stringify(messageReference));
		if (allowedMentions) form.append("allowed_mentions", JSON.stringify(allowedMentions));
		for (const f of files) form.append("files", f);

		const res = await api.post(`/api/users/@me/conversations/${conversationId}/messages`, form);
		return res.data;
	}

	const res = await api.post(`/api/users/@me/conversations/${conversationId}/messages`, {
		content,
		nonce,
		...(messageReference ? { message_reference: messageReference } : {}),
		...(allowedMentions ? { allowed_mentions: allowedMentions } : {}),
		...(msgEmbeds && msgEmbeds.length > 0 ? { embeds: msgEmbeds } : {}),
		...(stickerAttachmentId ? { sticker_attachment_id: stickerAttachmentId } : {}),
	});
	return res.data;
}

export async function sendDMVoiceNote(conversationId: string, audioBlob: Blob, nonce?: string): Promise<DirectMessage> {
	const form = new FormData();
	form.append("type", "1");
	if (nonce) form.append("nonce", nonce);
	form.append("files", audioBlob, "voice-note.webm");

	const res = await api.post(`/api/users/@me/conversations/${conversationId}/messages`, form);
	return res.data;
}

export async function updateDirectMessage(
	conversationId: string,
	messageId: string,
	content: string,
): Promise<DirectMessage> {
	const res = await api.patch(`/api/users/@me/conversations/${conversationId}/messages/${messageId}`, { content });
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
