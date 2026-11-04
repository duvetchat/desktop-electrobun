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
			"h-6",
			"w-6",
			"border-4",
			"border-zinc-800",
		]),
	);
});
