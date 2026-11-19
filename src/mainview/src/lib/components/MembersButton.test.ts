import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tags } from "./server-render";
import type { MemberOnSidebar } from "$lib/types";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
void mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules use runes only Svelte's compiler knows: $state is the value itself here, and the layout
// prefs' effect, which saves them, runs once as the module loads.
Object.assign(globalThis, {
	$state: <T>(value: T) => value,
	$effect: Object.assign((run: () => void) => run(), {
		root: (run: () => void) => {
			run();
			return () => {};
		},
	}),
});
const { default: MembersButton } = await import("./MembersButton.svelte");
const { layoutPrefs } = await import("$lib/layout-prefs.svelte");

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

const person = (n: number, status: MemberOnSidebar["status"]): MemberOnSidebar => ({
	id: `user-${n}`,
	member_id: `member-${n}`,
	username: `user${n}`,
	raw_username: `user${n}`,
	avatar_url: null,
	banner_url: null,
	status,
	mobile_only: false,
	badges: 0,
	is_bot: false,
	is_owner: false,
	roles: [],
	bio: "",
});
const crew = [person(1, "online"), person(2, "online"), person(3, "offline")];

// The bar's members button, as a server draws it: its <button>, by its name.
async function membersButton(props: { column?: "rooms" | "groups" }) {
	const all = await tags(MembersButton, { channelId: "group-1", members: crew, ...props });
	const button = all.find((tag) => tag.name === "button" && tag.attributes["aria-label"] === "Members, 2 online");
	if (!button) throw new Error("no members button");
	return button.attributes;
}

// #409: beside a Space's text room or a group, in a pane with room for it, the members are a column, which the bar's
// button opens and closes: a toggle, pressed while the column is open, with no popover.
test("with a column, the button opens and closes it, pressed while it's open", async () => {
	layoutPrefs.membersColumn.groups = true;
	const open = await membersButton({ column: "groups" });
	expect(open["aria-pressed"]).toBe("true");
	expect(open.title).toBe("Hide members");
	expect(open.type).toBe("button");
	expect(open["aria-haspopup"]).toBeUndefined();
	// Pressed, it has the look its popover gives it while open: the accent's tint behind the faces.
	expect(open.class).toContain("bg-duvet-accent-tint");

	layoutPrefs.membersColumn.groups = false;
	const closed = await membersButton({ column: "groups" });
	expect(closed["aria-pressed"]).toBe("false");
	expect(closed.title).toBe("Show members");
	expect(closed.class).not.toContain("bg-duvet-accent-tint");
	layoutPrefs.membersColumn.groups = true;
});

// A voice room, a DM, and any chat in a pane too narrow for the column: the button opens the list in its popover, as
// before the column came back, whether the columns are open or closed.
test("without a column, the button opens the popover", async () => {
	for (const shown of [true, false]) {
		layoutPrefs.membersColumn.rooms = shown;
		layoutPrefs.membersColumn.groups = shown;
		const button = await membersButton({});
		expect(button["aria-haspopup"]).toBe("dialog");
		expect(button["aria-expanded"]).toBe("false");
		expect(button["aria-pressed"]).toBeUndefined();
		expect(button.title).toBe("Members");
	}
	layoutPrefs.membersColumn.rooms = true;
	layoutPrefs.membersColumn.groups = true;
});

test("its click flips the column of its kind of chat, saved in the layout prefs", () => {
	const button = source("MembersButton.svelte");
	expect(button).toMatch(
		/function toggleColumn\(\) \{\s*if \(column\) layoutPrefs\.membersColumn\[column\] = !layoutPrefs\.membersColumn\[column\];\s*\}/,
	);
	expect(button).toMatch(
		/\{#if column\}[^]*?aria-pressed=\{columnOpen\}[^]*?onclick=\{toggleColumn\}[^]*?\{:else\}\s*<Popover\.Root/,
	);
	// A pane that grows wide enough for the column takes the list there: an open popover closes, rather than open
	// again by itself once the pane narrows.
	expect(button).toMatch(/\$effect\(\(\) => \{\s*if \(column\) open = false;\s*\}\);/);
});

// #366's pin, which kept the popover open per kind of chat, went with the column: the popover is a dialog again, as it
// was before the pin, and nothing keeps it open.
test("the popover keeps no pin: a dialog that a click or Esc elsewhere closes", () => {
	const button = source("MembersButton.svelte");
	expect(button).not.toMatch(/membersKeptOpen|followPin|Keep open|trapFocus|interactOutsideBehavior|complementary/);
	expect(button).toContain('role="dialog"');
});
