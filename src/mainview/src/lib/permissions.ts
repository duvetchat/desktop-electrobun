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
];

// target_type values for RoomOverwrite
const OVERWRITE_ROLE = 0;
const OVERWRITE_MEMBER = 1;

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

	// 3. @everyone overwrite — the everyone role shares the space ID
	const everyoneOw = overwrites.find((o) => o.target_type === OVERWRITE_ROLE && o.target_id === spaceId);
	apply(everyoneOw?.deny_flags ?? 0, everyoneOw?.allow_flags ?? 0);

	// 4. Role-specific overwrites for the member's roles (skip @everyone)
	for (const ow of overwrites) {
		if (ow.target_type === OVERWRITE_ROLE && ow.target_id !== spaceId && myRoles.includes(ow.target_id)) {
			apply(ow.deny_flags, ow.allow_flags);
		}
	}

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

/** Returns true if the current member has ALL of the given permission flags in a room. */
export function hasPermission(space: GatewaySpace, room: GatewayRoom, permission: number): boolean {
	const perms = computeRoomPermissions(space, room);
	return (perms & permission) === permission;
}
