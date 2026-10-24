import api from "$lib/api/api";
import type { UserStatus } from "$lib/types";

export interface FriendRequest {
	id: string;
	sender_id: string;
	recipient_id: string;
	created_at: string;
	updated_at: string;
	user_username: string;
	user_alias: string | null;
	user_avatar: string | null;
}

export interface Friend {
	id: string;
	request_id: string;
	sender_id: string;
	recipient_id: string;
	user_username: string;
	user_alias: string | null;
	user_avatar: string | null;
	/** The status the other user shows when the list was read: rememberFriendStatuses takes it. */
	status_id: UserStatus;
}

// The API returns the bare request, without the other user's details.
export async function sendFriendRequest(
	userId: string,
): Promise<Omit<FriendRequest, "user_username" | "user_alias" | "user_avatar">> {
	const res = await api.post("/api/users/@me/friends/requests", { user_id: userId });
	return res.data;
}

export async function getPendingRequests(): Promise<FriendRequest[]> {
	const res = await api.get("/api/users/@me/friends/requests");
	return res.data;
}

export async function getSentRequests(): Promise<FriendRequest[]> {
	const res = await api.get("/api/users/@me/friends/requests/sent");
	return res.data;
}

export async function acceptFriendRequest(requestId: string): Promise<Friend> {
	const res = await api.post(`/api/users/@me/friends/requests/${requestId}/accept`);
	return res.data;
}

export async function rejectFriendRequest(requestId: string): Promise<void> {
	await api.delete(`/api/users/@me/friends/requests/${requestId}`);
}

export async function getFriends(): Promise<Friend[]> {
	const res = await api.get("/api/users/@me/friends");
	return res.data;
}

export async function unfriend(userId: string): Promise<void> {
	await api.delete(`/api/users/@me/friends/${userId}`);
}
