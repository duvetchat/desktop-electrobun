import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const nav = readFileSync(join(import.meta.dir, "SpaceNav.svelte"), "utf8");

// The Now section's cards (a call to join, a friend request) sit at the column's foot, right above its bottom block, and
// never float under a short list of rows: the rows' scroller grows into the room the column has left.
test("the rows' scroller grows, so the Now section sits at the column's foot", () => {
	const scroller =
		/<div class="([^"]*\boverflow-y-auto\b[^"]*)">\s*<div class="[^"]*" bind:offsetHeight=\{rowsHeight\}>/.exec(
			nav,
		)?.[1];
	expect(scroller?.split(/\s+/)).toContain("flex-1");
});
