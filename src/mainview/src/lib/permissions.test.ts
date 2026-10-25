import { describe, expect, test } from "bun:test";
import {
	canManageRoleAt,
	canSetPermission,
	computeSpacePermissions,
	hasSpacePermission,
	highestRolePosition,
	Permission,
	shownRooms,
} from "$lib/permissions";
import type { GatewayRole, GatewayRoom, GatewayRoomOverwrite, GatewaySpace, RoomType } from "$lib/types";

// @everyone's role has the space's ID.
const SPACE = "01920000-0000-7000-8000-0000000005a0";
const OWNER = "01920000-0000-7000-8000-00000000000a";
const ME = "01920000-0000-7000-8000-00000000b0b0";

const role = (id: string, permissions: number, position = 0): GatewayRole => ({
	id,
	space_id: SPACE,
	name: id,
	color_from: null,
	color_via: null,
	color_to: null,
	flags: 0,
	permissions,
	created_at: "",
	updated_at: "",
	hoisted: false,
	position,
});

// The space as this client has it: its roles, and the ones the member (the user, `me`) holds.
const space = (roles: GatewayRole[], held: string[], me: string | null = ME): GatewaySpace => ({
	id: SPACE,
	name: "Space",
	description: null,
	banner: null,
	owner_id: OWNER,
	locale: null,
	member: me ? { id: "member", space_id: SPACE, user_id: me, alias: null, created_at: "", updated_at: "" } : undefined,
	member_roles: me ? { [me]: held } : {},
	room_overwrites: [],
	rooms: [],
	members: [],
	roles,
	users: [],
	created_at: "",
	updated_at: "",
});

describe("hasSpacePermission", () => {
	test("the owner has every permission", () => {
		const owned = space([], [], OWNER);
		expect(hasSpacePermission(owned, Permission.ManageRoles)).toBe(true);
		expect(hasSpacePermission(owned, Permission.Administrator)).toBe(true);
	});

	test("an Administrator has every permission, ManageRoles among them", () => {
		const admin = space([role("admins", Permission.Administrator)], ["admins"]);
		expect(hasSpacePermission(admin, Permission.ManageRoles)).toBe(true);
		expect(hasSpacePermission(admin, Permission.ManageSpaceBuckets)).toBe(true);
	});

	test("a member has what the roles they hold give, @everyone's included", () => {
		const roles = [role(SPACE, Permission.ManageSpaceEmojis), role("mods", Permission.ManageRoles)];
		const mod = space(roles, [SPACE, "mods"]);
		expect(hasSpacePermission(mod, Permission.ManageRoles)).toBe(true);
		expect(hasSpacePermission(mod, Permission.ManageSpaceEmojis)).toBe(true);
		expect(hasSpacePermission(mod, Permission.ManageInvites)).toBe(false);
		expect(hasSpacePermission(mod, Permission.Administrator)).toBe(false);
	});

	test("a role the member doesn't hold gives nothing", () => {
		const member = space([role("mods", Permission.ManageRoles)], []);
		expect(computeSpacePermissions(member)).toBe(0);
		expect(hasSpacePermission(member, Permission.ManageRoles)).toBe(false);
	});

	test("without the member loaded, @everyone's", () => {
		const unloaded = space([role(SPACE, Permission.ManageInvites), role("mods", Permission.ManageRoles)], [], null);
		expect(computeSpacePermissions(unloaded)).toBe(Permission.ManageInvites);
	});
});

describe("canManageRoleAt", () => {
	// @everyone at 0, then the space's roles up to the admins' at 3.
	const roles = [
		role(SPACE, 0, 0),
		role("helpers", 0, 1),
		role("mods", Permission.ManageRoles, 2),
		role("admins", Permission.Administrator, 3),
	];

	test("a member manages only the roles below their highest one", () => {
		const mod = space(roles, [SPACE, "helpers", "mods"]);
		expect(highestRolePosition(mod)).toBe(2);
		expect(canManageRoleAt(mod, 0)).toBe(true);
		expect(canManageRoleAt(mod, 1)).toBe(true);
		expect(canManageRoleAt(mod, 2)).toBe(false);
		expect(canManageRoleAt(mod, 3)).toBe(false);
	});

	test("Administrator doesn't change it", () => {
		const admin = space([...roles, role("owners-friends", 0, 4)], [SPACE, "admins"]);
		expect(canManageRoleAt(admin, 2)).toBe(true);
		expect(canManageRoleAt(admin, 3)).toBe(false);
		expect(canManageRoleAt(admin, 4)).toBe(false);
	});

	test("with @everyone alone a member manages none, and the owner manages every one", () => {
		expect(canManageRoleAt(space(roles, [SPACE]), 0)).toBe(false);
		expect(highestRolePosition(space(roles, []))).toBe(-1);
		expect(canManageRoleAt(space(roles, [SPACE], OWNER), 3)).toBe(true);
	});
});

describe("canSetPermission", () => {
	test("a newly set flag takes having it; one already set can be kept or removed", () => {
		const granted = Permission.SendMessages | Permission.ViewChannels;
		expect(canSetPermission(granted, 0, Permission.SendMessages)).toBe(true);
		expect(canSetPermission(granted, 0, Permission.ManageMessages)).toBe(false);
		expect(canSetPermission(granted, Permission.ManageMessages, Permission.ManageMessages)).toBe(true);
	});
});

describe("shownRooms", () => {
	const room = (id: string, type: RoomType, parent_id: string | null = null): GatewayRoom => ({
		id,
		space_id: SPACE,
		parent_id,
		type,
		name: id,
		description: null,
		position: 0,
		nsfw: false,
		created_at: "",
		updated_at: "",
	});
	// @everyone views every room, and the member holds it, but not a room denied to it.
	const denied = (roomId: string): GatewayRoomOverwrite => ({
		id: `overwrite-${roomId}`,
		room_id: roomId,
		target_id: SPACE,
		target_type: 0,
		deny_flags: Permission.ViewChannels,
		allow_flags: 0,
		created_at: "",
		updated_at: "",
	});
	const shown = (rooms: GatewayRoom[], overwrites: GatewayRoomOverwrite[]) =>
		shownRooms({
			...space([role(SPACE, Permission.ViewChannels)], [SPACE]),
			rooms,
			room_overwrites: overwrites,
		}).map((r) => r.id);

	test("a category the member can't view shows with the rooms in it they can, and only those", () => {
		const rooms = [room("cat", 3), room("open", 1, "cat"), room("closed", 1, "cat"), room("lobby", 1)];
		expect(shown(rooms, [denied("cat"), denied("closed")])).toEqual(["cat", "open", "lobby"]);
	});

	test("a category none of whose rooms the member can view doesn't show, viewable or not", () => {
		const rooms = [room("cat", 3), room("closed", 1, "cat"), room("hid", 3), room("voice", 2, "hid")];
		expect(shown(rooms, [denied("closed"), denied("hid"), denied("voice")])).toEqual([]);
	});

	test("an empty category shows when the member can view it", () => {
		expect(shown([room("empty", 3), room("hidden", 3)], [denied("hidden")])).toEqual(["empty"]);
	});
});
