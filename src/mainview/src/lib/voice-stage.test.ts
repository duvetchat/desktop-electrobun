import { describe, expect, test } from "bun:test";
import {
	afterTiles,
	AUTO,
	eyesToward,
	gridColumns,
	pressTile,
	stagedKey,
	tilePlaces,
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

// The faces look toward whoever speaks, by where the tiles sit: the grid's cells, or the stage's, where the staged tile
// is above the strip's middle and the others along the strip. So with a screen on the stage, or anyone, the faces keep
// looking at the speaker (#440).
describe("the faces' eyes", () => {
	const mia: StageTile = { key: "mia", kind: "person" };

	test("in the grid, look toward the speaker's cell", () => {
		const places = tilePlaces([ana, leo, mia], null, 2);
		expect(places).toEqual({ ana: { x: 0, y: 0 }, leo: { x: 1, y: 0 }, mia: { x: 0, y: 1 } });
		const eyes = eyesToward([ana, leo, mia], places, "mia");
		expect(eyes.ana).toEqual({ x: 0, y: 1 });
		expect(eyes.leo?.x).toBeCloseTo(-Math.SQRT1_2);
		expect(eyes.leo?.y).toBeCloseTo(Math.SQRT1_2);
		expect(eyes.mia).toEqual({ x: 0, y: 0 });
	});

	test("with a screen on the stage, the strip's faces look along it at the speaker", () => {
		const tiles = [ana, leo, leoScreen, mia];
		const places = tilePlaces(tiles, "leo:screen", 2);
		expect(places).toEqual({
			"leo:screen": { x: 1, y: -1 },
			ana: { x: 0, y: 0 },
			leo: { x: 1, y: 0 },
			mia: { x: 2, y: 0 },
		});
		expect(eyesToward(tiles, places, "mia")).toEqual({ ana: { x: 1, y: 0 }, leo: { x: 1, y: 0 }, mia: { x: 0, y: 0 } });
		expect(eyesToward(tiles, places, "ana")).toEqual({
			ana: { x: 0, y: 0 },
			leo: { x: -1, y: 0 },
			mia: { x: -1, y: 0 },
		});
	});

	test("with someone on the stage, the strip looks up at them, and they down at a speaker in it", () => {
		const tiles = [ana, leo, mia];
		const places = tilePlaces(tiles, "mia", 2);
		const up = eyesToward(tiles, places, "mia");
		expect(up.ana?.x).toBeCloseTo(0.447, 3);
		expect(up.ana?.y).toBeCloseTo(-0.894, 3);
		expect(up.leo?.x).toBeCloseTo(-0.447, 3);
		const down = eyesToward(tiles, places, "leo");
		expect(down.mia?.x).toBeCloseTo(0.447, 3);
		expect(down.mia?.y).toBeCloseTo(0.894, 3);
	});

	test("look straight ahead in silence", () => {
		const places = tilePlaces([ana, leo], null, 2);
		expect(eyesToward([ana, leo], places, null)).toEqual({ ana: { x: 0, y: 0 }, leo: { x: 0, y: 0 } });
	});
});
