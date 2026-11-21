import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The viewer opens from the chat's page and from Settings' sheet: it must come in front of what opened it, whichever
// it is (lib/overlay-layers.ts), where a fixed z-index would leave it behind the sheet.
const source = readFileSync(join(import.meta.dir, "ImagePreview.svelte"), "utf8");

test("comes in front of what opened it", () => {
	expect(source).toContain("const layer = $derived(open ? claimLayer() : 0);");
	expect(source).toContain("style={layerStyle(layer)}");
	expect(source).toContain("releaseLayer(mine)");
});
