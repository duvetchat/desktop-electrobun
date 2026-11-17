import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tags } from "./server-render";

const { default: StatusDot } = await import("./StatusDot.svelte");
const popover = readFileSync(join(import.meta.dir, "MemberProfilePopover.svelte"), "utf8");

// The popover's avatar dot is drawn as every status dot, online in the theme's colour, not in a grey of its own close
// to offline's (desktop#152).
test("the profile popover's status dot is a StatusDot of the member's status, at its size and with its border", async () => {
	const dot = /<StatusDot\s[^>]*\/>/.exec(popover)?.[0] ?? "";
	expect(dot).toContain("status={member.status}");
	expect(popover).not.toMatch(/member\.status === ["']online["']/);
	// What it draws for a member who is online.
	const [drawn] = await tags(StatusDot, { status: "online", class: /\sclass="([^"]*)"/.exec(dot)?.[1] ?? "" });
	expect(drawn.attributes.class.split(/\s+/)).toEqual(
		expect.arrayContaining([
			"bg-[var(--status-online,var(--color-stone-300))]",
			"rounded-full",
			"aspect-square",
			"w-6",
			"border-4",
			"border-current",
			"text-zinc-800",
		]),
	);
});

// For a member connected only from the mobile app, a phone takes the dot's place, as wide and in the same ring (#82).
test("the profile popover draws a phone for a member only on mobile", async () => {
	const dot = /<StatusDot\s[^>]*\/>/.exec(popover)?.[0] ?? "";
	expect(dot).toContain("mobileOnly={member.mobile_only}");
	const [drawn] = await tags(StatusDot, {
		status: "online",
		mobileOnly: true,
		class: /\sclass="([^"]*)"/.exec(dot)?.[1] ?? "",
	});
	expect(drawn.attributes.class.split(/\s+/)).toEqual(
		expect.arrayContaining(["aspect-[2/3]", "w-6", "border-4", "border-current", "bg-current", "text-zinc-800"]),
	);
});

// #319: bits-ui's Portal mounts what it holds as it's created, open or not, so every message's author and every member
// row mounted a closed profile under <body>. It mounts only while open, whether its owner opens it or its trigger does.
test("mounts its portal only while it's open", () => {
	expect(popover).toContain("let shown = $derived(open);");
	expect(popover).toMatch(/onOpenChange=\{\(o\) => \{\s*shown = o;/);
	expect(popover).toMatch(/\{#if shown\}\s*<Popover\.Portal>/);
});
