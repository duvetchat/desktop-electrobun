import type { MemberOnSidebar, Role } from "$lib/types";

/** The faces the pane's bar shows for a room's members; the rest are a "+N". */
export const MEMBER_FACES = 4;

/** A members list's row and its groups' headings, in px (MemberList's h-10 and h-9). */
export const MEMBER_ROW = 40;
export const GROUP_HEADING = 36;

/**
 * The rows of each group a view of the members list shows, from `top` to `bottom` px of the list, with `overscan` rows
 * more on each side: [start, end) for each group, in the list's order, whose sizes are `sizes` (#327).
 */
export function shownRows(sizes: readonly number[], top: number, bottom: number, overscan = 10): [number, number][] {
	let at = 0;
	return sizes.map((n) => {
		const rows = at + GROUP_HEADING;
		at = rows + n * MEMBER_ROW;
		const start = Math.min(n, Math.max(0, Math.floor((top - rows) / MEMBER_ROW) - overscan));
		const end = Math.min(n, Math.max(0, Math.ceil((bottom - rows) / MEMBER_ROW) + overscan));
		return [start, Math.max(start, end)];
	});
}

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
