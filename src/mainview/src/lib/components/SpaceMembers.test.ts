import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { render } from "svelte/server";
import { tags, type Tag } from "./server-render";
import { Permission } from "$lib/permissions";
import type { GatewayMember, GatewayRole, GatewaySpace, GatewayUser } from "$lib/types";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
void mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules these import use $state, which only Svelte's compiler knows: the value itself here.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { default: SpaceMembers } = await import("./SpaceMembers.svelte");
const { default: SpaceMemberDetails } = await import("./SpaceMemberDetails.svelte");
const { managedMembers, MEMBER_ROW } = await import("$lib/members");

const SPACE = "01920000-0000-7000-8000-00000000a0a0";
// The user, a moderator: they manage roles and kick, from a role below the top one.
const ME = 1;

const role = (id: string, position: number, permissions = 0): GatewayRole => ({
	id,
	space_id: SPACE,
	name: id === SPACE ? "@everyone" : id,
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
const user = (n: number): GatewayUser => ({
	id: `user-${String(n).padStart(4, "0")}`,
	username: `person${String(n).padStart(4, "0")}`,
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
const member = (n: number): GatewayMember => ({
	id: `member-${n}`,
	space_id: SPACE,
	user_id: user(n).id,
	alias: null,
	created_at: "2026-03-05T10:00:00Z",
	updated_at: "",
});

function space(count: number, memberRoles: Record<string, string[]> = {}): GatewaySpace {
	const people = Array.from({ length: count }, (_, i) => i + 1);
	return {
		id: SPACE,
		name: "Harbour",
		description: null,
		banner: null,
		owner_id: "the-owner",
		locale: null,
		member: member(ME),
		member_roles: { [user(ME).id]: [SPACE, "Mods"], ...memberRoles },
		room_overwrites: [],
		rooms: [],
		roles: [
			role(SPACE, 0),
			role("Helpers", 1),
			role("Mods", 2, Permission.ManageRoles | Permission.KickMembers),
			role("Admins", 3, Permission.Administrator),
		],
		users: people.map(user),
		members: people.map(member),
		created_at: "",
		updated_at: "",
	};
}

// What it draws, without the comments Svelte marks its blocks with.
const drawn = (html: string) => html.replace(/<!--[^]*?-->/g, "");

// #380: the Members section of a Space's settings drew every member it had at once, with nothing to find one by, and
// let nobody change anyone's roles.
describe("the Members section", () => {
	test("lists the members in view, between spacers of the others' height, with their roles and the day they joined", async () => {
		const props = { space: space(1000, { [user(2).id]: [SPACE, "Helpers"] }) };
		const html = drawn(render(SpaceMembers, { props }).body);
		const rows = new Set(html.match(/person\d{4}/g) ?? []);
		expect(rows.size).toBeGreaterThan(10);
		expect(rows.size).toBeLessThan(80);
		const spacers = (await tags(SpaceMembers, props)).filter((t) => /^height: \d+px/.test(t.attributes.style ?? ""));
		expect(spacers.map((t) => t.attributes.style)).toEqual([`height: ${(1000 - rows.size) * MEMBER_ROW}px`]);
		expect(html).toContain("@person0002 · Helpers");
		expect(html).toContain(new Date("2026-03-05T10:00:00Z").toLocaleDateString(undefined, { dateStyle: "medium" }));
		// Search, a role filter and a sort, over the members loaded.
		expect(html).toContain('placeholder="Search by name or ID"');
		expect(html).toMatch(/<select[^>]*aria-label="Filter by role"/);
		expect(html).toMatch(/<select[^>]*aria-label="Sort members"/);
	});
});

describe("a member's details", () => {
	const switches = (found: Tag[]) =>
		found
			.filter((t) => t.attributes.role === "switch")
			.map((t) => [t.attributes["aria-label"], t.attributes["aria-checked"], "disabled" in t.attributes]);

	test("give and take the roles below the user's highest, show the others held or not, and offer what may be done", async () => {
		const shown = space(3, { [user(2).id]: [SPACE, "Helpers", "Admins"] });
		const target = managedMembers(shown).find((m) => m.id === user(3).id)!;
		const found = await tags(SpaceMemberDetails, { space: shown, member: target, onBack: () => {} });
		expect(switches(found)).toEqual([
			["Admins", "false", true],
			["Mods", "false", true],
			["Helpers", "false", false],
		]);
		const html = drawn(render(SpaceMemberDetails, { props: { space: shown, member: target, onBack: () => {} } }).body);
		expect(html).toMatch(/>\s*Kick\s*<\/button>/);
		expect(html).not.toMatch(/>\s*Ban\s*<\/button>/);
		expect(html).toContain("Only roles below your highest role can be given or taken.");
		// Someone who outranks the user: a role below the user's own is still theirs to give or take, as the API has it,
		// and there's no kick.
		const above = managedMembers(shown).find((m) => m.id === user(2).id)!;
		const aboveFound = await tags(SpaceMemberDetails, { space: shown, member: above, onBack: () => {} });
		expect(switches(aboveFound)).toEqual([
			["Admins", "true", true],
			["Mods", "false", true],
			["Helpers", "true", false],
		]);
		const aboveHtml = drawn(
			render(SpaceMemberDetails, { props: { space: shown, member: above, onBack: () => {} } }).body,
		);
		expect(aboveHtml).not.toMatch(/>\s*Kick\s*<\/button>/);
	});

	test("the Space's owner gives and takes every role, and kicks and bans", async () => {
		const owned = { ...space(3), owner_id: user(ME).id };
		const target = managedMembers(owned).find((m) => m.id === user(3).id)!;
		const props = { space: owned, member: target, onBack: () => {} };
		expect(switches(await tags(SpaceMemberDetails, props)).map(([, , disabled]) => disabled)).toEqual([
			false,
			false,
			false,
		]);
		const html = drawn(render(SpaceMemberDetails, { props }).body);
		expect(html).toMatch(/>\s*Kick\s*<\/button>/);
		expect(html).toMatch(/>\s*Ban\s*<\/button>/);
		expect(html).not.toContain("Only roles below your highest role");
	});

	test("the gateway's own row for the user, before their page comes, has no member ID to change roles by", async () => {
		const shown = space(1);
		shown.members = [{ ...member(ME), id: user(ME).id }];
		const self = managedMembers(shown)[0]!;
		expect(self.memberId).toBeNull();
		const found = await tags(SpaceMemberDetails, { space: shown, member: self, onBack: () => {} });
		expect(switches(found).every(([, , disabled]) => disabled)).toBe(true);
	});
});
