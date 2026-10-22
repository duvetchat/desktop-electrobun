import api from "$lib/api/api";
import { pathSegment } from "$lib/urls";

export interface InviteInfo {
	code: string;
	space_id: string;
	space_name: string;
	description: string;
	member_count: number;
}

// An invite's code comes from a link anyone can write: it's one segment of the path (pathSegment). One that can't
// be is no invite at all, and reads as the API's answer for any other code it doesn't know.
function codeSegment(code: string): string {
	try {
		return pathSegment(code);
	} catch {
		throw new Error("invite link not found or has expired");
	}
}

export async function getInvite(code: string): Promise<InviteInfo> {
	const response = await api.get(`/api/invites/${codeSegment(code)}`);
	return response.data;
}

export async function joinInvite(code: string): Promise<InviteInfo> {
	const response = await api.post(`/api/invites/${codeSegment(code)}/join`);
	return response.data;
}

export interface InviteLink {
	id: string;
	code: string;
	room_id: string;
	created_by: string;
	created_at: string;
	updated_at: string;
	/** When it stops working; null for one that works until it is revoked. */
	expires_at: string | null;
}

/** The space's invites that still work (needs Manage Invites). */
export async function listSpaceInvites(spaceId: string): Promise<InviteLink[]> {
	const response = await api.get<InviteLink[]>(`/api/spaces/${spaceId}/invites`);
	return response.data;
}

export async function revokeInvite(spaceId: string, inviteId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/invites/${inviteId}`);
}
