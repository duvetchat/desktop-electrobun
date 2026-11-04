import api from "$lib/api/api";
import type { GatewayUser, Presence } from "$lib/types";

/** The other user of a friendship or a friend request: `user` is their public profile, and the user_* fields repeat
 * part of it, for the clients from before it. An API from before user_banner and user leaves them out: friendUser
 * ($lib/friends) reads the other user from whichever there is. */
export interface OtherUser {
	user_username: string;
	user_alias: string | null;
	user_avatar: string | null;
	user_banner?: string | null;
	user?: GatewayUser;
}

/** A request's other user is its sender in the requests received, and its recipient in the ones sent. */
export interface FriendRequest extends OtherUser {
	id: string;
	sender_id: string;
	recipient_id: string;
	created_at: string;
	updated_at: string;
}

/** Its presence is the other user's when the list was read (their status and client status): rememberFriendStatuses
 * takes it. */
export interface Friend extends OtherUser, Presence {
	id: string;
	request_id: string;
	sender_id: string;
	recipient_id: string;
}

// The API returns the bare request, without the other user.
export async function sendFriendRequest(userId: string): Promise<Omit<FriendRequest, keyof OtherUser>> {
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
