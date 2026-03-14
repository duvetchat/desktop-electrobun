import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";

const HOST = getHostURL();

export interface UserPublic {
	id: string;
	username: string;
	alias: string | null;
	avatar: string | null;
}

export interface FriendRequest {
	id: string;
	sender_id: string;
	recipient_id: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface Friend {
	id: string;
	request_id: string;
	sender_id: string;
	recipient_id: string;
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

export async function sendFriendRequest(userId: string): Promise<FriendRequest> {
	const res = await fetch(`${HOST}/api/users/@me/friends/requests`, {
		method: "POST",
		headers: authHeaders(),
		body: JSON.stringify({ user_id: userId }),
	});
	return handleResponse<FriendRequest>(res);
}

export async function getPendingRequests(): Promise<FriendRequest[]> {
	const res = await fetch(`${HOST}/api/users/@me/friends/requests`, {
		headers: authHeaders(),
	});
	return handleResponse<FriendRequest[]>(res);
}

export async function getSentRequests(): Promise<FriendRequest[]> {
	const res = await fetch(`${HOST}/api/users/@me/friends/requests/sent`, {
		headers: authHeaders(),
	});
	return handleResponse<FriendRequest[]>(res);
}

export async function acceptFriendRequest(requestId: string): Promise<Friend> {
	const res = await fetch(`${HOST}/api/users/@me/friends/requests/${requestId}/accept`, {
		method: "POST",
		headers: authHeaders(),
	});
	return handleResponse<Friend>(res);
}

export async function rejectFriendRequest(requestId: string): Promise<void> {
	const res = await fetch(`${HOST}/api/users/@me/friends/requests/${requestId}`, {
		method: "DELETE",
		headers: authHeaders(),
	});
	return handleResponse<void>(res);
}

export async function getFriends(): Promise<Friend[]> {
	const res = await fetch(`${HOST}/api/users/@me/friends`, {
		headers: authHeaders(),
	});
	return handleResponse<Friend[]>(res);
}

export async function getUser(userId: string): Promise<UserPublic> {
	const res = await fetch(`${HOST}/api/users/${userId}`, {
		headers: authHeaders(),
	});
	return handleResponse<UserPublic>(res);
}

export async function unfriend(userId: string): Promise<void> {
	const res = await fetch(`${HOST}/api/users/@me/friends/${userId}`, {
		method: "DELETE",
		headers: authHeaders(),
	});
	return handleResponse<void>(res);
}
