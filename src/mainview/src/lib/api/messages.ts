import api, { formBytes, MAX_REQUEST_BYTES, TooLargeError, type UploadOptions } from "$lib/api/api";
import { sealedSize } from "$lib/e2e/engine/files";
import { createAckThrottle } from "$lib/api/ack";
import type { AllowedMentions, GatewayMessage, MessageReference } from "$lib/types";

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

/** A message search. The values of each list are alternatives; different filters must all match. */
export interface MessageSearch {
	query?: string;
	authorIds?: string[];
	mentions?: string[];
	roomIds?: string[];
	has?: string[];
	/** Only the pinned messages (true) or only the others (false). */
	pinned?: boolean;
	/** ISO 8601 times. */
	before?: string;
	after?: string;
	/** The ID of the previous page's last message. */
	cursor?: string;
}

export interface MessageSearchResponse<T> {
	/** All the pages' messages, counted up to 1000. */
	total_results: number;
	/** This page, newest first. */
	messages: T[];
}

// The search's query string: each list's values repeat its key.
export function messageSearchParams(s: MessageSearch): string {
	const p = new URLSearchParams();
	if (s.query) p.set("query", s.query);
	for (const id of s.authorIds ?? []) p.append("author_id", id);
	for (const id of s.mentions ?? []) p.append("mentions", id);
	for (const id of s.roomIds ?? []) p.append("room_id", id);
	for (const v of s.has ?? []) p.append("has", v);
	if (s.pinned !== undefined) p.set("pinned", String(s.pinned));
	if (s.before) p.set("before", s.before);
	if (s.after) p.set("after", s.after);
	if (s.cursor) p.set("cursor", s.cursor);
	return p.toString();
}

export async function searchSpaceMessages(
	spaceId: string,
	search: MessageSearch,
	signal?: AbortSignal,
): Promise<MessageSearchResponse<GatewayMessage>> {
	const res = await api.get(`/api/spaces/${spaceId}/messages/search?${messageSearchParams(search)}`, { signal });
	return res.data;
}

/** A room's pinned messages, the last pinned first. */
export async function getRoomPins(roomId: string, signal?: AbortSignal): Promise<GatewayMessage[]> {
	const res = await api.get(`/api/rooms/${roomId}/pins`, { signal });
	return res.data;
}

/** Pins a message of a room, which posts the room's pin notice. */
export async function pinRoomMessage(roomId: string, messageId: string): Promise<void> {
	await api.put(`/api/rooms/${roomId}/pins/${messageId}`);
}

export async function unpinRoomMessage(roomId: string, messageId: string): Promise<void> {
	await api.delete(`/api/rooms/${roomId}/pins/${messageId}`);
}

export async function getMessageThread(
	roomId: string,
	messageId: string,
	signal?: AbortSignal,
): Promise<GatewayMessage[]> {
	const res = await api.get(`/api/rooms/${roomId}/messages/${messageId}/thread`, { signal });
	return res.data;
}

// What a message's form holds besides its text and files, at its largest: its nonce, its reply (message_reference) and
// allowed_mentions, as sendMessage writes them, each a field of its own.
const MESSAGE_FIELDS_BYTES = 2048;

// A conversation's message's ciphertext at its largest, in base64 (32 KiB of it), and the ID each of its files goes up
// with: what its form holds in place of a room's text.
const CIPHERTEXT_BYTES = Math.ceil((32 << 10) / 3) * 4;
const FILE_ID_BYTES = 64;

/** Why the API would refuse a message with files for its size, as the message box says it, or null: its text and files
 * as a send puts them in its form, with room for its other fields. Such a message isn't sent (#182). A conversation's
 * (`sealed`) goes up as its ciphertext and its files sealed, each part of 64 KiB with its tag (PLAN-E2E-CLIENTES.md,
 * «Adjuntos»): their thumbnails apart, a few KiB, are left to the form's own check as it's sent. A sealed file is also
 * held to `fileLimit`, the cap of where it goes (the API's checkUploadLimit), whose 413 stays the last word. */
export function messageTooLarge(
	content: string,
	files: File[],
	sealed = false,
	fileLimit: number | null = null,
): string | null {
	if (files.length === 0) return null;
	const over = sealed && fileLimit !== null ? files.find((f) => sealedSize(f.size) > fileLimit) : undefined;
	if (over && fileLimit !== null) return new TooLargeError(sealedSize(over.size), "file", fileLimit).message;
	const form = new FormData();
	if (!sealed) form.append("content", content);
	for (const f of files) form.append("files", f);
	let bytes = formBytes(form) + MESSAGE_FIELDS_BYTES;
	if (sealed) {
		bytes += CIPHERTEXT_BYTES;
		for (const f of files) bytes += sealedSize(f.size) - f.size + FILE_ID_BYTES;
	}
	return bytes > MAX_REQUEST_BYTES ? new TooLargeError(bytes, "message").message : null;
}

/** Sends a message to a room: with files, as a form, its text and files together, which upload follows. */
export async function sendMessage(
	roomId: string,
	content: string,
	nonce?: string,
	messageReference?: MessageReference,
	files?: File[],
	msgEmbeds?: import("$lib/types").Embed[],
	stickerAttachmentId?: string,
	allowedMentions?: AllowedMentions,
	upload?: UploadOptions,
): Promise<GatewayMessage> {
	if (files && files.length > 0) {
		const form = new FormData();
		form.append("content", content);
		if (nonce) form.append("nonce", nonce);
		if (messageReference) form.append("message_reference", JSON.stringify(messageReference));
		if (allowedMentions) form.append("allowed_mentions", JSON.stringify(allowedMentions));
		for (const f of files) form.append("files", f);

		const res = await api.post(`/api/rooms/${roomId}/messages`, form, upload);
		return res.data;
	}

	const res = await api.post(`/api/rooms/${roomId}/messages`, {
		content,
		nonce,
		...(messageReference ? { message_reference: messageReference } : {}),
		...(allowedMentions ? { allowed_mentions: allowedMentions } : {}),
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

/** Tells the room the user is typing. */
export async function sendTypingIndicator(roomId: string): Promise<void> {
	await api.post(`/api/rooms/${roomId}/typing`).catch(() => {});
}

/** Tells the room the user is recording a voice message. */
export async function sendRecordingIndicator(roomId: string): Promise<void> {
	await api.post(`/api/rooms/${roomId}/recording`).catch(() => {});
}

export async function deleteMessage(messageId: string, roomId: string): Promise<void> {
	await api.delete(`/api/rooms/${roomId}/messages/${messageId}`);
}

const throttledRoomAck = createAckThrottle((roomId, messageId) =>
	api.post(`/api/rooms/${roomId}/ack`, { message_id: messageId }).then(
		() => undefined,
		(err) => console.error(`[ack] failed for room=${roomId} msg=${messageId}`, err),
	),
);

export function ackRoom(roomId: string, messageId: string): Promise<void> {
	return throttledRoomAck(roomId, messageId);
}

export async function getMentionCounts(): Promise<Record<string, number>> {
	const res = await api.get("/api/users/@me/mentions/counts").catch(() => ({ data: {} }));
	return res.data;
}
