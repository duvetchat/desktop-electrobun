import { expect, mock, test } from "bun:test";
import { createRawSnippet } from "svelte";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tags } from "./server-render";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules use $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { default: CallHistoryPopover } = await import("./CallHistoryPopover.svelte");

// What opens the popover is the shell's: a button that takes the props it is handed.
const trigger = createRawSnippet<[Record<string, unknown>]>((props) => ({
	render: () =>
		`<button data-opener ${Object.entries(props())
			.filter(([, value]) => typeof value === "string" || typeof value === "boolean")
			.map(([name, value]) => `${name}="${String(value)}"`)
			.join(" ")}>Calls</button>`,
}));

// #357: the call history is a popover from the sidebar's header. Its list is CallHistory's (lib/call-history.ts and
// its tests); this is the popover around it.
test("closed, it is only what opens it, which says it opens a dialog", async () => {
	const all = await tags(CallHistoryPopover, { trigger });
	const opener = all.find((tag) => "data-opener" in tag.attributes);
	expect(opener?.attributes["aria-haspopup"]).toBe("dialog");
	expect(opener?.attributes["aria-expanded"]).toBe("false");
	expect(all.some((tag) => tag.attributes.role === "dialog")).toBe(false);
});

// An open panel is drawn in the page's root, which a render on the server doesn't have: its recipe is read from the
// source, as the primitives' own tests read theirs.
test("its panel is named Call history, 360 wide, and scrolls the list under its title", () => {
	const source = readFileSync(join(import.meta.dir, "CallHistoryPopover.svelte"), "utf8");
	expect(source).toContain('label="Call history"');
	expect(source).toContain('class="flex max-h-[min(560px,72vh)] w-[360px] flex-col rounded-[20px]"');
	expect(source).toMatch(/<h2[^>]*>Call history<\/h2>/);
	expect(source).toMatch(/overflow-y-auto[^>]*>\s*<CallHistory onOpen=\{openCall\} \/>/);
	// A row closes the popover as it opens its chat.
	expect(source).toMatch(/function openCall\(link: MessageLink\) \{\s*open = false;/);
	// The prototype's All · Missed filter and its Start a call are proposals (COPY.md §4.9): neither is drawn.
	expect(source).not.toMatch(/Missed|Start a call/);
});
