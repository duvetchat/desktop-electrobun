import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// #153: the components' plain CSS is Tailwind classes now. No component has a <style> block, and the keyframes they
// had are app.css's theme animations (--animate-*), which their animate-* classes name. A Tailwind class can't name a
// component's own keyframes: Svelte renames them, so the members list's typing dots never moved.
const src = join(import.meta.dir, "..");
const svelteFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? svelteFiles(join(dir, entry.name))
			: entry.name.endsWith(".svelte")
				? [join(dir, entry.name)]
				: [],
	);
const components = svelteFiles(src).map((file) => ({
	file: relative(src, file).split(sep).join("/"),
	source: readFileSync(file, "utf8"),
}));

test("no component has a <style> block", () => {
	expect(components.filter((c) => /<style[\s>]/.test(c.source)).map((c) => c.file)).toEqual([]);
});

// The recipes are plain modules whose classes reach the components (ui/recipes.ts, lib/prism.ts,
// lib/message-styles.ts): they name animations too.
const tsFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? tsFiles(join(dir, entry.name))
			: entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts")
				? [join(dir, entry.name)]
				: [],
	);
const modules = tsFiles(src)
	.map((file) => ({ file: relative(src, file).split(sep).join("/"), source: readFileSync(file, "utf8") }))
	.filter((m) => !m.file.startsWith("lib/stickers/"));

// An arbitrary animation names keyframes no theme entry declares, so nothing can check them, or turn them off for
// reduced motion.
test("no component or recipe writes an arbitrary animate-[…]", () => {
	expect([...components, ...modules].filter((c) => /(?<![\w-])animate-\[/.test(c.source)).map((c) => c.file)).toEqual(
		[],
	);
});

test("every animate-* class a component or a recipe names is an animation of app.css's theme, with its keyframes", () => {
	const css = readFileSync(join(src, "app.css"), "utf8");
	// Tailwind's own, which need no theme entry.
	const builtIn = new Set(["spin", "ping", "pulse", "bounce", "none"]);
	const used = new Set(
		[...components, ...modules].flatMap((c) =>
			[...c.source.matchAll(/(?<![\w-])animate-([a-z][a-z-]*)(?=[\s"'`}]|$)/gm)].map((m) => m[1]),
		),
	);
	// A recipe's too.
	expect(used).toContain("prism-arrive");
	expect(used).toContain("member-typing-bounce");
	expect(used).toContain("auth-drift");
	for (const name of used) {
		if (builtIn.has(name!)) continue;
		const keyframes = new RegExp(`--animate-${name}:\\s*([a-z-]+)\\s`).exec(css)?.[1];
		expect(keyframes, `--animate-${name}`).toBeDefined();
		expect(css).toContain(`@keyframes ${keyframes} {`);
	}
	expect(css).toMatch(/--animate-member-typing-bounce: member-typing-bounce 1\.2s ease-in-out infinite;/);
	expect(css).toMatch(/@keyframes member-typing-bounce \{[^@]*translateY\(-2px\)/);
	expect(css).toMatch(/--animate-auth-drift: auth-drift 18s ease-in-out infinite alternate;/);
	expect(css).toMatch(/@keyframes auth-drift \{\s*to \{\s*transform: translateY\(-24px\);/);
});
