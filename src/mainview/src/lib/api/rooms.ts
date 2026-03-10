import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";

import type { GatewayRoom, RoomType } from "$lib/types";

const HOST = getHostURL();

export async function createRoom(
	spaceId: string,
	name: string,
	type: RoomType,
	parentId?: string | null,
): Promise<GatewayRoom> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const payload: {
		name: string;
		type: RoomType;
		parent_id?: string;
	} = {
		name,
		type,
	};
	if (parentId) {
		payload.parent_id = parentId;
	}

	const response = await fetch(`${HOST}/api/spaces/${spaceId}/rooms`, {
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
		throw new Error(errorData.error || "Failed to create room");
	}

	return (await response.json()) as GatewayRoom;
}

export async function deleteRoom(
	spaceId: string,
	roomId: string,
): Promise<void> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/spaces/${spaceId}/rooms/${roomId}`,
		{
			method: "DELETE",
			headers: {
				Authorization: userSession.token,
			},
		},
	);

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as {
			error?: string;
		};
		throw new Error(errorData.error || "Failed to delete room");
	}
}

export async function createRoomInvite(
	spaceId: string,
	roomId: string,
): Promise<string> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/spaces/${spaceId}/rooms/${roomId}/invites`,
		{
			method: "POST",
			headers: {
				Authorization: userSession.token,
			},
		},
	);

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as {
			error?: string;
		};
		throw new Error(errorData.error || "Failed to create invite link");
	}

	const data = (await response.json()) as { code: string };
	return data.code;
}
