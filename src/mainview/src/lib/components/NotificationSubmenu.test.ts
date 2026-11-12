import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// A Space's, a room's and a chat's menus choose its notification level (lib/notification-levels.ts): every message,
// only mentions or nothing, and for a Space or a room its default, which clears the user's own level.
test("the submenu offers every message, only mentions and nothing, and a default only to Spaces and rooms", () => {
	const menu = source("NotificationSubmenu.svelte");
	for (const label of ["Notifications", "All messages", "Only mentions", "Nothing", "Default ("]) {
		expect(menu).toContain(label);
	}
	expect(menu).toContain("{#if withDefault}");
	expect(menu).toContain("const withDefault = $derived(target !== 2)");
	expect(menu).toContain('if (value === "default") await clearNotificationLevel(targetId)');
});

test("a Space's two menus, a text room's and a chat's have it", () => {
	expect(source("SpaceNav.svelte").match(/<NotificationSubmenu\b/g)).toHaveLength(2);
	expect(source("ChannelsSidebar.svelte")).toContain("<NotificationSubmenu");
	expect(source("DMSidebar.svelte")).toContain("<NotificationSubmenu");
});
