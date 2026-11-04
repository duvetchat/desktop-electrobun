import { describe, expect, test } from "bun:test";
import { inlineActivityImage, resolveActivityIcon } from "./activity-icons";

const PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SVG = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')}`;
const fallback = resolveActivityIcon(undefined);

describe("resolveActivityIcon", () => {
	test("draws the inline images the gateway keeps, as they are", () => {
		for (const image of [
			PNG,
			SVG,
			"data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E",
			"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E",
			"data:image/jpeg;base64,/9j/4AAQ",
			"data:image/gif;base64,R0lGODlhAQABAAAAACw=",
			"data:image/webp;base64,UklGRhoAAABXRUJQ",
			// The gateway reads the type in any case.
			"data:image/PNG;base64,iVBORw0KGgo=",
		]) {
			expect(resolveActivityIcon(image)).toBe(image);
		}
	});

	test("draws a URL as the fallback, which loads nothing: a URL's host would learn the viewer's IP", () => {
		for (const url of [
			"https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/lol_icon.png",
			"http://example.com/cover.jpg",
			"//example.com/cover.jpg",
			"/attachments/0193a0b2-0000-7000-8000-000000000000",
			"HTTPS://example.com/cover.jpg",
		]) {
			expect(resolveActivityIcon(url)).toBe(fallback);
		}
		expect(fallback.startsWith("data:image/svg+xml,")).toBe(true);
	});

	test("draws anything else that isn't one of those images as the fallback", () => {
		for (const value of [
			"",
			"data:text/html,<script>alert(1)</script>",
			"data:image/bmp;base64,Qk0=",
			"data:image/svg+xmlfoo,x",
			"data:,hello",
			"DATA:image/png;base64,iVBORw0KGgo=",
			"javascript:alert(1)",
			" data:image/png;base64,iVBORw0KGgo=",
			"mp:external/abc",
		]) {
			expect(resolveActivityIcon(value)).toBe(fallback);
		}
	});
});

describe("inlineActivityImage", () => {
	test("gives a small image only when it's inline, so that no badge shows for a URL", () => {
		expect(inlineActivityImage(SVG)).toBe(SVG);
		expect(inlineActivityImage("https://example.com/badge.png")).toBeUndefined();
		expect(inlineActivityImage(undefined)).toBeUndefined();
	});
});
