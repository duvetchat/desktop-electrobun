import type { GatewaySpace, GatewayRoom } from "$lib/types";

// Permission flags — mirror the Go constants (1 << iota starting at 0)
export const Permission = {
	Administrator: 1 << 0, // 1
	ViewChannels: 1 << 1, // 2
	SendMessages: 1 << 2, // 4
	ManageMessages: 1 << 3, // 8
	ManageChannels: 1 << 4, // 16
	ChangeNickname: 1 << 5, // 32
	JoinVoice: 1 << 6, // 64
	SpeakInVoice: 1 << 7, // 128
	ManageRoles: 1 << 8, // 256
	ManageInvites: 1 << 9, // 512
	CreateInvites: 1 << 10, // 1024
	ManageSpaceEmojis: 1 << 11, // 2048
	ManageSpaceBuckets: 1 << 12, // 4096
	ManageSpaceStickers: 1 << 13, // 8192
	ManageBots: 1 << 14, // 16384
	ManageSpaceAttachments: 1 << 15, // 32768
	ManageSpaceWebhooks: 1 << 16, // 65536
	PinMessages: 1 << 17, // 131072
	Video: 1 << 18, // 262144: turning on a camera and sharing the screen in voice
} as const;

export type PermissionFlag = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: ReadonlyArray<{ flag: PermissionFlag; name: string }> = [
	{ flag: Permission.Administrator, name: "Administrator" },
	{ flag: Permission.ViewChannels, name: "View Channels" },
	{ flag: Permission.SendMessages, name: "Send Messages" },
	{ flag: Permission.ManageMessages, name: "Manage Messages" },
	{ flag: Permission.ManageChannels, name: "Manage Channels" },
	{ flag: Permission.ChangeNickname, name: "Change Nickname" },
	{ flag: Permission.JoinVoice, name: "Join Voice" },
	{ flag: Permission.SpeakInVoice, name: "Speak in Voice" },
	{ flag: Permission.ManageRoles, name: "Manage Roles" },
	{ flag: Permission.ManageInvites, name: "Manage Invites" },
	{ flag: Permission.CreateInvites, name: "Create Invites" },
	{ flag: Permission.ManageSpaceEmojis, name: "Manage Emojis" },
	{ flag: Permission.ManageSpaceBuckets, name: "Manage Buckets" },
	{ flag: Permission.ManageSpaceStickers, name: "Manage Stickers" },
	{ flag: Permission.ManageBots, name: "Manage Bots" },
	{ flag: Permission.ManageSpaceAttachments, name: "Manage Attachments" },
	{ flag: Permission.ManageSpaceWebhooks, name: "Manage Webhooks" },
	{ flag: Permission.PinMessages, name: "Pin Messages" },
	{ flag: Permission.Video, name: "Video" },
];

// target_type values for RoomOverwrite
const OVERWRITE_ROLE = 0;
const OVERWRITE_MEMBER = 1;

/**
 * The current member's permissions in the space as a whole, as the API computes them for its space-level checks
 * (ComputeSpacePermissions, which checkSpacePermission reads): the owner and Administrators have them all, and anyone
 * else what their roles give, @everyone's included when they hold it. Room overwrites don't count here.
 */
export function computeSpacePermissions(space: GatewaySpace): number {
	const { member, member_roles, roles, id: spaceId, owner_id } = space;

	// No member loaded yet: @everyone's only, as computeRoomPermissions does
	if (!member) {
		return roles.find((r) => r.id === spaceId)?.permissions ?? 0;
	}
	if (member.user_id === owner_id) {
		return ~0 >>> 0;
	}

	let perms = 0;
	const myRoles = member_roles[member.user_id] ?? [];
	for (const role of roles) {
		if (myRoles.includes(role.id)) {
			perms |= role.permissions;
		}
	}
	if (perms & Permission.Administrator) {
		return ~0 >>> 0;
	}
	return perms;
}

/** Returns true if the current member has ALL of the given permission flags in the space as a whole. */
export function hasSpacePermission(space: GatewaySpace, permission: number): boolean {
	return (computeSpacePermissions(space) & permission) === permission;
}

/** The position of the highest role the current member holds (@everyone's is 0), or -1 when they hold none. */
export function highestRolePosition(space: GatewaySpace): number {
	const { member, member_roles, roles } = space;
	if (!member) return -1;
	const myRoles = member_roles[member.user_id] ?? [];
	let highest = -1;
	for (const role of roles) {
		if (myRoles.includes(role.id) && role.position > highest) {
			highest = role.position;
		}
	}
	return highest;
}

/**
 * Whether the current member may manage a role at this position, as the API's checkRoleHierarchy allows: edit or
 * delete it, assign it to a member or take it from one, or move a role there. Only roles below their highest one, or
 * any for the space's owner; unlike the permissions, Administrator doesn't change it. ManageRoles is checked apart.
 */
export function canManageRoleAt(space: GatewaySpace, position: number): boolean {
	if (space.member && space.member.user_id === space.owner_id) {
		return true;
	}
	return position < highestRolePosition(space);
}

/**
 * Whether an edit may set a permission flag on a role, or as an overwrite's allow or deny: the API takes a newly set
 * flag only from someone who has it (`granted`: computeSpacePermissions for a role, computeRoomPermissions for an
 * overwrite), and keeping one already set (`saved`), or removing it, from anyone who may edit it.
 */
export function canSetPermission(granted: number, saved: number, flag: number): boolean {
	return ((granted | saved) & flag) === flag;
}

/**
 * Computes the effective permissions for the current member in a given room,
 * applying the standard overwrite cascade:
 *   1. Base permissions from the member's roles (OR'd together)
 *   2. Administrators bypass everything
 *   3. @everyone role overwrite  (deny → allow)
 *   4. Member's role overwrites  (deny → allow)
 *   5. Member-specific overwrite (deny → allow)
 */
export function computeRoomPermissions(space: GatewaySpace, room: GatewayRoom): number {
	const { member, member_roles, roles, room_overwrites, id: spaceId, owner_id } = space;

	// No member loaded yet — fall back to @everyone role permissions only
	if (!member) {
		const everyoneRole = roles.find((r) => r.id === spaceId);
		return everyoneRole?.permissions ?? 0;
	}
	// 0. Server owner bypasses all permissions
	if (member.user_id === owner_id) {
		return ~0 >>> 0;
	}

	// 1. Base permissions: OR all roles the member belongs to
	let perms = 0;
	const myRoles = member_roles[member.user_id] ?? [];

	for (const role of roles) {
		if (myRoles.includes(role.id)) {
			perms |= role.permissions;
		}
	}

	// 2. Administrators bypass all further checks
	if (perms & Permission.Administrator) {
		return ~0 >>> 0; // all bits set
	}

	// Filter overwrites that belong to this specific room
	const overwrites = room_overwrites.filter((o) => o.room_id === room.id);

	const apply = (deny: number, allow: number) => {
		perms &= ~deny;
		perms |= allow;
	};

	// 3. @everyone overwrite — the everyone role shares the space ID. Same rules as the server copies
	// (duvet-api and duvet-gateway ComputePermissionsForRoom): it only applies if the member holds the
	// role, and duplicate overwrites for it are combined.
	let everyoneAllow = 0;
	let everyoneDeny = 0;
	if (myRoles.includes(spaceId)) {
		for (const ow of overwrites) {
			if (ow.target_type === OVERWRITE_ROLE && ow.target_id === spaceId) {
				everyoneAllow |= ow.allow_flags;
				everyoneDeny |= ow.deny_flags;
			}
		}
	}
	apply(everyoneDeny, everyoneAllow);

	// 4. Role-specific overwrites for the member's roles (skip @everyone)
	// Aggregate all role overwrites first, then apply once (matches Discord model)
	let roleAllow = 0;
	let roleDeny = 0;
	for (const ow of overwrites) {
		if (ow.target_type === OVERWRITE_ROLE && ow.target_id !== spaceId && myRoles.includes(ow.target_id)) {
			roleAllow |= ow.allow_flags;
			roleDeny |= ow.deny_flags;
		}
	}
	apply(roleDeny, roleAllow);

	// 5. Member-specific overwrite
	const memberOw = overwrites.find((o) => o.target_type === OVERWRITE_MEMBER && o.target_id === member.user_id);
	apply(memberOw?.deny_flags ?? 0, memberOw?.allow_flags ?? 0);

	return perms;
}

/** Returns true if the current member can view the given room. */
export function canViewRoom(space: GatewaySpace, room: GatewayRoom): boolean {
	const perms = computeRoomPermissions(space, room);
	return (perms & Permission.ViewChannels) !== 0;
}

/**
 * The rooms of a space its sidebar shows: those the current member can view, and each category holding any of them,
 * whether the member can view the category or not, with only those rooms. A category with no rooms in it shows when
 * the member can view it.
 */
export function shownRooms(space: GatewaySpace): GatewayRoom[] {
	const visible = new Set(space.rooms.filter((r) => r.type !== 3 && canViewRoom(space, r)).map((r) => r.id));
	return space.rooms.filter((room) => {
		if (room.type !== 3) return visible.has(room.id);
		const inside = space.rooms.filter((r) => r.parent_id === room.id);
		return inside.length === 0 ? canViewRoom(space, room) : inside.some((r) => visible.has(r.id));
	});
}

/** The rooms of a space a message can mention (`<#id>`): those the current member can view, categories aside. */
export function mentionableRooms(space: GatewaySpace): GatewayRoom[] {
	return space.rooms.filter((r) => r.type !== 3 && !r.deleted_at && canViewRoom(space, r));
}

/**
 * The name a mention of each room shows, by ID, over all the user's spaces. Only the rooms they can view have one, so
 * a mention of any other room, or of one that's gone, can't give its name away.
 */
export function roomNamesOf(spaces: GatewaySpace[]): Record<string, string> {
	const names: Record<string, string> = {};
	for (const space of spaces) for (const room of mentionableRooms(space)) names[room.id] = room.name;
	return names;
}

/** Returns true if the current member has ALL of the given permission flags in a room. */
export function hasPermission(space: GatewaySpace, room: GatewayRoom, permission: number): boolean {
	const perms = computeRoomPermissions(space, room);
	return (perms & permission) === permission;
}
