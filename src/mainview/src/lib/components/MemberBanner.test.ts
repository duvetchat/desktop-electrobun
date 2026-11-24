import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tags } from "./server-render";

const { default: MemberBanner } = await import("./MemberBanner.svelte");

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");
const BANNER = "https://api.test/attachments/0190a3b2-0000-7000-8000-0000000000ba";

describe("a member's banner", () => {
	test("draws faintly behind the row, covering it, from the row's middle to its right edge", async () => {
		const [image, ...others] = await tags(MemberBanner, { src: BANNER });
		expect(others).toEqual([]);
		expect(image!.name).toBe("img");
		expect(image!.attributes.src).toBe(BANNER);
		expect(image!.attributes.alt).toBe("");
		expect(image!.attributes.class!.split(/\s+/)).toEqual(
			expect.arrayContaining([
				"pointer-events-none",
				"absolute",
				"inset-0",
				"h-full",
				"w-full",
				"[mask-image:linear-gradient(to_right,transparent_40%,black_90%)]",
				"object-cover",
				"object-right",
				"opacity-25",
			]),
		);
	});

	test("is fainter for someone offline", async () => {
		const [image] = await tags(MemberBanner, { src: BANNER, offline: true });
		expect(image!.attributes.class!.split(/\s+/)).toContain("opacity-15");
		expect(image!.attributes.class!.split(/\s+/)).not.toContain("opacity-25");
	});

	test("draws nothing for someone without one", async () => {
		expect(await tags(MemberBanner, { src: null })).toEqual([]);
	});
});

describe("the @ suggestions", () => {
	const input = source("ChatInput.svelte");
	const rows = input.slice(input.indexOf("<!-- Mention autocomplete dropdown -->"), input.indexOf("<!-- Room mention"));

	test("draw each member's banner behind their row, and their text above it", () => {
		expect(rows).toContain('<MemberBanner src={member.banner_url} offline={member.status === "offline"} />');
		expect(rows).toMatch(/role="option"[^>]*class="[^"]*\brelative\b/);
		expect(rows).toMatch(/<MemberBanner [^>]*\/>\s*<span class="relative /);
	});

	// A banner's image can be anything. Over a white one (dark theme) or a black one (light), at the banner's 25%, only the
	// ink reads: about 6:1 and 8:1 on a row, against about 3:1 for the second ink a username has without a banner.
	test("draw all of a row's text with a banner in the name's color", () => {
		expect(rows).toContain("{member.banner_url ? 'text-duvet-ink' : 'text-duvet-ink2'}");
	});
});

describe("a command's row", () => {
	const input = source("ChatInput.svelte");
	const rows = input.slice(
		input.indexOf("<!-- Command menu -->"),
		input.indexOf("<!-- Mention autocomplete dropdown -->"),
	);

	// Naming its bot on every row is enough: the bot's banner behind each one read as the same picture repeated down the
	// menu, not as the row of a member.
	test("draws no banner, and its text doesn't wait for one", () => {
		expect(rows).not.toContain("MemberBanner");
		expect(rows).not.toContain("banner_url");
	});
});

test("the member list draws the same banner", () => {
	const list = source("MemberList.svelte");
	expect(list).toContain("<PersonButton");
	expect(list).toContain("banner");
	expect(source("PersonButton.svelte")).toContain("<MemberBanner src={member.banner_url} {offline} />");
});

// #328: avatars, banners and Space icons loaded at once, every row of a list with its images, banners behind member
// rows included; and the crop saved them as PNG, about 100 KB for a 256×256 photo where WebP takes about 15 KB.
describe("profile images", () => {
	test("load as they come near the view", () => {
		for (const file of ["UserAvatar.svelte", "MemberBanner.svelte", "ui/SpaceIcon.svelte"]) {
			const images = source(file).match(/<img\b[\s\S]*?\/>/g) ?? [];
			expect(images.length).toBeGreaterThan(0);
			for (const image of images) expect(image).toContain('loading="lazy"');
		}
	});

	// WebKit's canvas writes no WebP and falls back to PNG: the file is named and typed as what came out.
	test("are cropped to WebP where the browser writes it, else PNG", () => {
		const crop = source("ImageCropModal.svelte");
		expect(crop).toContain('canvas.toBlob(resolve, "image/webp", 0.9)');
		expect(crop).toMatch(/const webp = blob\.type === "image\/webp";/);
		expect(crop).toContain('renamed(file.name, webp ? "webp" : "png")');
		expect(crop).not.toContain('canvas.toBlob(resolve, "image/png")');
	});
});
