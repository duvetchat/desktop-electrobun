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

export async function updateRoom(
	spaceId: string,
	roomId: string,
	payload: { name?: string; description?: string | null; clear_description?: boolean },
): Promise<GatewayRoom> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(`${HOST}/api/spaces/${spaceId}/rooms/${roomId}`, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			Authorization: userSession.token,
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(errorData.error || "Failed to update room");
	}

	return (await response.json()) as GatewayRoom;
}

export async function upsertRoomOverwrite(
	spaceId: string,
	roomId: string,
	targetId: string,
	targetType: number,
	allowFlags: number,
	denyFlags: number,
): Promise<import("$lib/types").GatewayRoomOverwrite> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(`${HOST}/api/spaces/${spaceId}/rooms/${roomId}/overwrites`, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			Authorization: userSession.token,
		},
		body: JSON.stringify({
			target_id: targetId,
			target_type: targetType,
			allow_flags: allowFlags,
			deny_flags: denyFlags,
		}),
	});

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(errorData.error || "Failed to update overwrite");
	}

	return (await response.json()) as import("$lib/types").GatewayRoomOverwrite;
}

export async function deleteRoomOverwrite(
	spaceId: string,
	roomId: string,
	targetId: string,
): Promise<void> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/spaces/${spaceId}/rooms/${roomId}/overwrites/${targetId}`,
		{
			method: "DELETE",
			headers: { Authorization: userSession.token },
		},
	);

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(errorData.error || "Failed to delete overwrite");
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
