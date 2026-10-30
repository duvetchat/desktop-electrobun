import type { MembersColumnMode } from "$lib/layout-prefs";
import type { MemberOnSidebar } from "$lib/types";

/** In auto, the members column opens by itself once more than this many of the room's members are online: below it,
 * the faces in the pane's bar and their popover list them without taking a column from the chat. */
export const BUSY_ROOM_ONLINE = 8;

/** The faces the pane's bar shows for a room's members; the rest are a "+N". */
export const MEMBER_FACES = 4;

/** Online, idle and do not disturb are all there: only offline isn't. */
export function isOnline(member: Pick<MemberOnSidebar, "status">): boolean {
	return member.status !== "offline";
}

export function onlineCount(members: readonly Pick<MemberOnSidebar, "status">[]): number {
	return members.filter(isOnline).length;
}

/** Whether the members column is open: the user's choice when they made one, else whether the room is busy. */
export function membersColumnOpen(mode: MembersColumnMode, online: number): boolean {
	if (mode === "auto") return online > BUSY_ROOM_ONLINE;
	return mode === "shown";
}

/** The faces to show, the online members first and otherwise in the list's order, and how many more there are. */
export function memberFaces<M extends Pick<MemberOnSidebar, "status">>(
	members: readonly M[],
	max = MEMBER_FACES,
): { faces: M[]; more: number } {
	const faces = [...members.filter(isOnline), ...members.filter((m) => !isOnline(m))].slice(0, max);
	return { faces, more: members.length - faces.length };
}

/** The members button's name for a screen reader, which can't count the faces. */
export function membersLabel(online: number): string {
	return `Members, ${online} online`;
}
