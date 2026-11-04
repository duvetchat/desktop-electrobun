import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");
// The class lists of the elements in a piece of a component.
const classLists = (piece: string) => [...piece.matchAll(/\sclass="([^"]*)"/g)].map((m) => m[1].split(/\s+/));

// Profile banners, a user's and a bot's, are cropped at 5:2 (600×240) and show at 5:2, as a space's do: shown at 10:3,
// they lost 12.5% of what was chosen at the top and at the bottom (#85).
test("profile banners are cropped at 5:2", () => {
	const settings = source("UserSettings.svelte");
	expect(settings.match(/aspect=\{5 \/ 2\}\s+targetWidth=\{600\}\s+targetHeight=\{240\}/g)).toHaveLength(2);
});

test("the profile card shows the banner at 5:2, and a block as tall without one", () => {
	const card = source("MemberProfileCard.svelte");
	const banner = card.slice(card.indexOf("<!-- Banner"), card.indexOf('<div class="relative px-4 pb-4">'));
	// The banner's frames: the editable one, the one that opens it, and the block without one.
	const frames = classLists(banner).filter((list) => list.includes("w-full") && !list.includes("h-full"));
	expect(frames).toHaveLength(3);
	for (const frame of frames) expect(frame).toContain("aspect-[5/2]");
	expect(banner).not.toMatch(/\bh-24\b/);
});

test("the profile popover shows the banner at 5:2", () => {
	const popover = source("MemberProfilePopover.svelte");
	const frame = /<div\s+class="([^"]*)"\s+style=\{member\.banner_url/.exec(popover)?.[1].split(/\s+/);
	expect(frame).toEqual(["aspect-[5/2]", "w-full"]);
});

test("a bot's banner thumbnail in Developer settings is 5:2, as 48 px tall as its avatar's", () => {
	const settings = source("UserSettings.svelte");
	const thumbnail = settings.slice(settings.indexOf("<!-- Banner"), settings.indexOf("{#if hasBotProfileChanges}"));
	const frames = classLists(thumbnail).filter((list) => list.includes("h-12"));
	// The new one, the one to remove, the one there is and the button to set one.
	expect(frames).toHaveLength(4);
	for (const frame of frames) {
		expect(frame).toContain("aspect-[5/2]");
		expect(frame.some((c) => /^w-\d/.test(c))).toBe(false);
	}
});
