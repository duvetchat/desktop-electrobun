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
