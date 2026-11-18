import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");
// The class lists of the elements in a piece of a component.
const classLists = (piece: string) => [...piece.matchAll(/\sclass="([^"]*)"/g)].map((m) => m[1]!.split(/\s+/));

// Profile banners, a user's and a bot's, are cropped at 5:2 (600×240) and show at 5:2, as a space's do: shown at 10:3,
// they lost 12.5% of what was chosen at the top and at the bottom (#85).
test("profile banners are cropped at 5:2", () => {
	const settings = source("UserSettings.svelte");
	expect(settings.match(/aspect=\{5 \/ 2\}\s+targetWidth=\{600\}\s+targetHeight=\{240\}/g)).toHaveLength(2);
});

test("the profile card shows the banner at 5:2, and a block as tall without one", () => {
	const card = source("MemberProfileCard.svelte");
	const banner = card.slice(card.indexOf("<!-- Banner"), card.indexOf('<div class="relative px-4 pb-4">'));
	// The banner's frame, which holds the image, or else is the block of the member's role colour.
	const frames = classLists(banner).filter((list) => list.includes("w-full") && !list.includes("h-full"));
	expect(frames).toHaveLength(1);
	expect(frames[0]).toContain("aspect-[5/2]");
	expect(banner).toContain("style={member.banner_url && !bannerError ? undefined : getBannerStyle(member)}");
	expect(banner).not.toMatch(/\bh-24\b/);
});

// Settings' preview is the card's only use, so the card draws only what it shows: no banner or avatar that opens a
// preview, no plain avatar, and no switch between them (#229).
test("the profile card draws only what Settings' preview shows", () => {
	const card = source("MemberProfileCard.svelte");
	for (const gone of ["editable", "previewSrc", "previewOpen", "ImagePreview", "{:else if member.avatar_url}"])
		expect(card).not.toContain(gone);
	const settings = source("UserSettings.svelte");
	const use = /<MemberProfileCard\s[^]*?\/>/.exec(settings)?.[0] ?? "";
	expect(use).toContain("member={previewMember}");
	expect(use).not.toContain("editable");
	for (const handler of ["onAvatarClick", "onAvatarRemove", "onBannerClick", "onBannerRemove"])
		expect(use).toContain(handler);
});

test("the profile popover shows the banner at 5:2", () => {
	const popover = source("MemberProfilePopover.svelte");
	const frame = /<div\s+class="([^"]*)"\s+style=\{member\.banner_url/.exec(popover)?.[1]?.split(/\s+/);
	expect(frame).toEqual(expect.arrayContaining(["aspect-[5/2]", "w-full"]));
});

// On hover a profile's banner grows a little past the card's outline, as a Space's icon did on hover (#81), unless the
// system asks for less motion. So nothing around it clips it, its top corners are its own, one pixel tighter than the
// card's inside its border, and the box of text below clips what's too long for it, as the card's root did.
describe("a profile's banner on hover", () => {
	const GROWS = ["rounded-t-[15px]", "transition-transform", "duration-150", "motion-safe:hover:scale-105"];
	const textBox = (component: string) =>
		classLists(component).find((list) => list.includes("bg-duvet-sunk") && list.includes("p-3"));

	test("grows on the card, and nothing clips it", () => {
		const card = source("MemberProfileCard.svelte");
		const banner = card.slice(card.indexOf("<!-- Banner"), card.indexOf('<div class="relative px-4 pb-4">'));
		const frames = classLists(banner).filter((list) => list.includes("w-full") && !list.includes("h-full"));
		expect(frames).toHaveLength(1);
		expect(frames[0]).toEqual(expect.arrayContaining(GROWS));
		const root = classLists(card).find((list) => list.includes("w-80"));
		expect(root).toContain("rounded-card");
		expect(root).not.toContain("overflow-hidden");
		expect(textBox(card)).toContain("overflow-hidden");
	});

	test("grows on the popover, and nothing clips it", () => {
		const popover = source("MemberProfilePopover.svelte");
		const frame = /<div\s+class="([^"]*)"\s+style=\{member\.banner_url/.exec(popover)?.[1]?.split(/\s+/);
		expect(frame).toEqual(expect.arrayContaining(GROWS));
		const root = classLists(popover).find((list) => list.includes("w-80"));
		expect(root).toContain("rounded-card");
		expect(root).not.toContain("overflow-hidden");
		expect(textBox(popover)).toContain("overflow-hidden");
	});
});

// The avatar comes after the banner and covers its lower left: of its 92 px, 48 lie on the banner. So while the banner
// is hovered, the avatar's box, with its status dot, fades out over the 150 ms the banner grows in, and comes back as the
// pointer leaves (#227). The box reads the banner's hover from inside the section that follows it (in-peer-hover/banner):
// where the pointer can hover, as for the banner's growth, and with less motion asked too, as a fade moves nothing. It
// keeps the pointer: on the avatar the banner isn't hovered, so the avatar shows, and its click is its own.
describe("a profile's avatar while its banner is hovered", () => {
	const FADES = ["transition-opacity", "duration-150", "in-peer-hover/banner:opacity-0"];
	const fadesAsMeant = (avatar: string[] | undefined) => {
		expect(avatar).toEqual(expect.arrayContaining(FADES));
		expect(avatar).not.toContain("pointer-events-none");
		expect(avatar?.filter((c) => c.includes("opacity-0"))).toEqual(["in-peer-hover/banner:opacity-0"]);
	};

	test("fades on the card, whatever its banner", () => {
		const card = source("MemberProfileCard.svelte");
		const banner = card.slice(card.indexOf("<!-- Banner"), card.indexOf('<div class="relative px-4 pb-4">'));
		const frames = classLists(banner).filter((list) => list.includes("w-full") && !list.includes("h-full"));
		expect(frames).toHaveLength(1);
		expect(frames[0]).toContain("peer/banner");
		// The section right after the banner's frame, and the avatar's box first in it.
		const avatar = /<\/div>\s*<div class="relative px-4 pb-4">\s*(?:<!--[^]*?-->\s*)?<div\s+class="([^"]*)"/.exec(card);
		fadesAsMeant(avatar?.[1]?.split(/\s+/));
		expect(avatar?.[1]).toContain("-top-12");
	});

	test("fades on the popover", () => {
		const popover = source("MemberProfilePopover.svelte");
		const frame = /<div\s+class="([^"]*)"\s+style=\{member\.banner_url/.exec(popover)?.[1]?.split(/\s+/);
		expect(frame).toContain("peer/banner");
		const avatar =
			/style=\{member\.banner_url[^]*?><\/div>\s*<div class="relative px-4 pb-4">\s*(?:<!--[^]*?-->\s*)?<div\s+class="([^"]*)"/.exec(
				popover,
			);
		fadesAsMeant(avatar?.[1]?.split(/\s+/));
		expect(avatar?.[1]).toContain("-top-12");
	});

	// What Tailwind makes of the fade: the box transparent inside an element that follows a hovered banner, only where
	// the pointer can hover, as for the banner's growth (Tailwind's hover:), and whatever motion is asked for.
	test("is a fade on the banner's hover as Tailwind makes it, with or without motion", async () => {
		const { compile } = await import("tailwindcss");
		const css = (await compile("@tailwind utilities;")).build(["in-peer-hover/banner:opacity-0"]);
		expect(css).toMatch(/:where\(\*:is\(:where\(\.peer\\\/banner\):hover ~ \*\)\) &/);
		expect(css).toMatch(/@media \(hover: hover\)/);
		expect(css).toMatch(/opacity: 0%/);
		expect(css).not.toMatch(/prefers-reduced-motion/);
	});
});

// Settings' avatar darkens, and shows Change avatar and Remove avatar, while the pointer is on it: a named group on its
// box, as the banner's overlay uses a group, and no <style> of the card's own (#230).
describe("the profile card's avatar on hover", () => {
	test("darkens and shows its buttons through the avatar's own group", () => {
		const card = source("MemberProfileCard.svelte");
		expect(card).not.toContain("<style");
		const lists = classLists(card);
		const box = lists.filter((list) => list.includes("group/avatar"));
		expect(box).toHaveLength(1);
		expect(box[0]).toEqual(expect.arrayContaining(["relative", "overflow-hidden", "rounded-full"]));
		const overlay = lists.filter((list) => list.includes("group-hover/avatar:bg-black/40"));
		expect(overlay).toHaveLength(1);
		expect(overlay[0]).toEqual(expect.arrayContaining(["absolute", "inset-0", "bg-black/0", "transition-colors"]));
		const buttons = lists.filter((list) => list.includes("group-hover/avatar:opacity-100"));
		expect(buttons).toHaveLength(2);
		for (const button of buttons) expect(button).toEqual(expect.arrayContaining(["opacity-0", "transition-opacity"]));
	});

	// What Tailwind makes of the variant: inside a hovered element of the avatar's group, where the pointer can hover.
	test("is the avatar's hover as Tailwind makes it", async () => {
		const { compile } = await import("tailwindcss");
		const css = (await compile("@tailwind utilities;")).build(["group-hover/avatar:opacity-100"]);
		expect(css).toMatch(/:where\(\.group\\\/avatar\):hover \*/);
		expect(css).toMatch(/@media \(hover: hover\)/);
		expect(css).toMatch(/opacity: 100%/);
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
