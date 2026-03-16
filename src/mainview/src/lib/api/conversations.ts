import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";

const HOST = getHostURL();

export type ConversationType = 1 | 2; // 1 = DM, 2 = group

export interface ConversationMember {
	id: string;
	conversation_id: string;
	user_id: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	users: {
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
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	nonce?: string;
	users?: {
		id: string;
		username: string;
		alias: string | null;
		avatar: string | null;
		banner: string | null;
	};
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
	before?: Date,
	signal?: AbortSignal,
): Promise<DirectMessage[]> {
	const query = new URLSearchParams({ count: "100" });
	if (before) query.set("before", before.toISOString());

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
): Promise<DirectMessage> {
	const res = await fetch(`${HOST}/api/users/@me/conversations/${conversationId}/messages`, {
		method: "POST",
		headers: authHeaders(),
		body: JSON.stringify({ content, nonce }),
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
