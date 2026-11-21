import { describe, expect, test } from "bun:test";
import { canManageRoleAt, Permission } from "$lib/permissions";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	gatewaySpaceToMembers,
	withCreatedRole,
	type GatewayRole,
	type GatewaySpace,
	type GatewayUser,
} from "$lib/types";

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

// #327: every presence or voice change rebuilt the members, looking each user's member up with find, quadratic in the
// members loaded (and each of their roles in the space's roles), for the app page and each pane.
describe("gatewaySpaceToMembers", () => {
	const user = (n: number): GatewayUser => ({
		id: `user-${n}`,
		username: `user${n}`,
		email_verified: true,
		alias: null,
		avatar: null,
		banner: null,
		custom: "",
		flags: 0,
		badges: 0,
		is_bot: false,
		created_at: "",
		updated_at: "",
	});
	// Arrays whose find throws: the members are built without it.
	const noFind = <T>(items: T[]): T[] =>
		Object.assign(items, {
			find() {
				throw new Error("find");
			},
		});

	test("finds each user's member and roles without a scan per user, and orders their roles highest first", () => {
		const users = [1, 2, 3].map(user);
		const space: GatewaySpace = {
			id: SPACE,
			name: "Space",
			description: null,
			banner: null,
			owner_id: "user-1",
			locale: null,
			member_roles: { "user-2": [SPACE, "mods", "admins"] },
			room_overwrites: [],
			rooms: [],
			members: noFind(
				[1, 2].map((n) => ({
					id: `member-${n}`,
					space_id: SPACE,
					user_id: `user-${n}`,
					alias: null,
					created_at: "",
					updated_at: "",
				})),
			),
			roles: noFind([role(SPACE, 0), role("mods", 1), role("admins", 2)]),
			users,
			created_at: "",
			updated_at: "",
		};
		const members = gatewaySpaceToMembers(space);
		expect(members.map((m) => [m.id, m.member_id, m.is_owner])).toEqual([
			["user-1", "member-1", true],
			["user-2", "member-2", false],
		]);
		expect(members[1]!.roles.map((r) => r.id)).toEqual(["admins", "mods", SPACE]);
	});
});

// The redesign (#357) took the members column away, the one beside every pane that showed the focused pane's Space,
// with the rows, avatars, banners and popovers it mounted for a Space (#327). #409 brings a column back inside each
// pane, beside its chat: the app's page mounts no list of its own, and the one list, under its head and with its pages,
// is the members popover's and the column's both (MembersPanel). The bar's button loads the Space's first page of
// members for its faces itself.
test("a chat's members show inside its pane, and the app's page mounts no list beside the panes", () => {
	const source = (path: string) => readFileSync(join(import.meta.dir, path), "utf8");
	expect(existsSync(join(import.meta.dir, "components/GuildMemberSidebar.svelte"))).toBe(false);
	const page = source("../routes/app/+page.svelte");
	expect(page).not.toMatch(/GuildMemberSidebar|<MemberList\b|<MembersButton\b|<MembersColumn\b|<MembersPanel\b/);
	const panel = source("components/MembersPanel.svelte");
	expect(panel.match(/<MemberList /g)).toHaveLength(1);
	const button = source("components/MembersButton.svelte");
	expect(button).not.toMatch(/<MemberList\b/);
	expect(button).toMatch(/<Popover\.Content[^]*<MembersPanel [^]*<\/Popover\.Content>/);
	expect(button).toContain("void ensureMembers(pagedSpaceId)");
	const column = source("components/MembersColumn.svelte");
	expect(column).not.toMatch(/<MemberList\b/);
	expect(column).toMatch(/<aside\b[^>]*>[^]*<MembersPanel [^]*<\/aside>/);
	// Their users: a room's pane, and a chat's view in it.
	const pane = source("components/PaneView.svelte");
	expect(pane).toMatch(/<MembersButton\s+space=\{activeTabSpace\}/);
	expect(pane).toMatch(/<MembersColumn\s+space=\{activeTabSpace\}/);
	const conversation = source("components/ConversationView.svelte");
	expect(conversation).toMatch(/<MembersButton\b/);
	expect(conversation).toMatch(/<MembersColumn\b/);
});
