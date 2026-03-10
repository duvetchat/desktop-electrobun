import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";
import type { GatewayUser, GatewayMember } from "$lib/types";

const HOST = getHostURL();

export const MEMBERS_PAGE_SIZE = 50;

export interface SpaceMemberWithUser extends GatewayMember {
	users: GatewayUser;
	max_pos: number;
}

export async function createSpace(
	name: string,
	description?: string,
): Promise<void> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const payload: { name: string; description?: string } = { name };
	if (description) payload.description = description;

	const response = await fetch(`${HOST}/api/spaces`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: userSession.token,
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as {
			error?: string;
		};
		throw new Error(errorData.error || "Failed to create server");
	}
}

export async function getSpaceMembers(
	spaceId: string,
	cursor?: { id: string; pos: number | null },
	signal?: AbortSignal,
): Promise<SpaceMemberWithUser[]> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const query = new URLSearchParams({ count: String(MEMBERS_PAGE_SIZE) });
	if (cursor) {
		query.set("after_id", cursor.id);
		if (cursor.pos != null) query.set("after_pos", String(cursor.pos));
	}

	const response = await fetch(
		`${HOST}/api/spaces/${spaceId}/members?${query}`,
		{
			headers: { Authorization: userSession.token },
			signal,
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch space members: ${await response.text()}`);
	}

	return response.json() as Promise<SpaceMemberWithUser[]>;
}

export async function getSpaceMember(
	spaceId: string,
	memberId: string,
): Promise<SpaceMemberWithUser> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/spaces/${spaceId}/members/${memberId}`,
		{
			headers: { Authorization: userSession.token },
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch space member: ${await response.text()}`);
	}

	return response.json() as Promise<SpaceMemberWithUser>;
}

export async function leaveSpace(spaceId: string): Promise<void> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(`${HOST}/api/spaces/${spaceId}/members/@me`, {
		method: "DELETE",
		headers: { Authorization: userSession.token },
	});

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as {
			error?: string;
		};
		throw new Error(errorData.error || "Failed to leave server");
	}
}
