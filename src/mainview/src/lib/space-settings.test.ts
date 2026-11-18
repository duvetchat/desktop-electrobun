import { describe, expect, test } from "bun:test";
import { Permission } from "$lib/permissions";
import { settingsSections, webhookRooms, type SettingsSection } from "$lib/space-settings";
import type { GatewayRoom, GatewaySpace, RoomType } from "$lib/types";

describe("settingsSections", () => {
	test("a member without the settings' permissions sees only the emoji and sticker lists", () => {
		expect(settingsSections(0)).toEqual(["emojis", "stickers"]);
		expect(settingsSections(Permission.SendMessages | Permission.ManageChannels)).toEqual(["emojis", "stickers"]);
	});

	test("the owner and Administrators, who have every permission (computeSpacePermissions), see every section", () => {
		const all: SettingsSection[] = [
			"overview",
			"roles",
			"members",
			"invites",
			"bans",
			"emojis",
			"stickers",
			"webhooks",
			"storage",
			"attachments",
		];
		expect(settingsSections(~0 >>> 0)).toEqual(all);
	});

	test("the webhooks come with ManageSpaceWebhooks, which every webhook route takes", () => {
		expect(settingsSections(Permission.ManageSpaceWebhooks)).toEqual(["emojis", "stickers", "webhooks"]);
		expect(settingsSections(Permission.ManageSpaceWebhooks | Permission.ManageSpaceBuckets)).toEqual([
			"emojis",
			"stickers",
			"webhooks",
			"storage",
			"attachments",
		]);
		// Managing a room isn't managing its webhooks.
		expect(settingsSections(Permission.ManageChannels)).not.toContain("webhooks");
	});

	test("each section comes with the permission its controls take", () => {
		expect(settingsSections(Permission.ManageInvites)).toEqual(["invites", "emojis", "stickers"]);
		expect(settingsSections(Permission.ManageSpaceEmojis)).toEqual(["emojis", "stickers"]);
		expect(settingsSections(Permission.ManageSpaceStickers)).toEqual(["emojis", "stickers"]);
		expect(settingsSections(Permission.ManageSpaceBuckets)).toEqual(["emojis", "stickers", "storage", "attachments"]);
		expect(settingsSections(Permission.ManageSpaceAttachments)).toEqual(["emojis", "stickers", "attachments"]);
	});

	test("the bans come with BanMembers, which lists them, and not with KickMembers alone", () => {
		expect(settingsSections(Permission.BanMembers)).toEqual(["bans", "emojis", "stickers"]);
		expect(settingsSections(Permission.KickMembers)).toEqual(["emojis", "stickers"]);
		expect(settingsSections(Permission.ManageInvites | Permission.BanMembers)).toEqual([
			"invites",
			"bans",
			"emojis",
			"stickers",
		]);
	});

	test("the members list comes with ManageRoles alone, as the roles do", () => {
		expect(settingsSections(Permission.ManageRoles)).toEqual(["roles", "members", "emojis", "stickers"]);
		expect(settingsSections(Permission.ManageInvites | Permission.ManageSpaceBuckets)).not.toContain("members");
	});
});

describe("webhookRooms", () => {
	// @everyone's role has the space's ID; the member holds it and a role that manages webhooks.
	const SPACE = "01920000-0000-7000-8000-0000000005a0";
	const ME = "01920000-0000-7000-8000-00000000b0b0";
	const HOOKS = "01920000-0000-7000-8000-0000000000c0";
	const room = (id: string, type: RoomType, position: number, parent_id: string | null = null): GatewayRoom => ({
		id,
		space_id: SPACE,
		parent_id,
		type,
		name: id,
		description: null,
		position,
		nsfw: false,
		created_at: "",
		updated_at: "",
	});
	const role = (id: string, permissions: number) => ({
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
	const space = (rooms: GatewayRoom[], hidden: string[] = []): GatewaySpace => ({
		id: SPACE,
		name: "Space",
		description: null,
		banner: null,
		owner_id: "01920000-0000-7000-8000-00000000000a",
		locale: null,
		member: { id: "member", space_id: SPACE, user_id: ME, alias: null, created_at: "", updated_at: "" },
		member_roles: { [ME]: [SPACE, HOOKS] },
		// ViewChannels taken from @everyone in the hidden rooms.
		room_overwrites: hidden.map((room_id) => ({
			id: `ow-${room_id}`,
			room_id,
			target_id: SPACE,
			target_type: 0,
			allow_flags: 0,
			deny_flags: Permission.ViewChannels,
			created_at: "",
			updated_at: "",
		})),
		rooms,
		members: [],
		roles: [role(SPACE, Permission.ViewChannels), role(HOOKS, Permission.ManageSpaceWebhooks)],
		users: [],
		created_at: "",
		updated_at: "",
	});
	const ids = (rooms: GatewayRoom[]) => rooms.map((r) => r.id);

	test("the text rooms only: the API makes webhooks in no voice room or category", () => {
		const rooms = [room("lobby", 2, 0), room("general", 1, 1), room("info", 3, 2), room("news", 1, 0, "info")];
		expect(ids(webhookRooms(space(rooms)))).toEqual(["news", "general"]);
	});

	test("only the rooms the member can view, as Manage Webhooks reaches no others", () => {
		const rooms = [room("general", 1, 0), room("staff", 1, 1), room("logs", 1, 2)];
		expect(ids(webhookRooms(space(rooms, ["staff"])))).toEqual(["general", "logs"]);
	});

	test("by position, then ID, whatever order the space has them in", () => {
		const rooms = [room("c", 1, 2), room("b", 1, 0), room("a", 1, 0)];
		expect(ids(webhookRooms(space(rooms)))).toEqual(["a", "b", "c"]);
	});
});

test("a section named across the windows is one of the Space's, or none", async () => {
	const { spaceSection } = await import("$lib/space-settings");
	expect(spaceSection("roles")).toBe("roles");
	expect(spaceSection("attachments")).toBe("attachments");
	expect(spaceSection("rooms")).toBeUndefined();
	expect(spaceSection(null)).toBeUndefined();
	expect(spaceSection(3)).toBeUndefined();
});
