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
		expect(image.name).toBe("img");
		expect(image.attributes.src).toBe(BANNER);
		expect(image.attributes.alt).toBe("");
		expect(image.attributes.class.split(/\s+/)).toEqual(
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
		expect(image.attributes.class.split(/\s+/)).toContain("opacity-15");
		expect(image.attributes.class.split(/\s+/)).not.toContain("opacity-25");
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
		expect(rows).toMatch(/role="option"[^>]*class="relative /);
		expect(rows).toMatch(/<MemberBanner [^>]*\/>\s*<span class="relative /);
	});

	// A banner's image can be anything. Over a white one (dark theme) or a black one (light), at the banner's 25%, only the
	// name's color reads: 5.2:1 and 7:1 on a row, and 4.1:1 and 6:1 on the keyboard's, against 1.5:1 and 2.9:1 for the
	// dim one a username has without a banner.
	test("draw all of a row's text with a banner in the name's color", () => {
		expect(rows).toContain("{member.banner_url ? 'text-night-85' : 'text-night-52'}");
	});
});

describe("a command's row", () => {
	const input = source("ChatInput.svelte");
	const rows = input.slice(
		input.indexOf("<!-- Command menu -->"),
		input.indexOf("<!-- Mention autocomplete dropdown -->"),
	);

	test("draws its bot's banner, which the bot has as a member of the space", () => {
		expect(rows).toContain("{@const botMember = bot && members.find((m) => m.id === bot.id)}");
		expect(rows).toContain(
			'<MemberBanner src={botMember?.banner_url ?? null} offline={botMember?.status === "offline"} />',
		);
		expect(rows).toMatch(/role="option"[^>]*class="relative /);
		expect(rows).toMatch(/<MemberBanner [^>]*\/>\s*<span class="relative /);
	});

	test("with all of its text in the name's color then", () => {
		expect(rows.match(/botMember\?\.banner_url\s*\?\s*'text-night-85'/g)).toHaveLength(2);
	});
});

test("the member list draws the same banner", () => {
	expect(source("MemberList.svelte")).toContain(
		'<MemberBanner src={member.banner_url} offline={member.status === "offline"} />',
	);
});
