import { describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { render } from "svelte/server";
import { tags } from "./server-render";
import type { GatewayRole, GatewaySpace, GatewayUser, MemberOnSidebar } from "$lib/types";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
void mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules the list imports use $state, which only Svelte's compiler knows: the value itself here.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { default: MemberList, spaceMembers } = await import("./MemberList.svelte");

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// #205 took the user's own typing off their row of the members column, where Chat kept it with the others' notices,
// and with it from everywhere. Their own row now shows it again from a store of its own (ownTyping), the one place it
// shows. What a browser checked against a running app, kept here.
test("the members column shows the others' typing as the rows and tabs do, and the user's own on their own row", () => {
	const list = source("MemberList.svelte");
	expect(list).toContain("const typers = $derived(channelId ? ($typingNow[channelId] ?? []) : []);");
	expect(list).toContain("const ownRecording = $derived(channelId ? $ownTyping[channelId] : undefined);");
	expect(list).toMatch(
		/function isTyping\(userId: string\): boolean \{\s*if \(userId === \$currentUser\?\.id\) return ownRecording !== undefined;\s*return typers\.some\(\(u\) => u\.user_id === userId\);/,
	);
	expect(list).not.toContain("$typingUsers");
	// Chat notes the user's own typing apart from the others' notices, which the rows, the tabs and its line read.
	const chat = source("Chat.svelte");
	expect(chat).toContain("noteOwnTyping(channelId, recording);");
	expect(chat).not.toContain("typingUsers.update");
});

// Every file under a folder, its subfolders' too.
function filesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
	);
}

test("nothing but the members column reads the user's own typing", () => {
	const src = join(import.meta.dir, "..", "..");
	const readers = filesUnder(src)
		.filter((file) => /\.(svelte|ts)$/.test(file) && !file.endsWith(".test.ts"))
		.filter((file) => readFileSync(file, "utf8").includes("ownTyping"))
		.map((file) => relative(src, file).split(sep).join("/"))
		.sort();
	expect(readers).toEqual(["lib/components/MemberList.svelte", "lib/stores.svelte.ts"]);
});

// #327: the members list mounted every row loaded, a whole Space's once scrolled through, each with its avatar, banner
// and popover. It mounts the rows in view, with spacers that keep the list's height, so its scroll and its pages below
// stay as they were.
describe("a long members list", () => {
	const person = (n: number): MemberOnSidebar => ({
		id: `user-${String(n).padStart(4, "0")}`,
		member_id: `member-${n}`,
		username: `user${String(n).padStart(4, "0")}`,
		raw_username: `user${n}`,
		avatar_url: null,
		banner_url: null,
		status: "online",
		mobile_only: false,
		badges: 0,
		is_bot: false,
		is_owner: false,
		bio: "",
		roles: [],
	});

	test("mounts the rows in view, and keeps the list's height with spacers", async () => {
		const members = Array.from({ length: 500 }, (_, i) => person(i));
		const props = { members, spaceId: "space" };
		const html = render(MemberList, { props }).body;
		const rows = new Set(html.match(/user0\d{3}/g) ?? []);
		expect(rows.size).toBeGreaterThan(10);
		expect(rows.size).toBeLessThan(80);
		expect(html).toContain("Online — 500");
		// The rows below the view are a spacer of their height.
		const spacers = (await tags(MemberList, props)).filter((t) => /^height: \d+px/.test(t.attributes.style ?? ""));
		expect(spacers.map((t) => t.attributes.style)).toEqual([`height: ${(500 - rows.size) * 40}px`]);
	});

	test("follows its scroller, the element around it that scrolls, and lets go of it", () => {
		const list = source("MemberList.svelte");
		expect(list).toContain('scroller.addEventListener("scroll", measure, { passive: true });');
		expect(list).toContain('scroller.removeEventListener("scroll", measure);');
		expect(list).toContain("new ResizeObserver(measure)");
	});
});

// #327: spaceMembers, which the members column and the faces in a pane's bar read, looked each member's user and each
// of their roles up with find: quadratic in the members loaded, at every presence.
test("a Space's members are built without a scan per member", () => {
	const noFind = <T>(items: T[]): T[] =>
		Object.assign(items, {
			find() {
				throw new Error("find");
			},
		});
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
	const role = (id: string, position: number): GatewayRole => ({
		id,
		space_id: "space",
		name: id,
		color_from: null,
		color_via: null,
		color_to: null,
		flags: 0,
		permissions: 0,
		created_at: "",
		updated_at: "",
		hoisted: false,
		position,
	});
	const space: GatewaySpace = {
		id: "space",
		name: "Space",
		description: null,
		banner: null,
		owner_id: "user-1",
		locale: null,
		member_roles: { "user-2": ["space", "mods", "admins"] },
		room_overwrites: [],
		rooms: [],
		members: [1, 2, 3].map((n) => ({
			id: `member-${n}`,
			space_id: "space",
			user_id: `user-${n}`,
			alias: null,
			created_at: "",
			updated_at: "",
		})),
		roles: noFind([role("space", 0), role("mods", 1), role("admins", 2)]),
		users: noFind([1, 2].map(user)),
		created_at: "",
		updated_at: "",
	};
	const members = spaceMembers(space);
	// A member whose user isn't loaded is left out, as before.
	expect(members.map((m) => [m.id, m.member_id, m.is_owner])).toEqual([
		["user-1", "member-1", true],
		["user-2", "member-2", false],
	]);
	expect(members[1]!.roles.map((r) => r.id)).toEqual(["admins", "mods", "space"]);
});
