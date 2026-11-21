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

const ALL_OPEN = { rooms: true, groups: true };

// #409: the members column beside a chat is open or closed per kind of chat (a Space's text room, a group), in the
// layout prefs, and open until it's closed.
test("the members column is open by default, kept per kind of chat, and a value that isn't one leaves it open", () => {
	expect(defaultLayoutPrefs.membersColumn).toEqual(ALL_OPEN);
	expect(parseLayoutPrefs(null).membersColumn).toEqual(ALL_OPEN);
	expect(parseLayoutPrefs('{"membersColumn":{"rooms":false}}').membersColumn).toEqual({ rooms: false, groups: true });
	expect(parseLayoutPrefs('{"membersColumn":{"groups":false,"rooms":"no"}}').membersColumn).toEqual({
		rooms: true,
		groups: false,
	});
	expect(parseLayoutPrefs('{"membersColumn":{"rooms":false,"groups":false}}').membersColumn).toEqual({
		rooms: false,
		groups: false,
	});
	for (const saved of ['{"membersColumn":false}', '{"membersColumn":["rooms"]}', '{"membersColumn":null}', "{}"]) {
		expect(parseLayoutPrefs(saved).membersColumn, saved).toEqual(ALL_OPEN);
	}
	// Each parse is its own: closing one doesn't close it in the defaults.
	parseLayoutPrefs(null).membersColumn.rooms = false;
	expect(defaultLayoutPrefs.membersColumn).toEqual(ALL_OPEN);
});

// The column took the place of #366's pin, which kept the members popover open per kind of chat: a value saved with
// the pin is read past, the rest of it kept.
test("the members popover's pin, saved before the column, is read past", () => {
	for (const saved of [
		'{"membersKeptOpen":{"rooms":true,"groups":true}}',
		'{"membersKeptOpen":{"rooms":false,"groups":false}}',
		'{"membersKeptOpen":true}',
	]) {
		const prefs = parseLayoutPrefs(saved);
		expect(prefs, saved).toEqual(defaultLayoutPrefs);
		expect(Object.keys(prefs), saved).not.toContain("membersKeptOpen");
	}
	expect(parseLayoutPrefs('{"membersKeptOpen":{"rooms":true},"openChats":"vertical"}')).toEqual({
		...defaultLayoutPrefs,
		openChats: "vertical",
	});
});

test("the column's state outlives a reload: the store saves it with the rest of the layout, without the pin", async () => {
	const saved: LayoutPrefs = {
		...defaultLayoutPrefs,
		openChats: "vertical",
		membersColumn: { rooms: false, groups: true },
	};
	localStorage.setItem(LAYOUT_PREFS_KEY, JSON.stringify({ ...saved, membersKeptOpen: { rooms: true, groups: false } }));
	const { layoutPrefs } = await import("$lib/layout-prefs.svelte");
	expect(layoutPrefs).toEqual(saved);
	// What the store saved as it loaded, which the next start reads.
	const stored = localStorage.getItem(LAYOUT_PREFS_KEY);
	expect(parseLayoutPrefs(stored)).toEqual(saved);
	expect(JSON.parse(stored ?? "{}")).toEqual(saved);
});
