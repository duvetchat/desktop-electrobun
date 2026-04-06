import api from "$lib/api/api";
import type { MessageType } from "$lib/types";

export type ConversationType = 1 | 2; // 1 = DM, 2 = group

export interface ConversationMember {
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
): Promise<DirectMessage> {
	if (files && files.length > 0) {
		const form = new FormData();
		form.append("content", content);
		if (nonce) form.append("nonce", nonce);
		if (messageReference) form.append("message_reference", JSON.stringify(messageReference));
		for (const f of files) form.append("files", f);

		const res = await api.post(`/api/users/@me/conversations/${conversationId}/messages`, form);
		return res.data;
	}

	const res = await api.post(`/api/users/@me/conversations/${conversationId}/messages`, {
		content,
		nonce,
		...(messageReference ? { message_reference: messageReference } : {}),
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

export async function sendConversationTyping(conversationId: string): Promise<void> {
	await api.post(`/api/users/@me/conversations/${conversationId}/typing`);
}

export async function deleteDirectMessage(conversationId: string, messageId: string): Promise<void> {
	await api.delete(`/api/users/@me/conversations/${conversationId}/messages/${messageId}`);
}

export async function ackConversation(conversationId: string, messageId: string): Promise<void> {
	await api.post(`/api/users/@me/conversations/${conversationId}/ack`, { message_id: messageId });
}
