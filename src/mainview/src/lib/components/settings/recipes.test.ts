import { describe, expect, test } from "bun:test";
import { Code, User } from "@lucide/svelte";
import {
	ACTION_BAR,
	calloutClass,
	CARD,
	FIELD,
	filterNav,
	listFileSize,
	NAV_TILE,
	navItemClass,
	navLabel,
	roleBackground,
	roleHex,
	rowClass,
	ROW_TILE,
	SELECT,
	usagePercent,
	usageTone,
	type SettingsNavGroup,
} from "./recipes";

const classes = (list: string) => list.split(/\s+/);

describe("the side panel's items", () => {
	test("a picked item takes the accent tint, an idle one the sidebar's hover", () => {
		expect(classes(navItemClass(true))).toEqual(
			expect.arrayContaining([
				"h-10",
				"text-[14px]",
				"bg-duvet-accent-tint",
				"text-duvet-ink",
				"rounded-tile",
				"gap-2.5",
			]),
		);
		expect(classes(navItemClass())).toEqual(expect.arrayContaining(["hover:bg-duvet-sb-hover", "rounded-tile"]));
	});

	test("the way out is dangerous, with no picked fill", () => {
		const danger = classes(navItemClass(false, true));
		expect(danger).toEqual(expect.arrayContaining(["text-duvet-danger", "hover:bg-duvet-danger/10"]));
		expect(danger).not.toContain("bg-duvet-accent-tint");
	});

	test("its tile is 28 px with 9 px corners, and its foot's icon takes the same slot", () => {
		expect(classes(NAV_TILE)).toEqual(
			expect.arrayContaining(["size-[28px]", "rounded-tile", "text-fixed-white", "place-items-center"]),
		);
	});
});

describe("a settings row", () => {
	test("keeps its 60 px line, with the control beside the words or under them", () => {
		expect(classes(rowClass())).toEqual(expect.arrayContaining(["min-h-[60px]", "px-4", "py-3", "items-center"]));
		expect(classes(rowClass(true))).toEqual(expect.arrayContaining(["flex-col", "justify-center"]));
	});

	test("its icon sits in the shared 34 px tile", () => {
		expect(classes(ROW_TILE)).toEqual(
			expect.arrayContaining(["size-[34px]", "rounded-tile", "bg-duvet-secondary-fill"]),
		);
	});
});

describe("a settings card", () => {
	test("takes the 16 px card radius, the raised shadow and no overflow", () => {
		expect(classes(CARD)).toEqual(
			expect.arrayContaining(["bg-duvet-card", "shadow-duvet-raised", "rounded-card", "overflow-hidden"]),
		);
	});

	test("an action bar floats over the page on the same radius, with its inset margins", () => {
		expect(classes(ACTION_BAR)).toEqual(
			expect.arrayContaining([
				"bg-duvet-card",
				"shadow-duvet-lifted",
				"rounded-card",
				"mx-8",
				"text-[14px]",
				"justify-between",
			]),
		);
	});
});

describe("a Settings field", () => {
	test("is 44 px tall and reads at the larger size, on the shared well", () => {
		expect(classes(FIELD)).toEqual(
			expect.arrayContaining(["h-11", "text-[14.5px]", "rounded-control", "bg-duvet-card"]),
		);
	});

	test("a select is 36 tall on the secondary fill", () => {
		expect(classes(SELECT)).toEqual(
			expect.arrayContaining(["h-9", "text-[13.5px]", "bg-duvet-secondary-fill", "rounded-tile"]),
		);
	});
});

const groups: SettingsNavGroup<"account" | "audio" | "developer">[] = [
	{
		items: [
			{ id: "account", label: "My account", icon: User, tile: "#5e6380" },
			{ id: "audio", label: "Audio", icon: User, tile: "#f97316" },
		],
	},
	{ title: "Apps", items: [{ id: "developer", label: "Developer", icon: Code, tile: "#5f45b5", count: 2 }] },
];

describe("the side panel's search", () => {
	test("nothing typed lists every section, in its groups", () => {
		expect(filterNav(groups, "  ")).toEqual(groups);
	});

	test("keeps the sections whose label has what's typed, whatever its case, and drops a group left empty", () => {
		const found = filterNav(groups, "AU");
		expect(found.map((group) => group.items.map((item) => item.id))).toEqual([["audio"]]);
		expect(filterNav(groups, "dev")[0]!.title).toBe("Apps");
		expect(filterNav(groups, "zzz")).toEqual([]);
	});

	test("a section's label names the page", () => {
		expect(navLabel(groups, "developer")).toBe("Developer");
		expect(navLabel(groups, "account")).toBe("My account");
	});
});

describe("storage's sums", () => {
	test("a usage bar is whole percents of the limit, never past full, and empty without a limit", () => {
		expect(usagePercent(50, 200)).toBe(25);
		expect(usagePercent(999, 100)).toBe(100);
		expect(usagePercent(1, 3)).toBe(33);
		expect(usagePercent(10, 0)).toBe(0);
	});

	test("the bar turns amber past 70% and red past 90%", () => {
		expect(usageTone(70)).toBe("bg-duvet-ink2");
		expect(usageTone(71)).toBe("bg-duvet-warn");
		expect(usageTone(90)).toBe("bg-duvet-warn");
		expect(usageTone(91)).toBe("bg-duvet-danger");
	});

	test("a file's size reads in B, KB or MB to a decimal", () => {
		expect(listFileSize(512)).toBe("512 B");
		expect(listFileSize(1536)).toBe("1.5 KB");
		expect(listFileSize(12.3 * 1024 * 1024)).toBe("12.3 MB");
	});
});

describe("a role's colour", () => {
	test("none is the second ink, one stop a solid, two a gradient, three a gradient through the middle", () => {
		expect(roleBackground({ color_from: null, color_via: null, color_to: null })).toBe("var(--duvet-ink2)");
		expect(roleBackground({ color_from: 0xff0000, color_via: null, color_to: null })).toBe("#ff0000");
		expect(roleBackground({ color_from: 0xff0000, color_via: null, color_to: 0x0000ff })).toBe(
			"linear-gradient(90deg, #ff0000, #0000ff)",
		);
		expect(roleBackground({ color_from: 0xff0000, color_via: 0x00ff00, color_to: 0x0000ff })).toBe(
			"linear-gradient(90deg, #ff0000, #00ff00, #0000ff)",
		);
	});

	test("a number is six hex digits, and none the wells' starting violet", () => {
		expect(roleHex(0x0000ff)).toBe("#0000ff");
		expect(roleHex(0)).toBe("#000000");
		expect(roleHex(null)).toBe("#7b83f5");
		expect(roleHex(undefined)).toBe("#7b83f5");
	});
});

test("a callout is tinted by what it says", () => {
	expect(calloutClass("warn")).toContain("text-duvet-warn");
	expect(calloutClass("danger")).toContain("text-duvet-danger");
	expect(calloutClass("good")).toContain("text-duvet-alive");
	expect(calloutClass()).toContain("bg-duvet-secondary-fill");
});
