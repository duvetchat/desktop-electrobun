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
			"emojis",
			"stickers",
			"storage",
			"attachments",
		];
		expect(settingsSections(~0 >>> 0)).toEqual(all);
	});

	test("each section comes with the permission its controls take, and the members list with any of them", () => {
		expect(settingsSections(Permission.ManageRoles)).toEqual(["roles", "members", "emojis", "stickers"]);
		expect(settingsSections(Permission.ManageInvites)).toEqual(["members", "invites", "emojis", "stickers"]);
		expect(settingsSections(Permission.ManageSpaceEmojis)).toEqual(["members", "emojis", "stickers"]);
		expect(settingsSections(Permission.ManageSpaceBuckets)).toEqual([
			"members",
			"emojis",
			"stickers",
			"storage",
			"attachments",
		]);
		expect(settingsSections(Permission.ManageSpaceAttachments)).toEqual([
			"members",
			"emojis",
			"stickers",
			"attachments",
		]);
	});
});
