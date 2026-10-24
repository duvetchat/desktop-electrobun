import { describe, expect, test } from "bun:test";
import { computeSpacePermissions, hasSpacePermission, Permission } from "$lib/permissions";
import type { GatewayRole, GatewaySpace } from "$lib/types";

// @everyone's role has the space's ID.
const SPACE = "01920000-0000-7000-8000-0000000005a0";
const OWNER = "01920000-0000-7000-8000-00000000000a";
const ME = "01920000-0000-7000-8000-00000000b0b0";

const role = (id: string, permissions: number): GatewayRole => ({
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
	position: 0,
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
