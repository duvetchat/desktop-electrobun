import api from "$lib/api/api";
import type { GatewayMessage, MessageReference } from "$lib/types";

export async function getMessages(roomId: string, before?: string, signal?: AbortSignal): Promise<GatewayMessage[]> {
	const res = await api.get(`/api/rooms/${roomId}/messages`, {
		params: { count: "100", before },
		signal,
	});
	return res.data;
}

export async function getMessagesAfter(roomId: string, after: string, signal?: AbortSignal): Promise<GatewayMessage[]> {
	const res = await api.get(`/api/rooms/${roomId}/messages`, {
		params: { count: "100", after, order: "asc" },
		signal,
	});
	return res.data;
}

export async function getMessageById(roomId: string, messageId: string, signal?: AbortSignal): Promise<GatewayMessage> {
	const res = await api.get(`/api/rooms/${roomId}/messages/${messageId}`, { signal });
	return res.data;
}

export async function getMessageThread(
	roomId: string,
	messageId: string,
	signal?: AbortSignal,
): Promise<GatewayMessage[]> {
	const res = await api.get(`/api/rooms/${roomId}/messages/${messageId}/thread`, { signal });
	return res.data;
}

export async function sendMessage(
	roomId: string,
	content: string,
	nonce?: string,
	messageReference?: MessageReference,
	files?: File[],
	msgEmbeds?: import("$lib/types").Embed[],
	stickerAttachmentId?: string,
): Promise<GatewayMessage> {
	if (files && files.length > 0) {
		const form = new FormData();
		form.append("content", content);
		if (nonce) form.append("nonce", nonce);
		if (messageReference) form.append("message_reference", JSON.stringify(messageReference));
		for (const f of files) form.append("files", f);

		const res = await api.post(`/api/rooms/${roomId}/messages`, form);
		return res.data;
	}

	const res = await api.post(`/api/rooms/${roomId}/messages`, {
		content,
		nonce,
		...(messageReference ? { message_reference: messageReference } : {}),
		...(msgEmbeds && msgEmbeds.length > 0 ? { embeds: msgEmbeds } : {}),
		...(stickerAttachmentId ? { sticker_attachment_id: stickerAttachmentId } : {}),
	});
	return res.data;
}

export async function sendVoiceNote(roomId: string, audioBlob: Blob, nonce?: string): Promise<GatewayMessage> {
	const form = new FormData();
	form.append("type", "1");
	if (nonce) form.append("nonce", nonce);
	form.append("files", audioBlob, "voice-note.webm");

	const res = await api.post(`/api/rooms/${roomId}/messages`, form);
	return res.data;
}

export async function updateMessage(messageId: string, content: string, roomId: string): Promise<GatewayMessage> {
	const res = await api.patch(`/api/rooms/${roomId}/messages/${messageId}`, { content });
	return res.data;
}

export async function sendTypingIndicator(roomId: string): Promise<void> {
	await api.post(`/api/rooms/${roomId}/typing`).catch(() => {});
}

export async function deleteMessage(messageId: string, roomId: string): Promise<void> {
	await api.delete(`/api/rooms/${roomId}/messages/${messageId}`);
}

export async function ackRoom(roomId: string, messageId: string): Promise<void> {
	await api.post(`/api/rooms/${roomId}/ack`, { message_id: messageId }).catch((err) => {
		console.error(`[ack] failed for room=${roomId} msg=${messageId}`, err);
	});
}

export async function getMentionCounts(): Promise<Record<string, number>> {
	const res = await api.get("/api/users/@me/mentions/counts").catch(() => ({ data: {} }));
	return res.data;
}
