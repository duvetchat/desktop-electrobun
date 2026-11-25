import { canViewRoom, Permission } from "$lib/permissions";
import type { GatewayRoom, GatewaySpace } from "$lib/types";

/** A section of a space's settings, in the order the settings list them. */
export type SettingsSection =
	| "overview"
	| "roles"
	| "members"
	| "invites"
	| "bans"
	| "emojis"
	| "stickers"
	| "webhooks"
	| "storage"
	| "attachments";

/**
 * The sections of a space's settings that a member opens with these permissions (computeSpacePermissions), each with
 * the permission the API checks for its controls: the overview takes Administrator, the roles ManageRoles, the invites
 * ManageInvites, the bans BanMembers (which lists them), the webhooks ManageSpaceWebhooks, the storage
 * ManageSpaceBuckets, and the attachments that or ManageSpaceAttachments. The members list is for those who manage
 * roles, as the settings show a member only what they work with: it gives and takes a member's roles below the user's
 * highest (canManageRoleAt), and kicks and bans for those who may (canModerate). The emoji and sticker lists are every
 * member's; their controls take ManageSpaceEmojis and ManageSpaceStickers. With none of these permissions, a member
 * sees only the emoji and sticker lists, read-only.
 */
export function settingsSections(permissions: number): SettingsSection[] {
	const has = (flag: number) => (permissions & flag) === flag;
	const sections: SettingsSection[] = [];
	if (has(Permission.Administrator)) sections.push("overview");
	if (has(Permission.ManageRoles)) sections.push("roles", "members");
	if (has(Permission.ManageInvites)) sections.push("invites");
	if (has(Permission.BanMembers)) sections.push("bans");
	sections.push("emojis", "stickers");
	if (has(Permission.ManageSpaceWebhooks)) sections.push("webhooks");
	if (has(Permission.ManageSpaceBuckets)) sections.push("storage");
	if (has(Permission.ManageSpaceBuckets) || has(Permission.ManageSpaceAttachments)) sections.push("attachments");
	return sections;
}

/** How a Space's settings sit in its side panel: its own face, the people in it, and the apps and data behind it, as
 *  the design map arranges S-58. A group with no section the user may open goes. */
const SPACE_SETTING_GROUPS: { title: string; sections: readonly SettingsSection[] }[] = [
	{ title: "Space", sections: ["overview", "roles", "emojis", "stickers"] },
	{ title: "People", sections: ["members", "invites", "bans"] },
	{ title: "Apps and data", sections: ["webhooks", "storage", "attachments"] },
];

export function groupSettingsSections(
	sections: readonly SettingsSection[],
): { title: string; sections: SettingsSection[] }[] {
	return SPACE_SETTING_GROUPS.map((group) => ({
		title: group.title,
		sections: group.sections.filter((section) => sections.includes(section)),
	})).filter((group) => group.sections.length > 0);
}

/**
 * The rooms whose webhooks the settings' Webhooks section lists, and makes new ones in: the space's text rooms the
 * member can view, as the API takes a webhook only in a text room, and Manage Webhooks reaches only the rooms one can
 * view. By position, then ID, as the mobile app lists them.
 */
export function webhookRooms(space: GatewaySpace): GatewayRoom[] {
	return space.rooms
		.filter((r) => r.type === 1 && !r.deleted_at && canViewRoom(space, r))
		.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const SECTIONS: readonly SettingsSection[] = [
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

/** The section a value that crossed the windows names, or undefined for anything else. The settings themselves move
 * off one the user may not see. */
export function spaceSection(raw: unknown): SettingsSection | undefined {
	return SECTIONS.find((section) => section === raw);
}
