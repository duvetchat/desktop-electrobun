import { expect, test } from "bun:test";
import { BASE_LAYER, claimLayer, layerStyle, releaseLayer } from "./overlay-layers";

test("what opens last is in front, whatever kind it is", () => {
	const membersPopover = claimLayer();
	const profile = claimLayer();
	const banSheet = claimLayer();
	expect(membersPopover).toBe(BASE_LAYER);
	expect(profile).toBeGreaterThan(membersPopover);
	expect(banSheet).toBeGreaterThan(profile);
	for (const layer of [banSheet, profile, membersPopover]) releaseLayer(layer);
});

test("an overlay opened from a sheet is over the sheet, and one opened later from under it is over both", () => {
	const sheet = claimLayer();
	const select = claimLayer();
	releaseLayer(select);
	// The select closed: the next overlay needs no more than to be over the sheet.
	const next = claimLayer();
	expect(next).toBe(sheet + 1);
	releaseLayer(next);
	releaseLayer(sheet);
});

test("an opener that closes first leaves what it opened in front of everything newer than itself", () => {
	const popover = claimLayer();
	const dialog = claimLayer();
	releaseLayer(popover);
	const toastless = claimLayer();
	expect(toastless).toBeGreaterThan(dialog);
	releaseLayer(toastless);
	releaseLayer(dialog);
});

test("with everything closed the layers start over, far under the notices and toasts", () => {
	for (let i = 0; i < 50; i++) releaseLayer(claimLayer());
	const layer = claimLayer();
	expect(layer).toBe(BASE_LAYER);
	expect(layer).toBeLessThan(9990);
	releaseLayer(layer);
	// A layer given back twice, or never claimed, changes nothing.
	releaseLayer(layer);
	releaseLayer(12345);
	expect(claimLayer()).toBe(BASE_LAYER);
	releaseLayer(BASE_LAYER);
});

test("a closed overlay has no layer to write", () => {
	expect(layerStyle(0)).toBeUndefined();
	expect(layerStyle(903)).toBe("z-index: 903;");
});
