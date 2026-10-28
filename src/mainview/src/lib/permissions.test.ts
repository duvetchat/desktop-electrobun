import { describe, expect, test } from "bun:test";
import {
	canManageRoleAt,
	canSetPermission,
	computeRoomPermissions,
	computeSpacePermissions,
	hasPermission,
	hasSpacePermission,
	highestRolePosition,
	mentionableRooms,
	Permission,
	roomNamesOf,
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

describe("shownRooms", () => {
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

describe("room mentions", () => {
	const viewing = (rooms: GatewayRoom[], overwrites: GatewayRoomOverwrite[]): GatewaySpace => ({
		...space([role(SPACE, Permission.ViewChannels)], [SPACE]),
		rooms,
		room_overwrites: overwrites,
	});

	test("a space's mentionable rooms are those the member can view, categories aside", () => {
		const rooms = [
			room("cat", 3),
			room("open", 1, "cat"),
			room("closed", 1, "cat"),
			room("voice", 2),
			{ ...room("gone", 1), deleted_at: "2026-10-26T00:00:00Z" },
		];
		expect(mentionableRooms(viewing(rooms, [denied("closed")])).map((r) => r.id)).toEqual(["open", "voice"]);
	});

	test("their names come from every space, and only theirs", () => {
		const OTHER = "01920000-0000-7000-8000-0000000005b0";
		const other: GatewaySpace = {
			...space([role(OTHER, Permission.ViewChannels)], [OTHER]),
			id: OTHER,
			rooms: [{ ...room("elsewhere", 1), space_id: OTHER, name: "Elsewhere" }],
		};
		const names = roomNamesOf([
			viewing([room("open", 1), room("closed", 1), room("cat", 3)], [denied("closed")]),
			other,
		]);
		expect(names).toEqual({ open: "open", elsewhere: "Elsewhere" });
	});

	test("a member none of whose roles views a room names none of them", () => {
		const blind = { ...space([role(SPACE, 0)], [SPACE]), rooms: [room("open", 1)] };
		expect(roomNamesOf([blind])).toEqual({});
	});
});

describe("computeRoomPermissions", () => {
	const EVERYONE = Permission.ViewChannels | Permission.SendMessages;
	const MANAGING = Permission.ManageChannels | Permission.ManageMessages | Permission.PinMessages;
	const ALL = ~0 >>> 0;
	const staff = room("staff", 1);
	// An overwrite in "staff" for a role (target_type 0) or a member (1).
	const overwrite = (
		target_id: string,
		target_type: number,
		allow_flags: number,
		deny_flags: number,
	): GatewayRoomOverwrite => ({
		id: `overwrite-${target_id}`,
		room_id: staff.id,
		target_id,
		target_type,
		allow_flags,
		deny_flags,
		created_at: "",
		updated_at: "",
	});
	// The space as `me` has it, holding @everyone and the managers' role unless told otherwise.
	const spaceWith = (
		overwrites: GatewayRoomOverwrite[],
		me: string | null = ME,
		held = [SPACE, "managers"],
	): GatewaySpace => ({
		...space([role(SPACE, EVERYONE), role("managers", MANAGING), role("admins", Permission.Administrator)], held, me),
		rooms: [staff],
		room_overwrites: overwrites,
	});
	const permsIn = (overwrites: GatewayRoomOverwrite[], me: string | null = ME, held = [SPACE, "managers"]) =>
		computeRoomPermissions(spaceWith(overwrites, me, held), staff);
	const everyoneDeniedView = overwrite(SPACE, 0, 0, Permission.ViewChannels);

	test("a member who can view the room has what the cascade gives them there", () => {
		expect(permsIn([])).toBe(EVERYONE | MANAGING);
		expect(permsIn([overwrite(SPACE, 0, 0, Permission.SendMessages)])).toBe(Permission.ViewChannels | MANAGING);
	});

	test("without ViewChannels in the room, whichever overwrite took it, they have no other permission there", () => {
		expect(permsIn([everyoneDeniedView])).toBe(0);
		expect(permsIn([overwrite("managers", 0, 0, Permission.ViewChannels)])).toBe(0);
		expect(permsIn([overwrite(ME, 1, 0, Permission.ViewChannels)])).toBe(0);
		expect(hasPermission(spaceWith([everyoneDeniedView]), staff, Permission.ManageChannels)).toBe(false);
		expect(hasPermission(spaceWith([everyoneDeniedView]), staff, Permission.SendMessages)).toBe(false);
	});

	test("ViewChannels given back by their role's or their own overwrite brings the rest back", () => {
		expect(permsIn([everyoneDeniedView, overwrite("managers", 0, Permission.ViewChannels, 0)])).toBe(
			EVERYONE | MANAGING,
		);
		expect(permsIn([everyoneDeniedView, overwrite(ME, 1, Permission.ViewChannels, 0)])).toBe(EVERYONE | MANAGING);
	});

	test("the space's owner and Administrators keep every permission, denied ViewChannels or not", () => {
		expect(permsIn([everyoneDeniedView, overwrite(OWNER, 1, 0, Permission.ViewChannels)], OWNER, [SPACE])).toBe(ALL);
		expect(permsIn([everyoneDeniedView, overwrite(ME, 1, 0, Permission.ViewChannels)], ME, [SPACE, "admins"])).toBe(
			ALL,
		);
	});

	test("without the member loaded, @everyone's, which give nothing without ViewChannels", () => {
		expect(permsIn([], null)).toBe(EVERYONE);
		const blind = { ...spaceWith([], null), roles: [role(SPACE, Permission.SendMessages)] };
		expect(computeRoomPermissions(blind, staff)).toBe(0);
	});
});
