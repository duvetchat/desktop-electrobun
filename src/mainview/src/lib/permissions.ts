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
	KickMembers: 1 << 19, // 524288: removing from the space a member ranked below one's highest role (canModerate)
	BanMembers: 1 << 20, // 1048576: banning users (a member ranked below is removed), listing the bans and lifting them
} as const;

export type PermissionFlag = (typeof Permission)[keyof typeof Permission];

/** Every permission a role can hold, as the role editor lists them: its name, and a line on what it allows. */
export const ALL_PERMISSIONS: ReadonlyArray<{ flag: PermissionFlag; name: string; description: string }> = [
	{
		flag: Permission.Administrator,
		name: "Administrator",
		description: "Gives members every permission, in every room, whatever its overwrites say.",
	},
	{ flag: Permission.ViewChannels, name: "View Channels", description: "Allows members to see rooms and read them." },
	{ flag: Permission.SendMessages, name: "Send Messages", description: "Allows members to send messages in rooms." },
	{
		flag: Permission.ManageMessages,
		name: "Manage Messages",
		description: "Allows members to delete anyone's messages.",
	},
	{
		flag: Permission.ManageChannels,
		name: "Manage Channels",
		description: "Allows members to create, edit, move and delete rooms.",
	},
	{
		flag: Permission.ChangeNickname,
		name: "Change Nickname",
		description: "Allows members to change their nickname in this space.",
	},
	{ flag: Permission.JoinVoice, name: "Join Voice", description: "Allows members to join voice rooms." },
	{ flag: Permission.SpeakInVoice, name: "Speak in Voice", description: "Allows members to speak in voice rooms." },
	{
		flag: Permission.ManageRoles,
		name: "Manage Roles",
		description: "Allows members to edit, give and take the roles below their highest one.",
	},
	{
		flag: Permission.ManageInvites,
		name: "Manage Invites",
		description: "Allows members to see the space's invites and revoke them.",
	},
	{ flag: Permission.CreateInvites, name: "Create Invites", description: "Allows members to create invite links." },
	{
		flag: Permission.ManageSpaceEmojis,
		name: "Manage Emojis",
		description: "Allows members to upload, rename and delete the space's emojis.",
	},
	{
		flag: Permission.ManageSpaceBuckets,
		name: "Manage Buckets",
		description: "Allows members to manage the storage buckets the space's files go to.",
	},
	{
		flag: Permission.ManageSpaceStickers,
		name: "Manage Stickers",
		description: "Allows members to upload, rename and delete the space's stickers.",
	},
	{ flag: Permission.ManageBots, name: "Manage Bots", description: "Allows members to add bots and remove them." },
	{
		flag: Permission.ManageSpaceAttachments,
		name: "Manage Attachments",
		description: "Allows members to manage and delete the space's files.",
	},
	{
		flag: Permission.ManageSpaceWebhooks,
		name: "Manage Webhooks",
		description: "Allows members to create, edit and delete webhooks.",
	},
	{ flag: Permission.PinMessages, name: "Pin Messages", description: "Allows members to pin and unpin messages." },
	{
		flag: Permission.Video,
		name: "Video",
		description: "Allows members to turn on their camera and share their screen in voice rooms.",
	},
	{
		flag: Permission.KickMembers,
		name: "Kick Members",
		description: "Allows members to remove members whose highest role is below theirs. They can join again.",
	},
	{
		flag: Permission.BanMembers,
		name: "Ban Members",
		description:
			"Allows members to ban members whose highest role is below theirs, keeping them out, and to lift bans.",
	},
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
 * Where a member ranks for kicks and bans, as the API ranks them (highestRole in duvet-api's services/moderation.go): the
 * position of the highest role they hold, a higher position ranking higher. @everyone, whose ID is the space's, doesn't
 * count whatever its position, so a member who holds no other role is at -1, below every role. Unlike
 * highestRolePosition (the current member's, for managing roles, where @everyone counts), it takes any member by their
 * user ID.
 */
export function moderationRank(space: GatewaySpace, userId: string): number {
	const held = space.member_roles[userId] ?? [];
	let highest = -1;
	for (const role of space.roles) {
		if (role.id !== space.id && held.includes(role.id) && role.position > highest) {
			highest = role.position;
		}
	}
	return highest;
}

/** Whether a member who ranks at `actor` (moderationRank) may kick or ban one who ranks at `target`: only from strictly
 * above, so two members at one place can't act on each other (outranks, in the API). */
export function outranks(actor: number, target: number): boolean {
	return actor > target;
}

/**
 * Whether the current member may kick (KickMembers) or ban (BanMembers) the member `targetId` (their user ID), as the API
 * lets them: never the space's owner, nor themselves; the owner anyone else; anyone else, an Administrator too, with the
 * permission (Administrator gives it) and only a member who ranks below them (outranks).
 */
export function canModerate(space: GatewaySpace, targetId: string, permission: number): boolean {
	const actor = space.member?.user_id;
	if (!actor || targetId === actor || targetId === space.owner_id) return false;
	if (!hasSpacePermission(space, permission)) return false;
	return actor === space.owner_id || outranks(moderationRank(space, actor), moderationRank(space, targetId));
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
 *   6. Without ViewChannels in the room, no permission at all there
 */
export function computeRoomPermissions(space: GatewaySpace, room: GatewayRoom): number {
	const { member, member_roles, roles, room_overwrites, id: spaceId, owner_id } = space;

	// No member loaded yet — fall back to @everyone role permissions only, and to none without ViewChannels (6)
	if (!member) {
		const everyone = roles.find((r) => r.id === spaceId)?.permissions ?? 0;
		return everyone & Permission.ViewChannels ? everyone : 0;
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

	// 6. A member left without ViewChannels has no other permission in the room either, as the server copies
	// (and the mobile app's canInRoom) have it; the owner and Administrators returned above keep every one.
	return perms & Permission.ViewChannels ? perms : 0;
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
