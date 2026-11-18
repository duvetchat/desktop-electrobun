import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { motionMs } from "./motion";

// The app's motion (#357, docs/redesign/DESIGN-MAP.md §1.10): app.css's motion theme block, whose animations are
// variables so that reduced motion can turn them off in one place, and the classes and directives that move things.
const src = join(import.meta.dir, "..");
const css = readFileSync(join(src, "app.css"), "utf8");
const motion = /\n@theme \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
const inline = /\n@theme inline \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
const reducedRule = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
const reduced = /:root \{([\s\S]*?)\}/.exec(reducedRule)?.[1] ?? "";
const declared = (source: string) =>
	new Map([...source.matchAll(/^\s*(--animate-[a-z-]+):\s*([^;]+);/gm)].map((m) => [m[1]!, m[2]!]));
const animations = declared(motion);
// Tailwind's own animations, which its theme declares: the skeletons' pulse, and two nothing uses, turned off with
// the rest so that a first use is covered. Its spinner is not one of them: see "the spinner" below.
const BUILT_IN = ["--animate-pulse", "--animate-ping", "--animate-bounce"];

const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
	});
// fun-isometric's stickers are vendored as the kit ships them (lib/stickers); they check reduced motion themselves.
const sources = sourceFiles(src)
	.map((file) => ({ file: relative(src, file).split(sep).join("/"), source: readFileSync(file, "utf8") }))
	.filter(({ file }) => !file.startsWith("lib/stickers/"));
const lines = sources.flatMap(({ file, source }) =>
	source.split("\n").map((text, i) => ({ at: `${file}:${i + 1}`, text })),
);

const OVERSHOOT = "cubic-bezier(0.34, 1.12, 0.64, 1)";
const DECELERATE = "cubic-bezier(0.2, 0.9, 0.3, 1)";

describe("the redesign's animations", () => {
	test("are there, each with the design's duration and curve", () => {
		expect(Object.fromEntries(animations)).toMatchObject({
			"--animate-pop": `pop 0.28s ${OVERSHOOT}`,
			"--animate-float-in": `float-in 0.28s ${OVERSHOOT}, fade-in 0.16s ease`,
			"--animate-sheet-in": `sheet-in 0.32s ${OVERSHOOT}`,
			"--animate-toast-in": `sheet-in 0.3s ${OVERSHOOT}`,
			"--animate-win-in": `win-in 0.32s ${OVERSHOOT}`,
			"--animate-fade-up": `fade-up 0.25s ${DECELERATE}`,
			"--animate-scrim-in": "fade-in 0.18s ease",
			"--animate-tip-in": "fade-in 0.12s ease",
			"--animate-notice-in": `notice-in 0.45s ${OVERSHOOT}`,
			"--animate-flash": `flash 1.6s ${DECELERATE}`,
			"--animate-prism-arrive": `prism-arrive 0.9s ${DECELERATE} 0.25s both`,
			"--animate-dot": "dot 1.2s infinite",
			"--animate-speak": "speak 1.4s infinite",
			"--animate-ring": "ring 1.2s infinite",
		});
	});

	test("each names keyframes app.css has", () => {
		const missing = [...animations].flatMap(([name, value]) =>
			value
				// Between animations, not inside a curve's parentheses.
				.split(/,(?![^(]*\))/)
				.map((part) => part.trim().split(/\s+/)[0]!)
				.filter((keyframes) => !css.includes(`@keyframes ${keyframes} {`))
				.map((keyframes) => `${name}: ${keyframes}`),
		);
		expect(missing).toEqual([]);
	});

	// What arrives starts from its hidden state and ends as the element is styled: no keyframes of an arrival has a
	// `to`, so nothing is left transformed, and an element whose animation is turned off is simply there.
	test("what arrives ends as it is styled", () => {
		for (const keyframes of ["pop", "float-in", "sheet-in", "win-in", "fade-up", "notice-in"]) {
			const body = new RegExp(`@keyframes ${keyframes} \\{([\\s\\S]*?)\\n\\t\\}`).exec(css)?.[1] ?? "";
			expect(body, keyframes).toContain("from {");
			expect(body, keyframes).not.toMatch(/\bto \{|100% \{/);
		}
	});
});

describe("reduced motion", () => {
	// An animation of the inline theme block is written into its class as it is, where no variable can turn it off:
	// the typing dots bounced for those who asked for no motion.
	test("every animation is a variable of the motion block, none of the inline theme's", () => {
		expect([...declared(inline).keys()]).toEqual([]);
		expect(animations.has("--animate-typing-bounce")).toBe(true);
		expect(animations.has("--animate-member-typing-bounce")).toBe(true);
	});

	test("turns every one of them off, and Tailwind's own", () => {
		const off = declared(reduced);
		expect([...animations.keys(), ...BUILT_IN].filter((name) => !off.has(name))).toEqual([]);
		for (const [name, value] of off) {
			// Prism's light isn't an arrival to skip: unlit, a mention would lose its mark. It's lit at once instead.
			if (name === "--animate-prism-arrive") expect(value).toBe("prism-arrive 0.01ms both");
			else expect(value, name).toBe("none");
		}
	});

	test("turns off nothing that isn't one of them", () => {
		expect([...declared(reduced).keys()].filter((name) => !animations.has(name) && !BUILT_IN.includes(name))).toEqual(
			[],
		);
	});

	test("stills app.css's own transitions", () => {
		const own = [...css.replace(reducedRule, "").matchAll(/\n\t(\.[a-z-]+)[^{}]*\{[^{}]*\btransition:/g)].map(
			(m) => m[1]!,
		);
		expect(own.length).toBeGreaterThan(0);
		for (const selector of own) expect(reducedRule, selector).toContain(selector);
		expect(reducedRule).toMatch(/transition: none;/);
	});
});

describe("the classes", () => {
	const used = (text: string) => [...text.matchAll(/(?<![\w-])animate-(\[|[a-z][a-z-]*)/g)].map((m) => m[1]!);

	// A class can name only what reduced motion turns off: an animation of the motion block, or the skeletons' pulse.
	// An arbitrary animate-[…] has no variable to turn off, and Tailwind's ping and bounce are loops the app has no
	// use for.
	test("name only animations that reduced motion turns off", () => {
		const allowed = new Set([...animations.keys()].map((name) => name.replace("--animate-", "")));
		for (const name of ["none", "pulse", "spin"]) allowed.add(name);
		expect(lines.filter(({ text }) => used(text).some((name) => !allowed.has(name))).map(({ at }) => at)).toEqual([]);
		// The guard sees the recipes too, which are plain modules.
		expect(sources.some(({ file, source }) => file.endsWith(".ts") && used(source).length > 0)).toBe(true);
	});

	// The spinner: the one animation that stays. It says "working" and nothing else does; still, it would say "stuck".
	test("the spinner is the only animation left running, and only on what waits", () => {
		expect(declared(reduced).has("--animate-spin")).toBe(false);
		expect(animations.has("--animate-spin")).toBe(false);
	});

	// Tailwind's transition utilities: transition, transition-colors, transition-[width]… A fade is motion too, and
	// one rule is simpler to keep than a judgment on each.
	test("every transition has its reduced form beside it", () => {
		const moving = /(?<![\w:-])transition(?:-(?!none\b)[a-z]+|-\[[^\]\s]+\])?(?![\w-])(?=[\s"'`}]|$)/;
		const inClasses = (text: string) => /["'`]/.test(text) && !/^\s*(\/\/|\*|<!--|import )/.test(text);
		expect(
			lines
				.filter(({ text }) => inClasses(text) && moving.test(text) && !/transition:/.test(text))
				.filter(({ text }) => !text.includes("motion-reduce:transition-none"))
				.map(({ at }) => at),
		).toEqual([]);
	});

	// Svelte's transition:, in: and out: directives and animate:flip run in script, where no media query reaches: each
	// of Svelte's own takes its duration from motionMs, and a component with one of its own writing asks the same
	// setting.
	test("every Svelte transition takes its duration from the reduced-motion setting", () => {
		const directive = /\s(?:transition|in|out|animate):([a-z]+)/i;
		const sveltes = /^(?:fly|slide|fade|scale|blur|draw|crossfade|flip)$/;
		const sites = lines.filter(({ at, text }) => at.includes(".svelte:") && directive.test(text));
		expect(sites.length).toBeGreaterThan(0);
		expect(
			sites
				.filter(({ text }) => sveltes.test(directive.exec(text)![1]!) && !/\bmotionMs\(/.test(text))
				.map(({ at }) => at),
		).toEqual([]);
		const files = new Set(sites.map(({ at }) => at.split(":")[0]!));
		expect(
			sources
				.filter(({ file, source }) => files.has(file) && !/\bmotionMs\(|prefersReducedMotion/.test(source))
				.map(({ file }) => file),
		).toEqual([]);
	});
});

// The face of who has no picture (facehash-sv) blinks from a timer in script, which no variable turns off.
test("the default avatar's face keeps still with reduced motion", () => {
	const avatar = sources.find(({ file }) => file === "lib/components/UserAvatar.svelte")!.source;
	expect(avatar).toContain("motion-reduce:[&_[data-facehash-face]>div]:transform-none!");
	expect(avatar).toContain("motion-reduce:[&_[data-facehash-face]]:transition-none!");
});

describe("a Svelte transition's duration", () => {
	test("is the one asked for, and none with reduced motion", () => {
		expect(motionMs(200, false)).toBe(200);
		expect(motionMs(200, true)).toBe(0);
	});
});
