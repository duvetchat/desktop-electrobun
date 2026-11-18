import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The redesign's motion (#357, docs/redesign/DESIGN-MAP.md §1.10): app.css's second theme block, whose animations are
// variables so that reduced motion can turn them off in one place.
const css = readFileSync(join(import.meta.dir, "../app.css"), "utf8");
const motion = /\n@theme \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
const reduced = /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
const declared = (source: string) =>
	new Map([...source.matchAll(/^\s*(--animate-[a-z-]+):\s*([^;]+);/gm)].map((m) => [m[1]!, m[2]!]));
const animations = declared(motion);

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
	test("turns every one of them off", () => {
		const off = declared(reduced);
		expect([...animations.keys()].filter((name) => !off.has(name))).toEqual([]);
		for (const [name, value] of off) {
			// Prism's light isn't an arrival to skip: unlit, a mention would lose its mark. It's lit at once instead.
			if (name === "--animate-prism-arrive") expect(value).toBe("prism-arrive 0.01ms both");
			else expect(value, name).toBe("none");
		}
	});

	test("turns off nothing that isn't one of them", () => {
		expect([...declared(reduced).keys()].filter((name) => !animations.has(name))).toEqual([]);
	});
});
