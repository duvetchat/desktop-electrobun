import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import type { ComponentProps } from "svelte";
import { render } from "svelte/server";
// oxlint-disable-next-line import/no-unassigned-import -- it has Bun load .svelte files compiled for the server
import "./server-render";
import type { Shell } from "$lib/platform";
import type { Tab } from "$lib/types";

// A tab's icon draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
void mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules use runes, which only Svelte's compiler knows: the value itself, and no effects.
Object.assign(globalThis, {
	$state: <T>(value: T) => value,
	$effect: Object.assign(() => {}, { root: () => () => {} }),
});

// The shell the strip reads, which each test sets before it renders.
let shell: Shell;
const shellOf = (chrome: Shell["chrome"]): Shell => ({
	chrome,
	os: chrome === "web" ? "mac" : chrome,
	window: "main",
	nativeTrafficLights: chrome === "mac",
	ownWindowControls: chrome === "windows" || chrome === "linux",
	draggableTitleBar: chrome !== "web",
	settingsInWindows: false,
	popOut: chrome !== "web",
	vibrancy: false,
	preview: false,
});
void mock.module("$lib/platform", () => ({ currentShell: () => shell }));
const { default: TabBar } = await import("./TabBar.svelte");

type Props = ComponentProps<typeof TabBar>;
const room = (n: number): Tab => ({ channelId: `r${n}`, channelName: `room-${n}`, channelType: "text", spaceId: "s" });
const rooms = (count: number) => Array.from({ length: count }, (_, index) => room(index + 1));

interface DrawnTab {
	/** What it names to assistive tech (aria-keyshortcuts). */
	shortcut: string | null;
	/** The keys it shows, and their classes. */
	keys: string | null;
	keysClass: string[];
	keysHidden: string | null;
	/** Its Close button's classes; empty for a tab without one. */
	close: string[];
}

/** Each tab the strip draws on a system, in order. */
async function drawn(chrome: Shell["chrome"], tabs: Tab[], more: Partial<Props> = {}): Promise<DrawnTab[]> {
	shell = shellOf(chrome);
	const props: Props = {
		tabs,
		activeTabId: tabs[0]?.channelId ?? null,
		leafId: "leaf",
		onSelect: () => {},
		onClose: () => {},
		onReorder: () => {},
		onChannelDrop: () => {},
		onJoin: () => {},
		...more,
	};
	const found: DrawnTab[] = [];
	const classes = (value: string | null) => (value ?? "").split(/\s+/).filter(Boolean);
	await new HTMLRewriter()
		.on('[role="tab"]', {
			element: (el) => {
				found.push({
					shortcut: el.getAttribute("aria-keyshortcuts"),
					keys: null,
					keysClass: [],
					keysHidden: null,
					close: [],
				});
			},
		})
		.on('[role="tab"] kbd', {
			element: (el) => {
				const tab = found.at(-1)!;
				tab.keysClass = classes(el.getAttribute("class"));
				tab.keysHidden = el.getAttribute("aria-hidden");
			},
			text: (chunk) => {
				const tab = found.at(-1)!;
				tab.keys = (tab.keys ?? "") + chunk.text;
			},
		})
		.on('[role="tab"] button[aria-label="Close tab"]', {
			element: (el) => {
				found.at(-1)!.close = classes(el.getAttribute("class"));
			},
		})
		.transform(new Response(render(TabBar, { props }).body))
		.text();
	return found;
}

const WAITS = ["opacity-0", "group-hover/tab:opacity-100", "group-focus-within/tab:opacity-100"];

// #420: ⌘1–9 on macOS and Ctrl+1–9 elsewhere pick a tab by its place, and nothing on the tabs said which is which.
describe("a tab's shortcut", () => {
	test("in macOS's app each tab shows it, always, and names it to assistive tech", async () => {
		const tabs = await drawn("mac", rooms(3));
		expect(tabs.map((tab) => tab.keys)).toEqual(["⌘1", "⌘2", "⌘3"]);
		expect(tabs.map((tab) => tab.shortcut)).toEqual(["Meta+1", "Meta+2", "Meta+3"]);
		// The name is aria-keyshortcuts': the keys drawn aren't read out as part of the tab's own name.
		for (const tab of tabs) expect(tab.keysHidden).toBe("true");
	});

	test("past eight tabs, the last one has ⌘9 and those between have none", async () => {
		const tabs = await drawn("mac", rooms(12));
		const between = [null, null, null];
		expect(tabs.map((tab) => tab.keys)).toEqual(["⌘1", "⌘2", "⌘3", "⌘4", "⌘5", "⌘6", "⌘7", "⌘8", ...between, "⌘9"]);
		expect(tabs.map((tab) => tab.shortcut)).toEqual([
			...["Meta+1", "Meta+2", "Meta+3", "Meta+4", "Meta+5", "Meta+6", "Meta+7", "Meta+8"],
			...between,
			"Meta+9",
		]);
	});

	test("it shows whichever tab is open, and while the Friends page shows", async () => {
		for (const more of [{ activeTabId: "r2" }, { activeTabId: null }, { friendsActive: true }]) {
			const tabs = (await drawn("mac", rooms(3), more)).filter((tab) => tab.shortcut);
			expect(tabs.map((tab) => tab.keys)).toEqual(["⌘1", "⌘2", "⌘3"]);
		}
	});

	test("it gives its place to the Close button while the tab is pointed at or has the focus", async () => {
		// The open tab's too, whose button is otherwise always in view.
		for (const tab of await drawn("mac", rooms(3))) {
			expect(tab.keysClass).toEqual(
				expect.arrayContaining(["group-hover/tab:opacity-0", "group-focus-within/tab:opacity-0"]),
			);
			expect(tab.close).toEqual(expect.arrayContaining(WAITS));
			// One place for the two: the same cell of the slot's grid.
			for (const cell of ["col-start-1", "row-start-1"]) {
				expect(tab.keysClass).toContain(cell);
				expect(tab.close).toContain(cell);
			}
		}
	});

	test("an open tab without one keeps its Close button in view", async () => {
		// The tenth of twelve: no digit picks it.
		const tabs = await drawn("mac", rooms(12), { activeTabId: "r10" });
		expect(tabs[9]).toMatchObject({ keys: null, shortcut: null });
		expect(tabs[9]!.close).not.toContain("opacity-0");
		expect(tabs[10]!.close).toEqual(expect.arrayContaining(WAITS));
	});

	test("a split's joined tab shows it as any tab does", async () => {
		const halves = [
			{ leafId: "leaf", tab: room(1), focused: true },
			{ leafId: "other", tab: room(9), focused: false },
		];
		const tabs = await drawn("mac", rooms(2), { halves });
		expect(tabs.map((tab) => [tab.keys, tab.shortcut])).toEqual([
			["⌘1", "Meta+1"],
			["⌘2", "Meta+2"],
		]);
		expect(tabs[0]!.close).toEqual(expect.arrayContaining(WAITS));
	});

	test("Windows and Linux name Ctrl's and show none: their tabs are as they were", async () => {
		for (const chrome of ["windows", "linux"] as const) {
			const tabs = await drawn(chrome, rooms(3));
			expect(tabs.map((tab) => tab.keys)).toEqual([null, null, null]);
			expect(tabs.map((tab) => tab.shortcut)).toEqual(["Control+1", "Control+2", "Control+3"]);
			// The open tab's Close button is in view; the others' wait for the pointer or the focus.
			expect(tabs[0]!.close).not.toContain("opacity-0");
			expect(tabs[1]!.close).toEqual(expect.arrayContaining(WAITS));
		}
	});

	test("a browser keeps the digits for its own tabs: neither shown nor named", async () => {
		const tabs = await drawn("web", rooms(3));
		expect(tabs.map((tab) => [tab.keys, tab.shortcut])).toEqual([
			[null, null],
			[null, null],
			[null, null],
		]);
	});

	test("the Friends tab and an empty pane's New tab have none: no digit picks them", async () => {
		const withFriends = await drawn("mac", rooms(2), { friendsActive: true });
		expect(withFriends.map((tab) => tab.shortcut)).toEqual([null, "Meta+1", "Meta+2"]);
		expect(withFriends[0]!.keys).toBeNull();
		expect(await drawn("mac", [])).toEqual([
			{ shortcut: null, keys: null, keysClass: [], keysHidden: null, close: [] },
		]);
	});
});
