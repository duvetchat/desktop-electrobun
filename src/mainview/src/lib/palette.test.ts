import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Every view draws with Duvet's palette: app.css's --duvet-* tokens (bg-duvet-bg, text-duvet-ink, border-duvet-line,
// text-duvet-danger…), which the light theme sets once for all of them. The design before desktop#127 named Tailwind's
// own scales: zinc and stone, the night grays, the fill slates of its gray buttons, white and black, and red, indigo,
// emerald or amber for danger, the accent, success and warnings. Their light values app.css had to turn over by hand,
// one scale at a time.
const src = join(import.meta.dir, "..");
const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
	});
// fun-isometric's stickers are vendored as the kit ships them (lib/stickers), outside the app's palette.
const sources = sourceFiles(src)
	.map((file) => ({ file: relative(src, file).split(sep).join("/"), source: readFileSync(file, "utf8") }))
	.filter((s) => !s.file.startsWith("lib/stickers/"));
const css = readFileSync(join(src, "app.css"), "utf8");

const PROPERTY = String.raw`(?:bg|text|border(?:-[xytblrse])?|divide|ring|ring-offset|outline|from|via|to|fill|stroke|placeholder|caret|accent|decoration|shadow)`;
const OLD_SCALE = new RegExp(String.raw`\b${PROPERTY}-(?:zinc|stone|gray|neutral|slate|night|fill)-[0-9]`, "g");
const HUE = new RegExp(
	String.raw`\b${PROPERTY}-(?:red|rose|pink|fuchsia|purple|violet|indigo|blue|sky|cyan|teal|emerald|green|lime|yellow|amber|orange)-[0-9]`,
	"g",
);
// Black stays for what sits behind media and dialogs (bg-black/60, a gradient over a photo); white is the ink, which
// turns over in light, or fixed-white on a color.
const WHITE_OR_BLACK = new RegExp(
	String.raw`\b(?:text|bg|border(?:-[xytblrse])?|divide|ring|outline|fill|stroke|placeholder|caret|decoration)-white\b|\b(?:text|border(?:-[xytblrse])?|divide|ring|outline|fill|stroke|placeholder|caret|decoration)-black\b`,
	"g",
);
// Where Tailwind's hues stay: the call card's green and red buttons (desktop#302) and the sign-in scene's drawing.
const HUES_KEPT = new Set(["lib/components/CallCard.svelte", "lib/components/AuthScene.svelte"]);

const offenders = (pattern: RegExp, skip: Set<string> = new Set()) =>
	sources
		.filter((s) => !skip.has(s.file))
		.flatMap((s) => [...s.source.matchAll(pattern)].map((m) => `${s.file}: ${m[0]}`));

// The class lists a source writes: what's between quotes or backticks, one list each.
const classLists = () =>
	sources.flatMap((s) =>
		[...s.source.matchAll(/(["'`])([^"'`]*)\1/g)].map((m) => ({ file: s.file, classes: (m[2] ?? "").split(/\s+/) })),
	);

test("no view names Tailwind's neutral scales, the night grays or the fill slates", () => {
	expect(offenders(OLD_SCALE)).toEqual([]);
});

test("no view names Tailwind's hues: danger, the accent, success and warnings are Duvet's", () => {
	expect(offenders(HUE, HUES_KEPT)).toEqual([]);
});

test("white is the ink or fixed-white, and black only sits behind media and dialogs", () => {
	expect(offenders(WHITE_OR_BLACK)).toEqual([]);
});

test("no view reads the old scales through their CSS variables either (style attributes, color-mix)", () => {
	expect(offenders(/--color-(?:zinc|stone|gray|neutral|slate|night|fill)-[0-9]/g)).toEqual([]);
});

// The chosen pill turns dark in light, for its own ink: a chosen background under any other text, or none, is a
// near-black block in light. A raised surface, a track or a hover takes an overlay of the ink instead (bg-duvet-ink/10).
test("the chosen color always comes with the chosen ink, in the same state", () => {
	const lonely = classLists().flatMap(({ file, classes }) =>
		classes
			.map((c) => /^(.*?)bg-duvet-chosen(?:\/\d+)?$/.exec(c)?.[1])
			.filter((state): state is string => state !== undefined)
			.filter((state) => !classes.some((c) => c.startsWith(`${state}text-duvet-chosen-ink`)))
			.map((state) => `${file}: ${state}bg-duvet-chosen`),
	);
	expect(lonely).toEqual([]);
});

// outline-none sets Tailwind's --tw-outline-style to none, and focus-visible:outline-2 draws its outline in that style.
test("no class list hides the focus outline it asks for", () => {
	const hidden = classLists()
		.filter(({ classes }) => classes.some((c) => /^focus(?:-visible|-within)?:outline-\d/.test(c)))
		.filter(({ classes }) => classes.includes("outline-none") || classes.includes("outline-hidden"))
		.map(({ file, classes }) => `${file}: ${classes.join(" ")}`);
	expect(hidden).toEqual([]);
});

// An element's whole class attribute, a ternary's branches with the rest: every class it can have at once.
const classAttributes = () =>
	sources.flatMap((s) =>
		[...s.source.matchAll(/\bclass="/g)].map((m) => {
			let end = m.index + m[0].length;
			for (let depth = 0; end < s.source.length && (s.source[end] !== '"' || depth > 0); end++) {
				if (s.source[end] === "{") depth++;
				else if (s.source[end] === "}") depth--;
			}
			const attribute = s.source.slice(m.index + m[0].length, end);
			return { file: s.file, classes: new Set(attribute.match(/[^\s'"{}?:]+/g) ?? []) };
		}),
	);

// The accent and danger are light in dark and dark in light: what's written on them takes the accent's own ink, which
// turns over with them, and white is unreadable on them in dark. A black scrim stays black in light, where the ink turns
// dark: what's written on it stays white.
test("text on a fill keeps its contrast in both themes", () => {
	const unreadable = classAttributes()
		.filter(
			({ classes }) =>
				((classes.has("bg-duvet-accent") || classes.has("bg-duvet-danger")) && classes.has("text-fixed-white")) ||
				([...classes].some((c) => c.startsWith("bg-black/")) &&
					(classes.has("text-duvet-ink") || classes.has("text-duvet-ink2"))),
		)
		.map(({ file, classes }) => `${file}: ${[...classes].join(" ")}`);
	expect(unreadable).toEqual([]);
});

test("the light theme sets Duvet's tokens alone: nothing names the scales it used to turn over", () => {
	const light = /\.duvet-light \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
	expect(light).toContain("--duvet-bg:");
	expect(light.match(/^\s*--[a-z0-9-]+:/gm)?.filter((v) => !v.trim().startsWith("--duvet-")) ?? []).toEqual([]);
});

// The tokens' values are the palette's one list of colors; shadows keep their black and white.
test("app.css colors only through Duvet's tokens", () => {
	const outsideTokens = css
		.replace(/:root \{[\s\S]*?\n\}/, "")
		.replace(/\.duvet-light \{[\s\S]*?\n\}/, "")
		.replace(/@theme static \{[\s\S]*?\n\}/, "")
		.replace(/\/\*[\s\S]*?\*\//g, "");
	const literals = outsideTokens.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\([^)]*\)|\bskyblue\b/gi) ?? [];
	expect(literals.filter((c) => !/^rgba\((?:0, 0, 0|255, 255, 255), [0-9.]+\)$/.test(c))).toEqual([]);
});
