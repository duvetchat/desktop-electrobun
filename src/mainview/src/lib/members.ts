import type { GatewayRole, GatewaySpace, MemberOnSidebar, Role } from "$lib/types";

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

/** A members popover, and whether the pin of its kind of chat opened it (#366). */
export interface PopoverPin {
	open: boolean;
	byPin: boolean;
}

/**
 * What a members popover does as the pin of its kind of chat (`kept`) and its chat's place on screen (`shown`)
 * change: the pin opens it while the chat shows, and closes what it opened once the chat hides (the Friends view hides
 * the panes) or the pin goes. One the user opened or closed stays as they left it.
 */
export function followPin(now: PopoverPin, kept: boolean, shown: boolean): PopoverPin {
	if (kept && shown) return { open: true, byPin: true };
	if (now.byPin) return { open: false, byPin: false };
	return now;
}

/** How many of a Space's users the Members section of its settings loads at most, a page after another, as the mobile
 *  app's Members page does: the API finds no one by name, so the section searches what it has (#380). */
export const LISTED_MEMBERS_MAX = 5000;

/** A member as the Members section of a Space's settings lists them (#380). */
export interface ManagedMember {
	/** Their user's ID. */
	id: string;
	/** Their member ID, which a role given or taken and a kick go by. Null for the row the gateway makes for the user
	 *  themselves, whose ID is the user's, until a page of the Space's members brings theirs. */
	memberId: string | null;
	/** Their name as the Space shows it. */
	name: string;
	username: string;
	/** Their avatar, as their user has it. */
	avatar: string | null;
	isBot: boolean;
	isOwner: boolean;
	/** The roles they hold, @everyone aside, the highest first. */
	roles: GatewayRole[];
	/** When they joined the Space, or null where that isn't known (the gateway's own row for the user). */
	joinedAt: string | null;
}

/** A Space's members as its settings list them: those whose user the app holds, as the members list has them. */
export function managedMembers(space: GatewaySpace): ManagedMember[] {
	const users = new Map(space.users.map((u) => [u.id, u]));
	const roles = new Map(space.roles.map((r) => [r.id, r]));
	const managed: ManagedMember[] = [];
	for (const member of space.members) {
		const user = users.get(member.user_id);
		if (!user) continue;
		// The gateway's row for the user: a page of the Space's members replaces it with theirs (withMemberPage).
		const loaded = member.id !== member.user_id;
		managed.push({
			id: user.id,
			memberId: loaded ? member.id : null,
			name: member.alias ?? user.alias ?? user.username,
			username: user.username,
			avatar: user.avatar,
			isBot: user.is_bot ?? false,
			isOwner: user.id === space.owner_id,
			roles: (space.member_roles[user.id] ?? [])
				.map((id) => roles.get(id))
				.filter((role): role is GatewayRole => !!role && role.id !== space.id)
				.sort((a, b) => b.position - a.position),
			joinedAt: loaded && member.created_at ? member.created_at : null,
		});
	}
	return managed;
}

/** The role filter's choice of the members who hold no role but @everyone. */
export const NO_ROLE = "none";

/** How the Members section sorts: by name, or by when they joined, the newest or the oldest first. */
export type MemberSort = "name" | "newest" | "oldest";

// One collator for every comparison: a localeCompare with options makes one of its own each time, and Chromium took
// 300 to 400 ms to sort 5,000 members that way, again with each page, presence, role event and key.
const nameOrder = new Intl.Collator(undefined, { sensitivity: "base" });

const byName = (a: ManagedMember, b: ManagedMember) =>
	nameOrder.compare(a.name, b.name) ||
	nameOrder.compare(a.username, b.username) ||
	(a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// When they joined, in ms; NaN where it isn't known.
const joinedMs = (m: ManagedMember) => (m.joinedAt ? Date.parse(m.joinedAt) : NaN);

// How much of a user ID a search must hold to find them by it: a short word of the letters a to f, as a name can be,
// is in a good share of any Space's IDs.
const ID_SEARCH_MIN = 8;

/**
 * The members the Members section shows: those whose name, alias or username has what's searched (any case, an @ before
 * it aside), or whose user ID is it or, from ID_SEARCH_MIN characters, has it; holding the role picked (NO_ROLE:
 * holding none but @everyone); by name or by when they joined, those whose date isn't known last.
 */
export function findMembers(
	members: readonly ManagedMember[],
	{ query = "", role = "", sort = "name" }: { query?: string; role?: string; sort?: MemberSort },
): ManagedMember[] {
	const wanted = query.trim().replace(/^@/, "").toLocaleLowerCase();
	const byId = (id: string) => id === wanted || (wanted.length >= ID_SEARCH_MIN && id.includes(wanted));
	const found = members.filter(
		(m) =>
			(!wanted ||
				m.name.toLocaleLowerCase().includes(wanted) ||
				m.username.toLocaleLowerCase().includes(wanted) ||
				byId(m.id.toLocaleLowerCase())) &&
			(!role || (role === NO_ROLE ? m.roles.length === 0 : m.roles.some((r) => r.id === role))),
	);
	if (sort === "name") return found.sort(byName);
	const newest = sort === "newest";
	return found.sort((a, b) => {
		const [x, y] = [joinedMs(a), joinedMs(b)];
		if (Number.isNaN(x) || Number.isNaN(y)) return Number(Number.isNaN(x)) - Number(Number.isNaN(y)) || byName(a, b);
		return (newest ? y - x : x - y) || byName(a, b);
	});
}

/** The day a member joined, as the locale writes a date; null where it isn't known. */
export function joinedOn(joinedAt: string | null): string | null {
	const at = joinedAt ? new Date(joinedAt) : null;
	return at && !Number.isNaN(at.getTime()) ? at.toLocaleDateString(undefined, { dateStyle: "medium" }) : null;
}
