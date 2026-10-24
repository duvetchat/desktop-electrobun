import { Permission } from "$lib/permissions";

/** A section of a space's settings, in the order the settings list them. */
export type SettingsSection =
	| "overview"
	| "roles"
	| "members"
	| "invites"
	| "emojis"
	| "stickers"
	| "storage"
	| "attachments";

/**
 * The sections of a space's settings that a member opens with these permissions (computeSpacePermissions), each with
 * the permission the API checks for its controls: the overview takes Administrator, the roles and the members (whose
 * roles are assigned with it) ManageRoles, the invites ManageInvites, the storage ManageSpaceBuckets, and the
 * attachments that or ManageSpaceAttachments. The emoji and sticker lists are every member's; their controls take
 * ManageSpaceEmojis and ManageSpaceStickers. With none of these permissions, a member sees only the emoji and sticker
 * lists, read-only.
 */
export function settingsSections(permissions: number): SettingsSection[] {
	const has = (flag: number) => (permissions & flag) === flag;
	const sections: SettingsSection[] = [];
	if (has(Permission.Administrator)) sections.push("overview");
	if (has(Permission.ManageRoles)) sections.push("roles", "members");
	if (has(Permission.ManageInvites)) sections.push("invites");
	sections.push("emojis", "stickers");
	if (has(Permission.ManageSpaceBuckets)) sections.push("storage");
	if (has(Permission.ManageSpaceBuckets) || has(Permission.ManageSpaceAttachments)) sections.push("attachments");
	return sections;
}
