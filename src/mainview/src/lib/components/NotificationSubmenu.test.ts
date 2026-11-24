import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../../messages/en.json";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// A Space's, a room's and a chat's menus choose its notification level (lib/notification-levels.ts): every message,
// only mentions or nothing, and for a Space or a room its default, which clears the user's own level.
test("the submenu offers every message, only mentions and nothing, and a default only to Spaces and rooms", () => {
	const menu = source("NotificationSubmenu.svelte");
	for (const key of [
		"shell_notifications",
		"shell_notify_all",
		"shell_notify_mentions",
		"shell_notify_nothing",
		"shell_notify_default",
	]) {
		expect(menu).toContain(`"${key}"`);
	}
	expect(en.shell_notifications).toBe("Notifications");
	expect(en.shell_notify_all).toBe("All messages");
	expect(en.shell_notify_mentions).toBe("Only mentions");
	expect(en.shell_notify_nothing).toBe("Nothing");
	// Each case the whole label, so a language can word it its own way.
	expect(en.shell_notify_default).toBe(
		"{level, select, all {Default (All messages)} mentions {Default (Only mentions)} other {Default (Nothing)}}",
	);
	expect(menu).toContain("{#if withDefault}");
	expect(menu).toContain("const withDefault = $derived(target !== 2)");
	expect(menu).toContain('if (value === "default") await clearNotificationLevel(targetId)');
});

test("a Space's two menus, a text room's and a chat's have it", () => {
	expect(source("SpaceNav.svelte").match(/<NotificationSubmenu\b/g)).toHaveLength(2);
	expect(source("ChannelsSidebar.svelte")).toContain("<NotificationSubmenu");
	expect(source("DMSidebar.svelte")).toContain("<NotificationSubmenu");
});
