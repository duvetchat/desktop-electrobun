import api from "$lib/api/api";
import type { GatewayRoom, RoomType } from "$lib/types";

export async function createRoom(
	spaceId: string,
	name: string,
	type: RoomType,
	parentId?: string | null,
): Promise<GatewayRoom> {
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

	const response = await api.post(`/api/spaces/${spaceId}/rooms`, payload);
	return response.data;
}

export async function deleteRoom(spaceId: string, roomId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/rooms/${roomId}`);
}

export async function updateRoom(
	spaceId: string,
	roomId: string,
	payload: { name?: string; description?: string | null; parent_id?: string | null; position?: number },
): Promise<GatewayRoom> {
	const response = await api.patch(`/api/spaces/${spaceId}/rooms/${roomId}`, payload);
	return response.data;
}

export async function upsertRoomOverwrite(
	spaceId: string,
	roomId: string,
	targetId: string,
	targetType: number,
	allowFlags: number,
	denyFlags: number,
): Promise<import("$lib/types").GatewayRoomOverwrite> {
	const response = await api.put(`/api/spaces/${spaceId}/rooms/${roomId}/overwrites`, {
		target_id: targetId,
		target_type: targetType,
		allow_flags: allowFlags,
		deny_flags: denyFlags,
	});
	return response.data;
}

export async function deleteRoomOverwrite(spaceId: string, roomId: string, targetId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/rooms/${roomId}/overwrites/${targetId}`);
}

export async function createRoomInvite(spaceId: string, roomId: string): Promise<string> {
	const response = await api.post<{ code: string }>(`/api/spaces/${spaceId}/rooms/${roomId}/invites`);
	const data = response.data;
	return data.code;
}
