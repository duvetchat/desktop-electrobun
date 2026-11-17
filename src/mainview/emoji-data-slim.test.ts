import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMOJI_FIELDS, slimEmojiData, slimEmojiJson as transform } from "./emoji-data-slim";

// #318: the emoji dataset's chunk carried all of emoji-datasource's emoji.json, 1.3 MB of images, sheet positions and
// per-platform flags, for the few fields src/lib/emoji-data.ts reads, kept in memory for the session as the chunk's
// source.
const file = join(import.meta.dir, "node_modules/emoji-datasource/emoji.json");
const raw = readFileSync(file, "utf8");

test("keeps each emoji's fields the app reads, and nothing else", () => {
	const full: Record<string, unknown>[] = JSON.parse(raw);
	const slimmed = transform(raw, file);
	const slim: Record<string, unknown>[] = JSON.parse(slimmed?.code ?? "[]");
	expect(slim).toHaveLength(full.length);
	slim.forEach((entry, i) => {
		expect(Object.keys(entry)).toEqual([...EMOJI_FIELDS]);
		for (const field of EMOJI_FIELDS) expect(entry[field]).toEqual(full[i][field]);
	});
	expect(slimmed?.code.length ?? Infinity).toBeLessThan(raw.length / 4);
});

test("takes the file however its path is written, and leaves every other file alone", () => {
	expect(transform(raw, file.replaceAll("\\", "/"))).not.toBeNull();
	expect(transform(raw, file.replaceAll("/", "\\"))).not.toBeNull();
	expect(transform("[]", join(import.meta.dir, "node_modules/emoji-datasource/categories.json"))).toBeNull();
	expect(transform("{}", join(import.meta.dir, "package.json"))).toBeNull();
});

test("the build uses it, before Vite reads JSON", () => {
	expect(slimEmojiData()).toMatchObject({ enforce: "pre", transform });
	expect(readFileSync(join(import.meta.dir, "vite.config.ts"), "utf8")).toMatch(/plugins: \[[^\]]*slimEmojiData\(\)/);
});
