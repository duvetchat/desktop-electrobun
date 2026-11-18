import { describe, expect, test } from "bun:test";
import {
	afterTiles,
	AUTO,
	gridColumns,
	pressTile,
	stagedKey,
	type StageChoice,
	type StageTile,
} from "$lib/voice-stage";

// The stage of a voice room's or a call's view (#357): a screen share takes it, a press puts a tile on it, and a press
// on the tile that is there gives the grid back.
const ana: StageTile = { key: "ana", kind: "person" };
const leo: StageTile = { key: "leo", kind: "person" };
const leoScreen: StageTile = { key: "leo:screen", kind: "screen" };
const anaScreen: StageTile = { key: "ana:screen", kind: "screen" };
const grid: StageChoice = { kind: "grid" };
const tile = (key: string): StageChoice => ({ kind: "tile", key });

describe("the stage", () => {
	test("is empty with no screen share: the tiles are a grid", () => {
		expect(stagedKey([ana, leo], AUTO)).toBeNull();
		expect(stagedKey([], AUTO)).toBeNull();
	});

	test("is taken by a screen share, the first when there are several", () => {
		expect(stagedKey([ana, leo, leoScreen], AUTO)).toBe("leo:screen");
		expect(stagedKey([ana, anaScreen, leo, leoScreen], AUTO)).toBe("ana:screen");
	});

	test("shows the tile the user chose, a person's too, over a screen share", () => {
		expect(stagedKey([ana, leo, leoScreen], tile("ana"))).toBe("ana");
	});

	test("is the grid when the user chose it, even with a screen share", () => {
		expect(stagedKey([ana, leo, leoScreen], grid)).toBeNull();
	});

	test("a chosen tile that is gone leaves the stage to a screen share, else to the grid", () => {
		expect(stagedKey([leo, leoScreen], tile("ana"))).toBe("leo:screen");
		expect(stagedKey([leo], tile("ana"))).toBeNull();
	});
});

describe("a press on a tile", () => {
	test("puts it on the stage", () => {
		expect(pressTile([ana, leo], AUTO, "ana")).toEqual(tile("ana"));
		expect(pressTile([ana, leo, leoScreen], AUTO, "ana")).toEqual(tile("ana"));
		expect(pressTile([ana, leo], tile("ana"), "leo")).toEqual(tile("leo"));
	});

	test("on the tile that is there gives the grid back", () => {
		expect(pressTile([ana, leo], tile("ana"), "ana")).toEqual(grid);
		// A screen share that took the stage by itself, too.
		expect(pressTile([ana, leo, leoScreen], AUTO, "leo:screen")).toEqual(grid);
	});

	test("from the grid the user chose, puts a tile on the stage again", () => {
		expect(pressTile([ana, leo, leoScreen], grid, "leo:screen")).toEqual(tile("leo:screen"));
	});
});

describe("when the tiles change", () => {
	test("a chosen tile that is gone is forgotten: a later share takes the stage by itself", () => {
		expect(afterTiles(tile("ana"), [ana, leo], [leo])).toEqual(AUTO);
		expect(afterTiles(tile("leo:screen"), [leo, leoScreen], [leo])).toEqual(AUTO);
	});

	test("a chosen tile that stays is kept", () => {
		expect(afterTiles(tile("ana"), [ana], [ana, leo, leoScreen])).toEqual(tile("ana"));
	});

	test("a screen share that just started takes the stage from a grid the user chose", () => {
		expect(afterTiles(grid, [ana, leo], [ana, leo, leoScreen])).toEqual(AUTO);
		expect(afterTiles(grid, [ana, leo, leoScreen], [ana, anaScreen, leo, leoScreen])).toEqual(AUTO);
	});

	test("the grid the user chose stays while nothing new is shared", () => {
		expect(afterTiles(grid, [ana, leo, leoScreen], [ana, leoScreen])).toEqual(grid);
		expect(afterTiles(grid, [ana, leo, leoScreen], [ana, leo])).toEqual(grid);
	});

	test("with no choice made, nothing changes", () => {
		expect(afterTiles(AUTO, [ana], [ana, leo, leoScreen])).toEqual(AUTO);
	});
});

describe("the grid", () => {
	test("has one column for a tile alone, two for up to four, three for more", () => {
		expect([0, 1, 2, 3, 4, 5, 6, 9, 25].map(gridColumns)).toEqual([1, 1, 2, 2, 2, 3, 3, 3, 3]);
	});
});
