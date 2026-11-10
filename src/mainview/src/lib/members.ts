import type { MembersColumnMode } from "$lib/layout-prefs";
import type { MemberOnSidebar, Role } from "$lib/types";

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

/** A group of the members list, under its heading. */
export type MemberGroup<M> = { title: string; members: M[] };

/**
 * The members list's groups, as the mobile app's members sheet has them. In a space: those online (busy too) under
 * their highest hoisted role, the roles by rank, the others online under Online, then everyone offline under Offline.
 * In a conversation, which has no roles: Online, Do not disturb, then Offline. Each group is by name, and an empty one
 * isn't there.
 */
export function memberGroups<M extends Pick<MemberOnSidebar, "username" | "status" | "roles">>(
	members: readonly M[],
	inSpace: boolean,
): MemberGroup<M>[] {
	const online = members.filter(isOnline);
	const groups: MemberGroup<M>[] = [];
	if (inSpace) {
		const byRole = new Map<string, { role: Role; members: M[] }>();
		const rest: M[] = [];
		for (const member of online) {
			const role = member.roles.filter((r) => r.hoisted).sort((a, b) => b.position - a.position)[0];
			if (!role) rest.push(member);
			else if (byRole.has(role.id)) byRole.get(role.id)!.members.push(member);
			else byRole.set(role.id, { role, members: [member] });
		}
		for (const { role, members: held } of [...byRole.values()].sort((a, b) => b.role.position - a.role.position))
			groups.push({ title: role.name, members: held });
		groups.push({ title: "Online", members: rest });
	} else {
		groups.push(
			{ title: "Online", members: online.filter((m) => m.status !== "dnd") },
			{ title: "Do not disturb", members: online.filter((m) => m.status === "dnd") },
		);
	}
	groups.push({ title: "Offline", members: members.filter((m) => !isOnline(m)) });
	return groups
		.filter((g) => g.members.length > 0)
		.map((g) => ({ ...g, members: [...g.members].sort((a, b) => a.username.localeCompare(b.username)) }));
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
