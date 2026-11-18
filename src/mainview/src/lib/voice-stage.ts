// What a voice room's or a call's view puts on its stage (#357, BRIEF.md "Calls"): a screen share takes it, with
// everyone in a strip under it; without one the tiles are a grid that fills the pane. A press on a tile puts it on the
// stage (the app's "focus"), and a press on the tile that is there gives the grid back.

/** A tile of the view: someone, or the screen they share. */
export interface StageTile {
	key: string;
	kind: "person" | "screen";
}

/** What the user chose: nothing yet (a screen share takes the stage by itself), the grid, or a tile. */
export type StageChoice = { kind: "auto" } | { kind: "grid" } | { kind: "tile"; key: string };

export const AUTO: StageChoice = { kind: "auto" };

/** The tile on the stage, or null for the grid. A chosen tile that is gone (its person left, or stopped sharing) leaves
 * the choice to the view again. */
export function stagedKey(tiles: readonly StageTile[], choice: StageChoice): string | null {
	if (choice.kind === "grid") return null;
	if (choice.kind === "tile" && tiles.some((tile) => tile.key === choice.key)) return choice.key;
	return tiles.find((tile) => tile.kind === "screen")?.key ?? null;
}

/** The choice after a press on a tile: the tile on the stage goes back to the grid, any other takes the stage. */
export function pressTile(tiles: readonly StageTile[], choice: StageChoice, key: string): StageChoice {
	return stagedKey(tiles, choice) === key ? { kind: "grid" } : { kind: "tile", key };
}

/** The choice once the tiles changed: a screen share that just started takes the stage from a grid the user chose
 * (they chose it over the shares there were), and a chosen tile that is gone is forgotten. */
export function afterTiles(choice: StageChoice, before: readonly StageTile[], now: readonly StageTile[]): StageChoice {
	if (choice.kind === "tile") return now.some((tile) => tile.key === choice.key) ? choice : AUTO;
	if (choice.kind === "grid") {
		const had = new Set(before.filter((tile) => tile.kind === "screen").map((tile) => tile.key));
		return now.some((tile) => tile.kind === "screen" && !had.has(tile.key)) ? AUTO : choice;
	}
	return choice;
}

/** The grid's columns: one for a tile alone, two for up to four, three for more. Its rows share the height. */
export function gridColumns(count: number): 1 | 2 | 3 {
	if (count <= 1) return 1;
	return count <= 4 ? 2 : 3;
}
