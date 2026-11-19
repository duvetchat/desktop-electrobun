import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The design system's tokens (#357, docs/redesign/DESIGN-MAP.md §1): app.css's --duvet-* custom properties, dark in
// :root and light in .duvet-light, and the Tailwind theme entries that make classes of them.
const css = readFileSync(join(import.meta.dir, "../app.css"), "utf8");
const block = (pattern: RegExp) => pattern.exec(css)?.[1] ?? "";
const declarations = (source: string) =>
	new Map([...source.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1]!, m[2]!.replace(/\s+/g, " ")]));

const dark = declarations(block(/:root \{([\s\S]*?)\n\}/));
const light = declarations(block(/\.duvet-light \{([\s\S]*?)\n\}/));
const theme = declarations(block(/@theme inline \{([\s\S]*?)\n\t@keyframes/));

describe("the palette", () => {
	test("has the design's base, accent and live colors in dark and in light", () => {
		const both = (name: string) => [dark.get(name), light.get(name) ?? dark.get(name)];
		expect(both("--duvet-bg")).toEqual(["#07070a", "#f5f7ff"]);
		expect(both("--duvet-ink")).toEqual(["#f1f1f6", "#15172b"]);
		expect(both("--duvet-ink2")).toEqual(["#9396a8", "#5e6380"]);
		expect(both("--duvet-sunk")).toEqual(["#000000", "#eaefff"]);
		expect(both("--duvet-card")).toEqual(["#111116", "#ffffff"]);
		expect(both("--duvet-danger")).toEqual(["#e07a70", "#b0443b"]);
		expect(both("--duvet-accent-text")).toEqual(["#8c9bff", "#2f4cff"]);
		expect(both("--duvet-chosen")).toEqual(["#231e3d", "#f0edff"]);
		expect(both("--duvet-chosen-ink")).toEqual(["#b3a6ff", "#6a58d6"]);
		expect(both("--duvet-alive")).toEqual(["#4cc38a", "#2f9e62"]);
		// Cobalt, azure and white on them are the same in both.
		expect(both("--duvet-accent")).toEqual(["#2f4cff", "#2f4cff"]);
		expect(both("--duvet-azure")).toEqual(["#0b6fe8", "#0b6fe8"]);
		expect(both("--duvet-on-accent")).toEqual(["#ffffff", "#ffffff"]);
	});

	test("keeps the app's own warning color, which the design doesn't set", () => {
		expect(dark.get("--duvet-warn")).toBe("#f0c47a");
		expect(light.get("--duvet-warn")).toBe("#9a5f0a");
	});

	test("the light theme sets no token the dark one doesn't have", () => {
		expect([...light.keys()].filter((name) => !dark.has(name))).toEqual([]);
	});

	// A color written in one theme only would stay dark's in light: each of these turns over.
	test("every surface, ink, fill and shadow has a light value of its own", () => {
		const same = new Set([
			"--app-height",
			"--app-width",
			"--duvet-accent",
			"--duvet-on-accent",
			// One dark ink on the green and on the call red, in both themes (contrast.test.ts).
			"--duvet-on-alive",
			"--duvet-on-call-red",
			"--duvet-azure",
			"--duvet-tip-ink",
			"--duvet-sb-filter",
			"--duvet-media-ink",
			"--duvet-media-scrim",
			"--duvet-call-red",
			"--duvet-call-red-ink",
			"--duvet-call-red-tint",
			"--duvet-stage",
			"--duvet-viewer",
			"--duvet-tl-close",
			"--duvet-tl-minimize",
			"--duvet-tl-zoom",
			"--duvet-win-close",
			"--duvet-pad-x",
		]);
		expect([...dark.keys()].filter((name) => !same.has(name) && !light.has(name))).toEqual([]);
	});

	test("each theme tells the browser which it is, for its own controls and scrollbars", () => {
		expect(block(/:root \{([\s\S]*?)\n\}/)).toMatch(/^\s*color-scheme: dark;/m);
		expect(block(/\.duvet-light \{([\s\S]*?)\n\}/)).toMatch(/^\s*color-scheme: light;/m);
	});

	// The solid tint, everywhere but where the sidebar is glass: there its column takes the vibrant values (#374,
	// lib/vibrancy.test.ts).
	test("the sidebar's material is the solid tint, without a blur", () => {
		expect(dark.get("--duvet-sb-bg")).toBe("#0d0d12");
		expect(light.get("--duvet-sb-bg")).toBe("#edf1ff");
		expect(dark.get("--duvet-sb-filter")).toBe("none");
		expect(light.has("--duvet-sb-filter")).toBe(false);
	});

	// DESIGN-MAP.md §1.1: macOS's --sb-bg, --sb-filter and --sb-ring.
	test("the glass sidebar's tint, blur and ring are the design's, in dark and in light", () => {
		expect(dark.get("--duvet-sb-bg-vibrant")).toBe("rgba(26, 26, 34, 0.76)");
		expect(light.get("--duvet-sb-bg-vibrant")).toBe("rgba(236, 240, 253, 0.8)");
		expect(dark.get("--duvet-sb-filter-vibrant")).toBe("blur(48px) saturate(1.4)");
		expect(light.get("--duvet-sb-filter-vibrant")).toBe("blur(48px) saturate(1.5)");
		expect(dark.get("--duvet-sb-ring-vibrant")).toBe("#16161e");
		expect(light.get("--duvet-sb-ring-vibrant")).toBe("#e8ecfb");
	});
});

describe("the Tailwind theme", () => {
	test("every color and shadow class reads a token that exists", () => {
		const missing = [...theme]
			.filter(([name]) => name.startsWith("--color-duvet-") || name.startsWith("--shadow-duvet-"))
			.flatMap(([name, value]) =>
				[...value.matchAll(/var\((--duvet-[a-z0-9-]+)\)/g)]
					.filter((m) => !dark.has(m[1]!))
					.map((m) => `${name}: ${m[1]}`),
			);
		expect(missing).toEqual([]);
	});

	test("every color token has its class", () => {
		const notColors = /^--duvet-(shadow-|prism-shadow$|sb-filter|sb-bg-|sb-ring-|pad-x$)/;
		const classless = [...dark.keys()]
			.filter((name) => name.startsWith("--duvet-") && !notColors.test(name))
			.filter((name) => theme.get(name.replace("--duvet-", "--color-duvet-")) !== `var(${name})`);
		expect(classless).toEqual([]);
	});

	test("has motion's three curves", () => {
		expect(theme.get("--ease-spring")).toBe("cubic-bezier(0.3, 1.18, 0.5, 1)");
		expect(theme.get("--ease-overshoot")).toBe("cubic-bezier(0.34, 1.12, 0.64, 1)");
		expect(theme.get("--ease-decelerate")).toBe("cubic-bezier(0.2, 0.9, 0.3, 1)");
	});
});
