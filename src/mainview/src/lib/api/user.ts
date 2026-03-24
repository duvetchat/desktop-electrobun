import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";

const HOST = getHostURL();

interface UserMeResult {
	id: string;
	username: string;
	email: string;
	email_verified: boolean;
	password: string;
	alias: string;
	birthdate: string | null;
	phone: string | null;
	avatar: string | null;
	banner: string | null;
	custom: string;
	status_id: string;
	created_at: string;
	updated_at: string;
}

export interface UpdateUserPayload {
	username?: string;
	alias?: string | null;
	avatar?: string | null;
	banner?: string | null;
}

export async function updateUser(data: UpdateUserPayload): Promise<UserMeResult> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(`${HOST}/api/users/me`, {
		method: "PATCH",
		headers: {
			Authorization: userSession.token,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(data),
	});

	if (!response.ok) {
		throw new Error(`Failed to update profile: ${await response.text()}`);
	}

	return response.json() as Promise<UserMeResult>;
}

export interface UserAttachment {
	id: string;
	message_id: string;
	filename: string;
	content_type: string;
	size_bytes: number;
	width?: number | null;
	height?: number | null;
	created_at: string;
}

export interface StorageStatus {
	used_bytes: number;
	max_bytes: number;
	upload_limit_bytes: number;
	percentage_used: number;
}

export async function getMyStorageStatus(): Promise<StorageStatus> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/users/me/storage`, {
		headers: { Authorization: userSession.token },
	});
	if (!res.ok) throw new Error(`Failed to fetch storage status: ${await res.text()}`);
	return res.json() as Promise<StorageStatus>;
}

export async function getMyAttachments(): Promise<UserAttachment[]> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/users/me/attachments`, {
		headers: { Authorization: userSession.token },
	});
	if (!res.ok) throw new Error(`Failed to fetch attachments: ${await res.text()}`);
	return res.json() as Promise<UserAttachment[]>;
}

export async function deleteMyAttachment(id: string): Promise<void> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/users/me/attachments/${id}`, {
		method: "DELETE",
		headers: { Authorization: userSession.token },
	});
	if (!res.ok) throw new Error(`Failed to delete attachment: ${await res.text()}`);
}

export async function deleteAllMyAttachments(): Promise<void> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/users/me/attachments`, {
		method: "DELETE",
		headers: { Authorization: userSession.token },
	});
	if (!res.ok) throw new Error(`Failed to delete attachments: ${await res.text()}`);
}

export async function me(): Promise<UserMeResult> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(`${HOST}/api/users/me`, {
		headers: {
			Authorization: userSession.token,
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to get user info: ${await response.text()}`);
	}

	return response.json() as Promise<UserMeResult>;
}
