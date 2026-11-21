import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The viewer opens from the chat's page and from Settings' sheet: it must come in front of what opened it, whichever
// it is (lib/overlay-layers.ts), and a fixed z-index alone left it behind the sheet. As a dialog of its own, portaled
// to the body, it also holds the focus and the presses while it is open.
const source = readFileSync(join(import.meta.dir, "ImagePreview.svelte"), "utf8");

test("is a dialog of its own, portaled, in front of what opened it", () => {
	expect(source).toContain("<Dialog.Root bind:open>");
	expect(source).toContain("<Dialog.Portal>");
	expect(source).toContain("const layer = $derived(open ? claimLayer() : 0);");
	expect(source).toContain("style={layerStyle(layer)}");
	expect(source).toContain("releaseLayer(mine)");
});

test("covers the window, not the box that opened it", () => {
	expect(source).toContain("fixed inset-0");
	expect(source).toContain("max-h-[90vh] max-w-[90vw]");
	// The dialog's focus scope and Esc handle the keys now, not a wrapper of the page's.
	expect(source).not.toContain("focusWhileOpen");
	expect(source).not.toContain("wrapTab");
});
