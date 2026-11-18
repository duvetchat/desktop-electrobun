import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { tags, type Tag } from "../server-render";

// Which overlay is in front, as drawn (#357): the primitives and the storage dialogs rendered together, each open,
// in the order the app opens them. bits-ui's portal draws nothing on the server, so one that draws in place stands in.
const { default: PortalInPlace } = await import("./test-fixtures/PortalInPlace.svelte");
const portal = join(import.meta.dir, "../../../../node_modules/bits-ui/dist/bits/utilities/portal/portal.svelte");
mock.module(portal, () => ({ default: PortalInPlace }));
const { default: OverlayStack } = await import("./test-fixtures/OverlayStack.svelte");

const layerOf = (tag: Tag | undefined) => Number(/z-index:\s*(\d+)/.exec(tag?.attributes.style ?? "")?.[1] ?? NaN);
/** The element that carries the layer of the overlay whose panel matches: the panel, or the holder around it. */
function layer(all: Tag[], panel: (tag: Tag) => boolean): number {
	const at = all.findIndex(panel);
	expect(at).toBeGreaterThanOrEqual(0);
	const own = layerOf(all[at]);
	if (!Number.isNaN(own)) return own;
	for (let i = at - 1; i >= 0; i--) {
		const held = layerOf(all[i]);
		if (!Number.isNaN(held)) return held;
	}
	return NaN;
}
const labelled = (name: string) => (tag: Tag) => tag.attributes["aria-label"] === name;
const titled = (all: Tag[], role: string, nth: number) => {
	const found = all.filter((tag) => tag.attributes.role === role && !tag.attributes["aria-label"]);
	return (tag: Tag) => tag === found[nth];
};

describe("overlays opened one from another", () => {
	test("a sheet opened from a popover draws above it, its menu above the sheet, and a dialog above them all", async () => {
		const all = await tags(OverlayStack, {});
		const popover = layer(all, labelled("Profile"));
		const sheet = layer(all, titled(all, "dialog", 0));
		const menu = layer(all, labelled("Length"));
		const dialog = layer(all, titled(all, "alertdialog", 0));
		expect(popover).toBeGreaterThanOrEqual(900);
		expect(sheet).toBeGreaterThan(popover);
		expect(menu).toBeGreaterThan(sheet);
		expect(dialog).toBeGreaterThan(menu);
	});

	test("a sheet's scrim is on the sheet's layer, so it covers what opened the sheet", async () => {
		const all = await tags(OverlayStack, {});
		const sheetAt = all.findIndex(titled(all, "dialog", 0));
		const scrim = all
			.slice(0, sheetAt)
			.reverse()
			.find((tag) => (tag.attributes.class ?? "").includes("bg-duvet-scrim"));
		expect(layerOf(scrim)).toBe(layerOf(all[sheetAt]));
		expect(layerOf(scrim)).toBeGreaterThan(layer(all, labelled("Profile")));
	});

	test("a storage dialog that arrives while a sheet and a dialog are open is in front of both", async () => {
		const all = await tags(OverlayStack, { storage: true });
		const dialog = layer(all, titled(all, "alertdialog", 0));
		const storage = layer(all, titled(all, "alertdialog", 1));
		expect(storage).toBeGreaterThan(dialog);
		expect(storage).toBeGreaterThan(layer(all, titled(all, "dialog", 0)));
	});
});
