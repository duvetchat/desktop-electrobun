import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const appCss = readFileSync(join(import.meta.dir, "../app.css"), "utf8");
const fontsDir = join(import.meta.dir, "fonts");

// An @import from the network blocks the stylesheet, so every page's first paint waited on Google (#284).
test("the app's stylesheet loads nothing from the network: its fonts ship with it", () => {
	expect(appCss).not.toMatch(/@import\s+url\(\s*["']?https?:/);
	expect(appCss).not.toContain("fonts.googleapis.com");
	expect(appCss).toContain('@import "./lib/fonts/fonts.css";');
});

const fonts = readFileSync(join(fontsDir, "fonts.css"), "utf8");
// Each rule's declarations on one line each, however the formatter wrapped a long unicode-range.
const faces = [...fonts.matchAll(/@font-face \{([^}]*)\}/g)].map((m) =>
	m[1]!.replace(/:\s+/g, ": ").replace(/,\s+/g, ", "),
);
const facesOf = (family: string) => faces.filter((face) => face.includes(`font-family: "${family}";`));

// The redesign's faces (#357): Inter, Roboto, Fraunces and Twemoji from the design system's files, and Fira Mono, which
// the app had. Fira Sans, the interface's face until then, is gone.
test("each font face names a file the app has: Inter's, Roboto's, Fraunces', Twemoji's and Fira Mono's", () => {
	const files = [...fonts.matchAll(/url\("\.\/([^"]+)"\)/g)].map((m) => m[1]);
	expect(files.length).toBeGreaterThan(0);
	expect(files.filter((file) => !existsSync(join(fontsDir, file!)))).toEqual([]);
	for (const family of ["Inter", "Roboto", "Fraunces", "Twemoji", "Fira Mono"])
		expect(facesOf(family).length, family).toBeGreaterThan(0);
	expect(fonts).not.toContain("Fira Sans");
	expect(fonts).not.toContain("https:");
});

test("every font file the app ships is one a face names", () => {
	const named = new Set([...fonts.matchAll(/url\("\.\/([^"]+)"\)/g)].map((m) => m[1]));
	expect(
		readdirSync(fontsDir)
			.filter((file) => file.endsWith(".woff2"))
			.filter((file) => !named.has(file)),
	).toEqual([]);
});

test("each face comes with its license", () => {
	for (const license of [
		"Inter-OFL.txt",
		"Roboto-OFL.txt",
		"Fraunces-OFL.txt",
		"OFL-FiraMono.txt",
		"Twemoji-LICENSE.md",
	])
		expect(existsSync(join(fontsDir, license)), license).toBe(true);
});

// The app's choice over the design's `block`: text shows in a fallback at once, and no face holds the first paint.
test("no face holds text back: each one swaps in", () => {
	expect(faces.filter((face) => !face.includes("font-display: swap;"))).toEqual([]);
});

test("the weights the design uses are there: Inter 400 to 700, Roboto 400, 500 and 700, Fraunces as one variable face", () => {
	const weights = (family: string) =>
		[...new Set(facesOf(family).map((face) => /font-weight: ([^;]+);/.exec(face)?.[1]))].sort((a, b) =>
			String(a).localeCompare(String(b)),
		);
	expect(weights("Inter")).toEqual(["400", "500", "600", "700"]);
	expect(weights("Roboto")).toEqual(["400", "500", "700"]);
	expect(weights("Fraunces")).toEqual(["100 900"]);
});

// Twemoji after a face in a stack must only answer for emoji, or it would draw digits, # and * too.
test("Twemoji is asked for emoji alone, by its unicode-range", () => {
	const [twemoji] = facesOf("Twemoji");
	expect(facesOf("Twemoji")).toHaveLength(1);
	expect(twemoji).toContain("unicode-range: U+00A9, U+00AE, U+203C,");
	expect(twemoji).toContain("U+1F000-1FAFF");
	expect(twemoji).not.toMatch(/U\+00(2|3)[0-9A-F]\b/);
});

test("the theme names the four faces, with Fraunces' axes set", () => {
	expect(appCss).toContain('--font-sans: "Inter", "Twemoji",');
	expect(appCss).toContain('--font-content: "Roboto", "Twemoji",');
	expect(appCss).toContain('--font-mono: "Fira Mono",');
	expect(appCss).toContain('--font-serif: "Fraunces", Georgia, serif;');
	expect(appCss).toContain('--font-serif--font-variation-settings: "opsz" 36, "SOFT" 50, "WONK" 0;');
	expect(appCss).toContain('--font-serif-sm--font-variation-settings: "opsz" 24, "SOFT" 50, "WONK" 0;');
	expect(appCss).toContain('--font-serif-lg--font-variation-settings: "opsz" 72, "SOFT" 50, "WONK" 0;');
	expect(appCss).not.toContain("Fira Sans");
});
