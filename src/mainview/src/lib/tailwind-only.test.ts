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

test("every animate-* class a component names is an animation of app.css's theme, with its keyframes", () => {
	const css = readFileSync(join(src, "app.css"), "utf8");
	// Tailwind's own, which need no theme entry.
	const builtIn = new Set(["spin", "ping", "pulse", "bounce", "none"]);
	const used = new Set(components.flatMap((c) => [...c.source.matchAll(/\banimate-([a-z][a-z-]*)/g)].map((m) => m[1])));
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
