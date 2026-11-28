import { describe, expect, test } from "bun:test";
import { createRawSnippet } from "svelte";
import { render } from "svelte/server";
// oxlint-disable-next-line import/no-unassigned-import -- it has Bun load .svelte files compiled for the server
import "../server-render";
const { default: Disclosure } = await import("./Disclosure.svelte");

// The fold every list row in the Spaces column uses: a header button and the content under it, which isn't rendered
// while it's closed. The id on the button and the panel it controls must agree whatever the state.
const header = createRawSnippet(() => ({ render: () => "<span>Header</span>" }));
const children = createRawSnippet(() => ({ render: () => "<p>Content</p>" }));
const actions = createRawSnippet(() => ({ render: () => "<button>Menu</button>" }));
const html = (props: Record<string, unknown>) => render(Disclosure, { props: { header, children, ...props } }).body;
const controls = (body: string) => /aria-controls="([^"]+)"/.exec(body)?.[1];

describe("the disclosure", () => {
	test("is a button that names its panel and says whether it's open", () => {
		const closed = html({ open: false });
		const panel = controls(closed);
		expect(typeof panel).toBe("string");
		expect(closed).toContain('aria-expanded="false"');
		expect(closed).not.toContain("Content");
		expect(closed).not.toContain(`id="${panel}"`);

		const opened = html({ open: true });
		expect(opened).toContain('aria-expanded="true"');
		expect(opened).toContain(`id="${panel}"`);
		expect(opened).toContain('role="group"');
		expect(opened).toContain("Content");
	});

	// The menu button rides on the header row, not on the root: an open panel is tall, and an action stretched over it
	// lands in the middle of the tree, over a channel's unread dot.
	test("keeps its actions on the header row, not stretched over an open panel", () => {
		const opened = html({ open: true, actions });
		const headerAt = opened.indexOf('<div class="relative flex items-center">');
		const menu = opened.indexOf("absolute inset-y-0");
		const panelAt = opened.indexOf("<div id=");
		expect(headerAt).toBeGreaterThan(-1);
		expect(menu).toBeGreaterThan(headerAt);
		expect(panelAt).toBeGreaterThan(menu);
	});

	test("can be forced open by a filter, and shows a tree row when it has a level", () => {
		const forced = html({ open: false, forceOpen: true });
		expect(forced).toContain('aria-expanded="true"');
		expect(forced).toContain("Content");

		const row = html({ open: false, level: 2, rowId: "category:c1" });
		expect(row).toContain('role="treeitem"');
		expect(row).toContain('aria-level="2"');
		expect(row).toContain('data-tree-id="category:c1"');
	});
});
