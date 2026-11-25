import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drawnHeight, tags } from "./server-render";
import { buttonClass } from "./ui/recipes";

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
	expect(drawn!.attributes.class!.split(/\s+/)).toEqual(
		expect.arrayContaining([
			"bg-duvet-alive",
			"rounded-full",
			"aspect-square",
			"w-6",
			"border-4",
			"border-current",
			"text-duvet-bg",
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
	expect(drawn!.attributes.class!.split(/\s+/)).toEqual(
		expect.arrayContaining(["aspect-[2/3]", "w-6", "border-4", "border-current", "bg-current", "text-duvet-bg"]),
	);
});

// #319: bits-ui's Portal mounts what it holds as it's created, open or not, so every message's author and every member
// row mounted a closed profile under <body>. It mounts only while open, whether its owner opens it or its trigger does.
test("mounts its portal only while it's open", () => {
	expect(popover).toContain("let shown = $derived(open);");
	expect(popover).toMatch(/onOpenChange=\{\(o\) => \{\s*shown = o;/);
	expect(popover).toMatch(/\{#if shown\}\s*<Popover\.Portal>/);
});

// Send direct message, for whom a member's menu offers Message (canChatWith: a friend, or someone the user has a direct
// conversation with; never a bot or the user). Pressed, it closes the profile and opens their conversation as the
// menu's Message does (chatWith, which the app's page answers).
const sendMessage = /\{#if canMessage\}\s*(<button\b[^]*?<\/button>)\s*\{\/if\}/.exec(popover)?.[1] ?? "";

test("the profile offers Send direct message to whom the user can chat with", () => {
	expect(popover).toMatch(
		/const canMessage = \$derived\(\s*!!\$currentUser &&\s*canChatWith\(\s*\$currentUser\.id,\s*\{ id: member\.id, isBot: member\.is_bot \},\s*tiesOf\(member\.id, \$currentUser\.id, \{/,
	);
	expect(sendMessage).toContain("Send direct message");
	// Under their details, before what removes them.
	expect(popover.indexOf("{#if canMessage}")).toBeGreaterThan(popover.indexOf("{#if showPermissions}"));
	expect(popover.indexOf("{#if canMessage}")).toBeLessThan(popover.indexOf("{#if moderation}"));
});

test("Send direct message closes the profile and opens their direct conversation", () => {
	expect(sendMessage).toMatch(/onclick=\{\(\) => \{\s*onOpenChange\(false\);\s*chatWith\(member\.id\);\s*\}\}/);
});

// A tall profile stays in the window: its details scroll in what the window leaves, less what's drawn under them,
// which the button adds to (its own height and the gap over it).
test("the details leave Send direct message its room in the window", () => {
	const left =
		/canMessage\s*\?\s*'max-h-\[max\(160px,calc\(100vh-(\d+)px\)\)\]'\s*:\s*'max-h-\[max\(160px,calc\(100vh-(\d+)px\)\)\]'/.exec(
			popover,
		);
	const classes = /class="\{buttonClass\('primary'\)\} ([^"]*)"/.exec(sendMessage)?.[1]?.split(/\s+/) ?? [];
	expect(classes).toContain("mt-3");
	const button = drawnHeight({ name: "button", attributes: { class: buttonClass("primary") } });
	expect(Number(left?.[1]) - Number(left?.[2])).toBe(button + 3 * 4);
});
