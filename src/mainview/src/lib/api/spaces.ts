import api from "$lib/api/api";
import type { GatewayUser, GatewayMember } from "$lib/types";

export const MEMBERS_PAGE_SIZE = 50;

export interface SpaceMemberWithUser extends GatewayMember {
	user: GatewayUser;
	max_pos: number;
}

export async function createSpace(name: string, description?: string): Promise<void> {
	const payload: { name: string; description?: string } = { name };
	if (description) payload.description = description;

	await api.post("/api/spaces", payload);
}

export async function getSpaceMembers(
	spaceId: string,
	cursor?: { id: string; pos: number | null },
	signal?: AbortSignal,
): Promise<SpaceMemberWithUser[]> {
	const params = new URLSearchParams({ count: String(MEMBERS_PAGE_SIZE) });
	if (cursor) {
		params.set("after_id", cursor.id);
		if (cursor.pos != null) params.set("after_pos", String(cursor.pos));
	}

	const response = await api.get(`/api/spaces/${spaceId}/members`, {
		params,
		signal,
	});

	return response.data;
}

export async function getSpaceMember(spaceId: string, memberId: string): Promise<SpaceMemberWithUser> {
	const response = await api.get(`/api/spaces/${spaceId}/members/${memberId}`);
	return response.data;
}

export async function leaveSpace(spaceId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/members/@me`);
}

// ── Space Attachments ───────────────────────────────────────────────────────

export interface SpaceAttachment {
	id: string;
	message_id: string | null;
	filename: string;
	content_type: string;
	size_bytes: number;
	width?: number | null;
	height?: number | null;
	created_at: string;
}

export async function getSpaceAttachments(spaceId: string): Promise<SpaceAttachment[]> {
	const res = await api.get(`/api/spaces/${spaceId}/attachments`);
	return res.data;
}

export async function getSpaceStorageUsed(spaceId: string): Promise<{ total_size: number }> {
	const res = await api.get(`/api/spaces/${spaceId}/attachments/storage`);
	return res.data;
}

export async function deleteSpaceAttachment(spaceId: string, attachmentId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/attachments/${attachmentId}`);
}

export async function deleteAllSpaceAttachments(spaceId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/attachments`);
}
