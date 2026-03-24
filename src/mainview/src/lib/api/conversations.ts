import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";
import type { MessageType } from '$lib/types';

const HOST = getHostURL();

export type ConversationType = 1 | 2; // 1 = DM, 2 = group

export interface ConversationMember {
	id: string;
	conversation_id: string;
	user_id: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	user: {
		id: string;
		username: string;
		alias: string | null;
		avatar: string | null;
		banner: string | null;
		status_id: number;
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
	room_id: string | null;
	conversation_id: string | null;
	author_id: string;
	content: string;
	type: MessageType;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	nonce?: string;
	ref_message_id?: string | null;
	referenced_message?: import("$lib/types").ReferencedMessage | null;
	user?: {
		id: string;
		username: string;
		alias: string | null;
		avatar: string | null;
		banner: string | null;
	};
	attachments?: import("$lib/types").Attachment[] | null;
}

function authHeaders(): HeadersInit {
	if (!userSession.token) throw new Error("No user session token found");
	return { Authorization: userSession.token, "Content-Type": "application/json" };
}

async function handleResponse<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const err = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(err.error || `Request failed: ${res.status}`);
	}
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}

export async function getConversations(): Promise<Conversation[]> {
	const res = await fetch(`${HOST}/api/users/@me/conversations`, {
		headers: authHeaders(),
	});
	return handleResponse<Conversation[]>(res);
}

export async function createDM(userId: string): Promise<Conversation> {
	const res = await fetch(`${HOST}/api/users/@me/conversations`, {
		method: "POST",
		headers: authHeaders(),
		body: JSON.stringify({ type: 1, user_id: userId }),
	});
	return handleResponse<Conversation>(res);
}

export async function createGroup(name: string, userIds: string[]): Promise<Conversation> {
	const res = await fetch(`${HOST}/api/users/@me/conversations`, {
		method: "POST",
		headers: authHeaders(),
		body: JSON.stringify({ type: 2, name, user_ids: userIds }),
	});
	return handleResponse<Conversation>(res);
}

export async function updateConversation(conversationId: string, name: string): Promise<Conversation> {
	const res = await fetch(`${HOST}/api/users/@me/conversations/${conversationId}`, {
		method: "PATCH",
		headers: authHeaders(),
		body: JSON.stringify({ name }),
	});
	return handleResponse<Conversation>(res);
}

export async function addConversationMember(conversationId: string, userId: string): Promise<ConversationMember> {
	const res = await fetch(`${HOST}/api/users/@me/conversations/${conversationId}/members`, {
		method: "POST",
		headers: authHeaders(),
		body: JSON.stringify({ user_id: userId }),
	});
	return handleResponse<ConversationMember>(res);
}

export async function removeConversationMember(conversationId: string, userId: string): Promise<void> {
	const res = await fetch(`${HOST}/api/users/@me/conversations/${conversationId}/members/${userId}`, {
		method: "DELETE",
		headers: authHeaders(),
	});
	return handleResponse<void>(res);
}

export async function leaveConversation(conversationId: string): Promise<void> {
	const res = await fetch(`${HOST}/api/users/@me/conversations/${conversationId}/members/@me`, {
		method: "DELETE",
		headers: authHeaders(),
	});
	return handleResponse<void>(res);
}

export async function getDirectMessages(
	conversationId: string,
	before?: string,
	signal?: AbortSignal,
): Promise<DirectMessage[]> {
	const query = new URLSearchParams({ count: "100" });
	if (before) query.set("before", before);

	const res = await fetch(`${HOST}/api/users/@me/conversations/${conversationId}/messages?${query}`, {
		headers: authHeaders(),
		signal,
	});
	return handleResponse<DirectMessage[]>(res);
}

export async function sendDirectMessage(
	conversationId: string,
	content: string,
	nonce?: string,
	messageReference?: import("$lib/types").MessageReference,
	files?: File[],
): Promise<DirectMessage> {
	let body: BodyInit;
	let headers: HeadersInit = authHeaders();

	if (files && files.length > 0) {
		const form = new FormData();
		form.append("content", content);
		if (nonce) form.append("nonce", nonce);
		if (messageReference) form.append("message_reference", JSON.stringify(messageReference));
		for (const f of files) form.append("files", f);
		body = form;
		// Override Content-Type — let browser set boundary
		headers = { Authorization: userSession.token! };
	} else {
		body = JSON.stringify({
			content,
			nonce,
			...(messageReference ? { message_reference: messageReference } : {}),
		});
	}

	const res = await fetch(`${HOST}/api/users/@me/conversations/${conversationId}/messages`, {
		method: "POST",
		headers,
		body,
	});
	return handleResponse<DirectMessage>(res);
}

export async function sendDMVoiceNote(
	conversationId: string,
	audioBlob: Blob,
	nonce?: string,
): Promise<DirectMessage> {
	const form = new FormData();
	form.append("type", "1");
	if (nonce) form.append("nonce", nonce);
	form.append("files", audioBlob, "voice-note.webm");

	const res = await fetch(`${HOST}/api/users/@me/conversations/${conversationId}/messages`, {
		method: "POST",
		headers: { Authorization: userSession.token! },
		body: form,
	});
	return handleResponse<DirectMessage>(res);
}

export async function updateDirectMessage(
	conversationId: string,
	messageId: string,
	content: string,
): Promise<DirectMessage> {
	const res = await fetch(
		`${HOST}/api/users/@me/conversations/${conversationId}/messages/${messageId}`,
		{
			method: "PATCH",
			headers: authHeaders(),
			body: JSON.stringify({ content }),
		},
	);
	return handleResponse<DirectMessage>(res);
}

export async function sendConversationTyping(conversationId: string): Promise<void> {
	const res = await fetch(`${HOST}/api/users/@me/conversations/${conversationId}/typing`, {
		method: "POST",
		headers: authHeaders(),
	});
	return handleResponse<void>(res);
}

export async function deleteDirectMessage(
	conversationId: string,
	messageId: string,
): Promise<void> {
	const res = await fetch(
		`${HOST}/api/users/@me/conversations/${conversationId}/messages/${messageId}`,
		{
			method: "DELETE",
			headers: authHeaders(),
		},
	);
	return handleResponse<void>(res);
}

export async function ackConversation(conversationId: string, messageId: string): Promise<void> {
	if (!userSession.token) return;
	await fetch(`${HOST}/api/users/@me/conversations/${conversationId}/ack`, {
		method: "POST",
		headers: { ...authHeaders(), "Content-Type": "application/json" },
		body: JSON.stringify({ message_id: messageId }),
	});
}
