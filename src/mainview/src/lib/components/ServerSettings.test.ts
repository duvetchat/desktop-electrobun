import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "settings/SpaceSettingsScreen.svelte"), "utf8");

// The overview sends the Space's default only when its owner changed it: a gateway from before it leaves the field out,
// which reads as only mentions, and saving the name alone mustn't overwrite a stored «every message».
test("the overview sends the default only when it changed", () => {
	expect(source).toMatch(
		/default_notifications:\s*ovDefaultNotifications !== \(space\?\.default_notifications \?\? 1\) \? ovDefaultNotifications : undefined/,
	);
});

// The form takes the Space's values as it opens and for another Space, not with every new object of the Space (each
// presence update makes one), which wiped what the owner was typing or choosing.
test("the overview's form is filled as it opens or as the Space changes, not on every update of the Space", () => {
	expect(source).toContain("const formSpaceId = $derived(open ? (space?.id ?? null) : null);");
	expect(source).toMatch(/\$effect\(\(\) => \{\s*if \(!formSpaceId\) return;\s*untrack\(\(\) => \{/);
});

// #325: a profile's or a Space's pending images are object URLs, which stayed once Settings closed with them unsaved.
test("Settings let go of their pending images' previews as they go", () => {
	const settings = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");
	expect(settings("settings/SettingsScreen.svelte")).toMatch(
		/onDestroy\(\(\) => \{\s*for \(const url of \[pendingAvatarPreview, pendingBannerPreview, botAvatarPreview, botBannerPreview\]\)\s*if \(url\) URL\.revokeObjectURL\(url\);\s*\}\);/,
	);
	expect(settings("settings/SpaceSettingsScreen.svelte")).toMatch(
		/onDestroy\(\(\) => \{\s*for \(const url of \[pendingIconPreview, pendingBannerPreview\]\) if \(url\) URL\.revokeObjectURL\(url\);\s*\}\);/,
	);
});
