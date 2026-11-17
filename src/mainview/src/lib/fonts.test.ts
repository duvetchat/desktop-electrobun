import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const appCss = readFileSync(join(import.meta.dir, "../app.css"), "utf8");
const fontsDir = join(import.meta.dir, "fonts");

// An @import from the network blocks the stylesheet, so every page's first paint waited on Google (#284).
test("the app's stylesheet loads nothing from the network: its fonts ship with it", () => {
	expect(appCss).not.toMatch(/@import\s+url\(\s*["']?https?:/);
	expect(appCss).not.toContain("fonts.googleapis.com");
	expect(appCss).toContain('@import "./lib/fonts/fonts.css";');
});

test("each font face names a file the app has, Fira Sans' and Fira Mono's", () => {
	const fonts = readFileSync(join(fontsDir, "fonts.css"), "utf8");
	const files = [...fonts.matchAll(/url\("\.\/([^"]+)"\)/g)].map((m) => m[1]);
	expect(files.length).toBeGreaterThan(0);
	expect(files.filter((file) => !existsSync(join(fontsDir, file!)))).toEqual([]);
	expect(fonts).toContain('font-family: "Fira Sans";');
	expect(fonts).toContain('font-family: "Fira Mono";');
	expect(fonts).not.toContain("https:");
});
