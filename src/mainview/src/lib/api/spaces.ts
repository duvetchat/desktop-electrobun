import api, { requestLimits, type UploadOptions } from "$lib/api/api";
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

/** The spaces the user is leaving, or has left, from this client: their SPACE_DELETE, which may come before the answer,
 * says nothing of the voice it ends there (#213). That SPACE_DELETE takes the space off, and so does a leave refused. */
export const spacesLeftHere = new Set<string>();

export async function leaveSpace(spaceId: string): Promise<void> {
	spacesLeftHere.add(spaceId);
	try {
		await api.delete(`/api/spaces/${spaceId}/members/@me`);
	} catch (err) {
		spacesLeftHere.delete(spaceId);
		throw err;
	}
}

/** Deletes a space, for everyone in it: only its owner may (403 for anyone else, 404 once it's gone). Every member
 * then gets SPACE_DELETE. */
export async function deleteSpace(spaceId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}`);
}

/** Changes a space; with a new icon or banner, or one removed, as a form, which upload follows. */
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
	upload?: UploadOptions,
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
		const res = await api.patch(`/api/spaces/${spaceId}`, form, upload);
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

// The API deletes a file from its storage before it answers, each call within 30 s, so a deletion of every file takes
// as long as their number (#217).
export async function deleteSpaceAttachment(spaceId: string, attachmentId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/attachments/${attachmentId}`, { answerMs: requestLimits.slowAnswerMs });
}

export async function deleteAllSpaceAttachments(spaceId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/attachments`, { answerMs: Infinity });
}
