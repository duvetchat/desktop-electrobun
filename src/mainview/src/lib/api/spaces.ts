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
	const response = await api.get(`/api/spaces/${spaceId}/members`, {
		params: { count: MEMBERS_PAGE_SIZE, after_id: cursor?.id, after_pos: cursor?.pos },
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

/** Deletes a space, for everyone in it: only its owner may (403 for anyone else, 404 once it's gone). Every member
 * then gets SPACE_DELETE. */
export async function deleteSpace(spaceId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}`);
}

export async function updateSpace(
	spaceId: string,
	data: {
		name?: string;
		description?: string | null;
		locale?: string | null;
		banner?: File | null;
		icon?: File | null;
		remove_banner?: boolean;
		remove_icon?: boolean;
	},
): Promise<any> {
	const hasFiles = data.banner instanceof File || data.icon instanceof File;
	if (hasFiles || data.remove_banner || data.remove_icon) {
		const form = new FormData();
		if (data.name) form.append("name", data.name);
		if (data.description !== undefined && data.description !== null) form.append("description", data.description);
		if (data.locale !== undefined && data.locale !== null) form.append("locale", data.locale);
		if (data.banner instanceof File) form.append("banner", data.banner);
		if (data.icon instanceof File) form.append("icon", data.icon);
		if (data.remove_banner) form.append("remove_banner", "true");
		if (data.remove_icon) form.append("remove_icon", "true");
		const res = await api.patch(`/api/spaces/${spaceId}`, form);
		return res.data;
	}
	const res = await api.patch(`/api/spaces/${spaceId}`, {
		name: data.name,
		description: data.description,
		locale: data.locale,
	});
	return res.data;
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
	url?: string;
}

/** The space's own uploads; with `bucket` (a bucket ID), only those in that bucket. */
export async function getSpaceAttachments(spaceId: string, bucket?: string): Promise<SpaceAttachment[]> {
	const res = await api.get(`/api/spaces/${spaceId}/attachments`, { params: { bucket } });
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
