import { describe, expect, test } from "bun:test";
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
	expect(frame).toEqual(expect.arrayContaining(["aspect-[5/2]", "w-full"]));
});

// On hover a profile's banner grows a little past the card's outline, as a Space's icon did on hover (#81), unless the
// system asks for less motion. So nothing around it clips it, its top corners are its own, one pixel tighter than the
// card's inside its border, and the box of text below clips what's too long for it, as the card's root did.
describe("a profile's banner on hover", () => {
	const GROWS = ["rounded-t-[11px]", "transition-transform", "duration-150", "motion-safe:hover:scale-105"];
	const textBox = (component: string) =>
		classLists(component).find((list) => list.includes("bg-zinc-950") && list.includes("p-3"));

	test("grows on the card, in each of its states, and nothing clips it", () => {
		const card = source("MemberProfileCard.svelte");
		const banner = card.slice(card.indexOf("<!-- Banner"), card.indexOf('<div class="relative px-4 pb-4">'));
		const frames = classLists(banner).filter((list) => list.includes("w-full") && !list.includes("h-full"));
		expect(frames).toHaveLength(3);
		for (const frame of frames) expect(frame).toEqual(expect.arrayContaining(GROWS));
		const root = classLists(card).find((list) => list.includes("w-80"));
		expect(root).toContain("rounded-xl");
		expect(root).not.toContain("overflow-hidden");
		expect(textBox(card)).toContain("overflow-hidden");
	});

	test("grows on the popover, and nothing clips it", () => {
		const popover = source("MemberProfilePopover.svelte");
		const frame = /<div\s+class="([^"]*)"\s+style=\{member\.banner_url/.exec(popover)?.[1].split(/\s+/);
		expect(frame).toEqual(expect.arrayContaining(GROWS));
		const root = classLists(popover).find((list) => list.includes("w-80"));
		expect(root).toContain("rounded-xl");
		expect(root).not.toContain("overflow-hidden");
		expect(textBox(popover)).toContain("overflow-hidden");
	});
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
