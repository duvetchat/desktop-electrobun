import { describe, expect, test } from "bun:test";
import { Permission } from "$lib/permissions";
import { settingsSections, type SettingsSection } from "$lib/space-settings";

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
			"storage",
			"attachments",
		];
		expect(settingsSections(~0 >>> 0)).toEqual(all);
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
