import { describe, expect, test } from "bun:test";
import { Code, User } from "@lucide/svelte";
import {
	calloutClass,
	filterNav,
	listFileSize,
	navLabel,
	roleBackground,
	roleHex,
	usagePercent,
	usageTone,
	type SettingsNavGroup,
} from "./recipes";

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
