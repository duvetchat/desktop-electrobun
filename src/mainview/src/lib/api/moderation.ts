import api from "$lib/api/api";
import type { SpaceBan } from "$lib/types";

/** How many bans a page of a space's list asks for: the API's default (it gives 1 to 100 at a time). */
export const BANS_PAGE_SIZE = 50;

/** Removes a member from the space (Kick Members), by their member ID, as the space's member list gives it: they can join
 * again with an invite. The space's members hear SPACE_MEMBER_REMOVE, and they SPACE_DELETE. */
export async function kickMember(spaceId: string, memberId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/members/${memberId}`);
}

/**
 * Bans a user from the space (Ban Members), with a reason or none (the API trims it, and takes 512 characters at most): a
 * member is removed from it as a kick removes them, and they can't join again until the ban is lifted. The API answers
 * 201 with the new ban, or 200 with the ban that was there already, which stays as it was.
 */
export async function banUser(spaceId: string, userId: string, reason?: string): Promise<SpaceBan> {
	const response = await api.put<SpaceBan>(`/api/spaces/${spaceId}/bans/${userId}`, reason ? { reason } : undefined);
	return response.data;
}

/** Lifts a user's ban from the space (Ban Members): they can join again. */
export async function unbanUser(spaceId: string, userId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/bans/${userId}`);
}

/** A page of the space's bans (Ban Members), in the order of the banned users' IDs: `count` of them, the first ones after
 * the user ID `after` (null: from the first). */
export async function getSpaceBans(spaceId: string, after: string | null, count = BANS_PAGE_SIZE): Promise<SpaceBan[]> {
	const response = await api.get<SpaceBan[]>(`/api/spaces/${spaceId}/bans`, { params: { after, count } });
	return response.data;
}
