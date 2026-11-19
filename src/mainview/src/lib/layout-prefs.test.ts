import { expect, test } from "bun:test";
import { defaultLayoutPrefs, LAYOUT_PREFS_KEY, parseLayoutPrefs, type LayoutPrefs } from "$lib/layout-prefs";

// The prefs' store is a .svelte.ts module, whose runes only Svelte's compiler knows: here $state is the value itself,
// and an effect runs once, as the module loads, which is when the store first saves what it read.
Object.assign(globalThis, {
	$state: <T>(value: T) => value,
	$effect: Object.assign((run: () => void) => run(), {
		root: (run: () => void) => {
			run();
			return () => {};
		},
	}),
});

const NOTHING_KEPT = { rooms: false, groups: false };

// #366: the members popover can be kept open, per kind of chat (a Space's text room, a group), in the layout prefs.
test("the members popover is kept open per kind of chat, and a value that isn't one keeps nothing open", () => {
	expect(defaultLayoutPrefs.membersKeptOpen).toEqual(NOTHING_KEPT);
	expect(parseLayoutPrefs('{"membersKeptOpen":{"rooms":true}}').membersKeptOpen).toEqual({
		rooms: true,
		groups: false,
	});
	expect(parseLayoutPrefs('{"membersKeptOpen":{"groups":true,"rooms":"yes"}}').membersKeptOpen).toEqual({
		rooms: false,
		groups: true,
	});
	for (const saved of ['{"membersKeptOpen":true}', '{"membersKeptOpen":["rooms"]}', '{"membersKeptOpen":null}', "{}"]) {
		expect(parseLayoutPrefs(saved).membersKeptOpen, saved).toEqual(NOTHING_KEPT);
	}
	// Each parse is its own: keeping one open doesn't keep it open in the defaults.
	parseLayoutPrefs(null).membersKeptOpen.rooms = true;
	expect(defaultLayoutPrefs.membersKeptOpen).toEqual(NOTHING_KEPT);
});

test("a popover kept open outlives a reload: the store saves it with the rest of the layout", async () => {
	const saved: LayoutPrefs = {
		...defaultLayoutPrefs,
		openChats: "vertical",
		membersKeptOpen: { rooms: false, groups: true },
	};
	localStorage.setItem(LAYOUT_PREFS_KEY, JSON.stringify(saved));
	const { layoutPrefs } = await import("$lib/layout-prefs.svelte");
	expect(layoutPrefs).toEqual(saved);
	// What the store saved as it loaded, which the next start reads.
	expect(parseLayoutPrefs(localStorage.getItem(LAYOUT_PREFS_KEY))).toEqual(saved);
});
