import { describe, expect, test } from "bun:test";
import {
	buttonClass,
	cardIconButtonClass,
	FOCUS_RING,
	FOCUS_RING_INSET,
	GLASS,
	GLASS_STRONG,
	iconButtonClass,
	iconTileClass,
	MENU_PANEL,
	menuItemClass,
	monogram,
	monogramSize,
	OVERLINE,
	pillClass,
	presenceSize,
	SCRIM,
	segmentIndex,
	spaceIconRadius,
} from "./recipes";

const classes = (list: string) => list.split(/\s+/);

describe("a button", () => {
	test("is 34 px with 11 px corners, or 28 with 9 when small", () => {
		expect(classes(buttonClass("primary", "md"))).toEqual(expect.arrayContaining(["h-[34px]", "rounded-control"]));
		expect(classes(buttonClass("primary", "sm"))).toEqual(expect.arrayContaining(["h-7", "rounded-tile"]));
	});

	test("primary is cobalt with white on it, resting on its shadow and pressed in", () => {
		expect(classes(buttonClass("primary"))).toEqual(
			expect.arrayContaining([
				"bg-duvet-accent",
				"text-duvet-on-accent",
				"shadow-duvet-control",
				"active:shadow-duvet-press",
			]),
		);
	});

	test("secondary is the tinted fill with the accent's text, darkened evenly on hover", () => {
		expect(classes(buttonClass("secondary"))).toEqual(
			expect.arrayContaining([
				"bg-duvet-secondary-fill",
				"text-duvet-accent-text",
				"hover:shadow-[inset_0_0_0_100px_var(--duvet-hover)]",
			]),
		);
	});

	// White is unreadable on the danger color in dark: it takes its own ink, which turns over with it.
	test("danger writes in the danger fill's own ink, never white", () => {
		const danger = classes(buttonClass("danger"));
		expect(danger).toEqual(expect.arrayContaining(["bg-duvet-danger", "text-duvet-on-danger"]));
		expect(danger).not.toContain("text-fixed-white");
	});

	test("quiet has no fill until hovered", () => {
		const quiet = classes(buttonClass("quiet"));
		expect(quiet.filter((c) => c.startsWith("bg-"))).toEqual([]);
		expect(quiet).toEqual(expect.arrayContaining(["text-duvet-ink2", "hover:bg-duvet-hover"]));
	});

	test("every variant fades when disabled and drops its transition under reduced motion", () => {
		for (const variant of ["primary", "secondary", "danger", "quiet"] as const) {
			expect(classes(buttonClass(variant))).toEqual(
				expect.arrayContaining([
					"disabled:opacity-45",
					"disabled:pointer-events-none",
					"motion-reduce:transition-none",
				]),
			);
		}
	});
});

describe("an icon button", () => {
	test("is 30 px with 9 px corners, or 26 with 8 when small", () => {
		expect(classes(iconButtonClass("md"))).toEqual(expect.arrayContaining(["size-[30px]", "rounded-tile"]));
		expect(classes(iconButtonClass("sm"))).toEqual(expect.arrayContaining(["size-[26px]", "rounded-lg"]));
	});

	test("idles in the second ink, and takes the accent's tint and text when active", () => {
		expect(classes(iconButtonClass("md", false))).toEqual(
			expect.arrayContaining(["text-duvet-ink2", "hover:bg-duvet-hover", "hover:text-duvet-ink"]),
		);
		const active = classes(iconButtonClass("md", true));
		expect(active).toEqual(expect.arrayContaining(["bg-duvet-accent-tint", "text-duvet-accent-text"]));
		expect(active).not.toContain("text-duvet-ink2");
	});

	test("a removal turns its hover destructive instead", () => {
		const danger = classes(iconButtonClass("md", false, true));
		expect(danger).toEqual(expect.arrayContaining(["hover:bg-duvet-danger/15!", "hover:text-duvet-danger!"]));
		expect(danger).not.toContain("hover:bg-duvet-hover");
	});
});

describe("glass", () => {
	test("is a tint over a 32 px blur, saturated, with the float shadow and its inner edge", () => {
		for (const glass of [GLASS, GLASS_STRONG]) {
			expect(classes(glass)).toEqual(
				expect.arrayContaining(["shadow-duvet-glass", "backdrop-blur-[32px]", "backdrop-saturate-[1.8]"]),
			);
		}
		expect(classes(GLASS)).toContain("bg-duvet-glass");
		expect(classes(GLASS_STRONG)).toContain("bg-duvet-glass-strong");
	});

	test("a menu's panel is glass, 224 to 320 wide, above popovers' layer", () => {
		expect(classes(MENU_PANEL)).toEqual(
			expect.arrayContaining([...classes(GLASS), "min-w-56", "max-w-80", "rounded-panel", "z-[1000]"]),
		);
	});
});

describe("a scrim", () => {
	test("covers the page under an overlay: the scrim fill, fixed, at the dialogs' layer", () => {
		expect(classes(SCRIM)).toEqual(
			expect.arrayContaining(["bg-duvet-scrim", "fixed", "inset-0", "z-[900]", "animate-scrim-in"]),
		);
	});
});

describe("an overline", () => {
	test("is the small uppercase label: 10.5 px, semibold, spaced, in the second ink", () => {
		expect(classes(OVERLINE)).toEqual(
			expect.arrayContaining(["text-duvet-ink2", "text-[10.5px]", "font-semibold", "tracking-[0.06em]", "uppercase"]),
		);
	});
});

describe("an icon tile", () => {
	test("is 30 px with 9 px corners, or 26 small, or 34 large, on the secondary fill", () => {
		expect(classes(iconTileClass("md"))).toEqual(
			expect.arrayContaining(["size-[30px]", "rounded-tile", "bg-duvet-secondary-fill", "text-duvet-accent-text"]),
		);
		expect(classes(iconTileClass("sm"))).toEqual(expect.arrayContaining(["size-[26px]", "rounded-tile"]));
		expect(classes(iconTileClass("lg"))).toEqual(expect.arrayContaining(["size-[34px]", "rounded-tile"]));
		expect(classes(iconTileClass("md", "ink"))).toContain("text-duvet-ink2");
	});
});

describe("a card icon button", () => {
	test("is the raised card's 36 px square, over the rows' radius", () => {
		expect(classes(cardIconButtonClass())).toEqual(
			expect.arrayContaining([
				"bg-duvet-card",
				"shadow-duvet-raised",
				"size-9",
				"rounded-row",
				"hover:text-duvet-ink",
				...classes(FOCUS_RING),
			]),
		);
	});

	test("a removal takes the danger ink", () => {
		const danger = classes(cardIconButtonClass(true));
		expect(danger).toContain("hover:text-duvet-danger");
		expect(danger).not.toContain("hover:text-duvet-ink");
	});
});

describe("the focus mark", () => {
	test("is the accent's 2 px line, offset, with no browser outline", () => {
		expect(classes(FOCUS_RING)).toEqual(
			expect.arrayContaining([
				"focus-override",
				"focus-visible:outline-2",
				"focus-visible:outline-offset-2",
				"focus-visible:outline-duvet-accent",
			]),
		);
	});

	test("turns inside the element where a sidebar or tab row would clip it", () => {
		expect(classes(FOCUS_RING_INSET)).toEqual(
			expect.arrayContaining([
				"focus-override",
				"focus-visible:outline-2",
				"focus-visible:-outline-offset-2",
				"focus-visible:outline-duvet-accent",
			]),
		);
	});
});

describe("a pill", () => {
	test("rests raised on the pill fill", () => {
		expect(classes(pillClass(false))).toEqual(
			expect.arrayContaining(["bg-duvet-pill", "text-duvet-ink", "shadow-duvet-raised"]),
		);
	});

	// palette.test.ts: the chosen fill always comes with the chosen ink.
	test("picked, takes the chosen fill with the chosen ink, and no shadow", () => {
		const picked = classes(pillClass(true));
		expect(picked).toEqual(expect.arrayContaining(["bg-duvet-chosen", "text-duvet-chosen-ink"]));
		expect(picked.filter((c) => c.includes("shadow-duvet"))).toEqual([]);
	});
});

describe("a menu item", () => {
	test("takes the accent's tint under the pointer or the keys, and when its submenu is open", () => {
		expect(classes(menuItemClass())).toEqual(
			expect.arrayContaining([
				"data-highlighted:bg-duvet-accent-tint",
				"data-[state=open]:bg-duvet-accent-tint",
				"data-disabled:opacity-45",
				"text-duvet-ink",
			]),
		);
	});

	test("a dangerous one is written in the danger color", () => {
		const danger = classes(menuItemClass(true));
		expect(danger).toContain("text-duvet-danger");
		expect(danger).not.toContain("text-duvet-ink");
	});
});

describe("the sums", () => {
	test("a presence dot is three tenths of its avatar, 8 px at least", () => {
		expect([16, 20, 28, 32, 40, 64, 84].map(presenceSize)).toEqual([8, 8, 8, 10, 12, 19, 25]);
	});

	test("a Space icon's corners are 27% of its size", () => {
		expect([22, 24, 44, 72].map(spaceIconRadius)).toEqual([6, 6, 12, 19]);
	});

	test("a Space's letter is 46% of its icon", () => {
		expect([22, 44, 72].map(monogramSize)).toEqual([10, 20, 33]);
	});

	test("a Space's letter is its name's first character, in upper case", () => {
		expect(monogram("harbour lights")).toBe("H");
		expect(monogram("  Kiln & Clay")).toBe("K");
		expect(monogram("éclair")).toBe("É");
		// One character as a reader sees it, not half of one.
		expect(monogram("👩‍🚀 crew")).toBe("👩‍🚀");
		expect(monogram("")).toBe("");
	});

	test("a segmented control's thumb sits at its pick, at the start for a pick that isn't an option", () => {
		const options = ["all", "chats", "spaces"] as const;
		expect(segmentIndex(options, "all")).toBe(0);
		expect(segmentIndex(options, "spaces")).toBe(2);
		expect(segmentIndex<string>(options, "elsewhere")).toBe(0);
		expect(segmentIndex(options, undefined)).toBe(0);
	});
});
