import { describe, expect, test } from "bun:test";
import { canManageRoleAt, Permission } from "$lib/permissions";
import { withCreatedRole, type GatewayRole, type GatewaySpace } from "$lib/types";

// @everyone's role has the space's ID, at position 0.
const SPACE = "01920000-0000-7000-8000-0000000005a0";
const ME = "01920000-0000-7000-8000-00000000b0b0";

const role = (id: string, position: number, permissions = 0): GatewayRole => ({
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

describe("withCreatedRole", () => {
	test("the new role goes at 1, above @everyone, and every other role moves up one, as the API moves them", () => {
		const roles = [role(SPACE, 0), role("mods", 1), role("admins", 2)];
		expect(withCreatedRole(roles, role("vip", 1))).toEqual([
			role(SPACE, 0),
			role("mods", 2),
			role("admins", 3),
			role("vip", 1),
		]);
	});

	test("the lowest role that manages roles can manage the one it creates", () => {
		const roles = withCreatedRole([role(SPACE, 0), role("mods", 1, Permission.ManageRoles)], role("vip", 1));
		const space: GatewaySpace = {
			id: SPACE,
			name: "Space",
			description: null,
			banner: null,
			owner_id: "01920000-0000-7000-8000-00000000000a",
			locale: null,
			member: { id: "member", space_id: SPACE, user_id: ME, alias: null, created_at: "", updated_at: "" },
			member_roles: { [ME]: [SPACE, "mods"] },
			room_overwrites: [],
			rooms: [],
			members: [],
			roles,
			users: [],
			created_at: "",
			updated_at: "",
		};
		expect(canManageRoleAt(space, 1)).toBe(true);
	});
});
