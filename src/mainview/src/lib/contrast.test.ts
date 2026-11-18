import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Text contrast (#357, WCAG 2.1 AA): every ink the app writes with, against every surface it writes on, computed from
// app.css's tokens in the dark and in the light theme. 4.5:1 for text, 3:1 for glyphs, dots and other graphics
// (1.4.11). A translucent token is laid over the surface it sits on first.
const src = join(import.meta.dir, "..");
const css = readFileSync(join(src, "app.css"), "utf8");
const block = (pattern: RegExp) => pattern.exec(css)?.[1] ?? "";
const tokens = (source: string) =>
	new Map([...source.matchAll(/^\s*--duvet-([a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1]!, m[2]!.trim()]));
const dark = tokens(block(/:root \{([\s\S]*?)\n\}/));
const light = new Map([...dark, ...tokens(block(/\.duvet-light \{([\s\S]*?)\n\}/))]);

type Color = [red: number, green: number, blue: number, alpha: number];

function parse(value: string): Color {
	if (value.startsWith("#")) {
		const hex = value.slice(1);
		return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1];
	}
	const parts = /rgba?\(([^)]+)\)/
		.exec(value)?.[1]
		?.split(",")
		.map((part) => parseFloat(part));
	if (!parts || parts.length < 3) throw new Error(`Not a color: ${value}`);
	return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
}

const mix = (top: number, under: number, alpha: number) => top * alpha + under * (1 - alpha);
const over = (top: Color, under: Color): Color => [
	mix(top[0], under[0], top[3]),
	mix(top[1], under[1], top[3]),
	mix(top[2], under[2], top[3]),
	1,
];

function luminance(color: Color): number {
	const linear = (channel: number) => {
		const c = channel / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
}

function ratio(a: Color, b: Color): number {
	const [la, lb] = [luminance(a), luminance(b)];
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Theme = Map<string, string>;

/** A color as the tests name it: a token ("ink2"), a token at an opacity ("alive/20"), "white", and layers from the
 * top down ("hover>card": the hover fill over a card). */
function resolve(theme: Theme, spec: string): Color {
	const layers = spec.split(">").map((layer): Color => {
		const [name = "", alpha] = layer.split("/");
		const value = name === "white" ? "#ffffff" : name === "black" ? "#000000" : theme.get(name);
		if (!value) throw new Error(`No token --duvet-${name}`);
		const color = parse(value);
		return alpha ? [color[0], color[1], color[2], (color[3] * Number(alpha)) / 100] : color;
	});
	return layers.reduceRight((under, top) => over(top, under));
}

const contrast = (theme: Theme, ink: string, surface: string) =>
	ratio(resolve(theme, `${ink}>${surface}`), resolve(theme, surface));

/** The pairs under `least`, each as "theme: ink on surface = ratio". */
function failing(pairs: [ink: string, surfaces: string[]][], least: number): string[] {
	return Object.entries({ dark, light }).flatMap(([name, theme]) =>
		pairs.flatMap(([ink, surfaces]) =>
			surfaces
				.map((surface) => ({ surface, is: contrast(theme, ink, surface) }))
				.filter(({ is }) => is < least)
				.map(({ surface, is }) => `${name}: ${ink} on ${surface} = ${is.toFixed(2)}`),
		),
	);
}

const NEUTRAL = [
	"bg",
	"sunk",
	"card",
	"sb-bg",
	"secondary-fill",
	"chosen",
	"hover>bg",
	"hover>card",
	"hover-strong>card",
	"sb-hover>sb-bg",
	"seg-track",
	"seg-thumb",
	"pill",
	"code-bg",
	"accent-tint>card",
	"accent-tint>bg",
	"glass>bg",
	"glass-strong>bg",
	"field>card",
	"field>bg",
	"sb-field>sb-bg",
	"sb-card>sb-bg",
	"card-soft>bg",
	"kbd>card",
];

describe("text contrast", () => {
	test("the two inks pass on every neutral surface", () => {
		expect(
			failing(
				[
					["ink", NEUTRAL],
					["ink2", NEUTRAL],
				],
				4.5,
			),
		).toEqual([]);
	});

	test("the colored inks pass on the surfaces they are written on", () => {
		expect(
			failing(
				[
					["accent-text", ["bg", "card", "sb-bg", "sunk", "secondary-fill", "glass>bg", "hover>card"]],
					["accent-text", ["accent-tint>card", "accent-tint>bg"]],
					["danger", ["bg", "card", "sb-bg", "sunk", "secondary-fill", "glass>bg", "hover>card"]],
					["danger", ["danger/15>card", "danger/10>card", "danger/10>bg", "danger/10>glass-strong>bg"]],
					["warn", ["bg", "card", "sb-bg", "glass>bg"]],
					["chosen-ink", ["chosen", "card", "bg"]],
					// A mention's violet in a bubble Prism lights: on the card, and on the light where it is strongest.
					["mention-lit", ["card", "prism-gem>card", "prism-gem>bg"]],
					["tip-ink", ["tip-bg"]],
					["media-ink", ["stage", "media-scrim>black"]],
					["call-red-ink", ["call-red-tint>stage"]],
				],
				4.5,
			),
		).toEqual([]);
	});

	// Green as text: the call strip over a conversation (on sunk, and hovered), a chat's "in a call" line and a
	// connected room in the sidebar, a toast's and a form's confirmation, the palette's line, and the tags and tiles
	// on the green's own tint ("Active", "Connected", the ping's mark).
	test("green text passes on its surfaces, and on its own tint", () => {
		const surfaces = [
			"bg",
			"card",
			"sb-bg",
			"sunk",
			"hover>sunk",
			"secondary-fill",
			"glass>bg",
			"glass-strong>bg",
			"sb-hover>sb-bg",
			"sb-card>sb-bg",
			"alive/20>card",
			"alive/15>card",
			"alive/15>glass-strong>bg",
			"alive/14>bg",
			"alive/14>sb-bg",
			"alive/14>sb-card>sb-bg",
			"alive/10>card",
			"alive/10>bg",
		];
		expect(failing([["alive-text", surfaces]], 4.5)).toEqual([]);
	});

	test("what is written on a fill passes on it", () => {
		expect(
			failing(
				[
					["on-accent", ["accent", "azure"]],
					["on-danger", ["danger"]],
					// Join, a bot's Success button, Accept's glyph.
					["on-alive", ["alive"]],
					// The Live pill.
					["on-call-red", ["call-red"]],
				],
				4.5,
			),
		).toEqual([]);
	});

	test("glyphs, dots and marks reach 3:1", () => {
		expect(
			failing(
				[
					// The call buttons' glyphs, and Windows' Close.
					["white", ["call-red", "win-close"]],
					// Presence dots, the voice mark, a progress bar.
					["alive", ["bg", "card", "sb-bg"]],
					["crown", ["bg", "card", "sb-bg", "glass>bg"]],
				],
				3,
			),
		).toEqual([]);
	});

	// Why the text tokens exist: the design's green and red as they were written before. A token "simplified" back to
	// its fill's value, or white put back on a fill, fails above; these say which pairs those were.
	test("the fills' own colors don't pass as text, nor white on them", () => {
		expect(contrast(light, "alive", "sunk")).toBeLessThan(4.5);
		expect(contrast(dark, "white", "alive")).toBeLessThan(3);
		expect(contrast(light, "white", "alive")).toBeLessThan(4.5);
		expect(contrast(dark, "white", "call-red")).toBeLessThan(4.5);
	});
});

// The classes that would put a failing pair back.
const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
	});
const lines = sourceFiles(src)
	.map((file) => ({ file: relative(src, file).split(sep).join("/"), source: readFileSync(file, "utf8") }))
	.filter(({ file }) => !file.startsWith("lib/stickers/"))
	.flatMap(({ file, source }) => source.split("\n").map((text, i) => ({ at: `${file}:${i + 1}`, text })));
const where = (matches: (text: string) => boolean) => lines.filter(({ text }) => matches(text)).map(({ at }) => at);
/** The text colors a line of classes sets at rest (not on hover or another variant). */
const inks = (text: string) => [...text.matchAll(/(?<![\w:-])text-((?:duvet|fixed)-[a-z0-9-]+)/g)].map((m) => m[1]!);
const fill = (name: string) => new RegExp(`(?<![\\w:-])bg-duvet-${name}(?![\\w/-])`);

describe("the classes", () => {
	test("write in green with its text color, never the fill's", () => {
		expect(where((text) => /(?<![\w-])text-duvet-alive(?![\w-])/.test(text))).toEqual([]);
		expect(css).not.toMatch(/(?<!-)color: var\(--duvet-alive\)/);
	});

	test("write on a green or a danger fill with that fill's own ink", () => {
		const on = (name: string, ink: string) =>
			where((text) => fill(name).test(text) && inks(text).some((is) => is !== ink));
		expect(on("alive", "duvet-on-alive")).toEqual([]);
		expect(on("danger", "duvet-on-danger")).toEqual([]);
	});

	test("write the Live pill, the call red's only words, in that red's own ink", () => {
		expect(where((text) => fill("call-red").test(text) && /\buppercase\b/.test(text))).not.toEqual([]);
		expect(
			where(
				(text) =>
					fill("call-red").test(text) && /\buppercase\b/.test(text) && !inks(text).includes("duvet-on-call-red"),
			),
		).toEqual([]);
	});

	test("never fade the second ink, which is near its limit as it is", () => {
		expect(where((text) => /text-duvet-ink2\/\d/.test(text))).toEqual([]);
	});
});
