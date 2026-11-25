import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { circleCheck, NOT_FROM_THE_PACKAGE, smile, smilePlus } from "$lib/icons";
import { tags } from "./components/server-render";

const src = join(import.meta.dir, "..");
const installed = join(import.meta.dir, "../../node_modules/@lucide/svelte/dist");

/** The icon nodes an installed icon draws, as its compiled component writes them. */
function installedNode(name: string): unknown {
	const source = readFileSync(join(installed, "icons", `${name}.svelte`), "utf8");
	const written = /const iconNode = (\[[\s\S]*?\]);\n/.exec(source)?.[1];
	if (!written) throw new Error(`no iconNode in ${name}.svelte`);
	return JSON.parse(written);
}

describe("the three glyphs mobile draws differently", () => {
	// Lucide 1.70.0's, which lucide_icons_flutter 4.0.3 ships to mobile.
	test("are Lucide 1.70.0's drawings", () => {
		expect(smile).toEqual([
			["path", { d: "M15 10V9" }],
			["path", { d: "M16.472 15a6 6 0 01-8.943 0" }],
			["path", { d: "M9 10V9" }],
			["circle", { cx: "12", cy: "12", r: "10" }],
		]);
		expect(smilePlus.map(([, attrs]) => attrs.d)).toEqual([
			"M13.267 2.08a10 10 0 108.653 8.653",
			"M15 10V9",
			"M16 5h6",
			"M16.472 15a6 6 0 01-8.943 0",
			"M19 2v6",
			"M9 10V9",
		]);
		expect(circleCheck).toEqual([
			["circle", { cx: "12", cy: "12", r: "10" }],
			["path", { d: "m16 9-5.5 5.5L8 12" }],
		]);
	});

	// Once @lucide/svelte is at Lucide 1.70 or later, its own glyphs are these: this fails, and lib/icons.ts and
	// components/ui/icons can go, with every import back on the package.
	test("still differ from the installed package's", () => {
		expect(installedNode("smile")).not.toEqual(smile);
		expect(installedNode("smile-plus")).not.toEqual(smilePlus);
		expect(installedNode("circle-check")).not.toEqual(circleCheck);
	});

	// The file's first .svelte imports: compiling them is most of its time, past bun's 5 s on a loaded runner (#487).
	test("draw as any Lucide icon does: an svg in the current color, sized and classed by its props", async () => {
		for (const [file, name, node] of [
			["Smile", "smile", smile],
			["SmilePlus", "smile-plus", smilePlus],
			["CircleCheck", "circle-check", circleCheck],
		] as const) {
			const { default: Glyph } = await import(`./components/ui/icons/${file}.svelte`);
			const [svg, ...shapes] = await tags(Glyph, { size: 18, class: "text-duvet-ink2" });
			expect(svg!.name).toBe("svg");
			expect(svg!.attributes).toMatchObject({
				width: "18",
				height: "18",
				// HTMLRewriter reads attribute names in lower case.
				viewbox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				"stroke-width": "2",
				"aria-hidden": "true",
			});
			expect(svg!.attributes.class!.split(/\s+/)).toEqual(
				expect.arrayContaining(["lucide", `lucide-${name}`, "text-duvet-ink2"]),
			);
			const drawn: unknown[] = shapes.map((shape) => [shape.name, shape.attributes]);
			const written: unknown[] = node.map(([tag, attrs]) => [tag, attrs]);
			expect(drawn).toEqual(written);
		}
	}, 30_000);
});

describe("where views take their icons", () => {
	const sources = (dir: string): string[] =>
		readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) return sources(path);
			return /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
		});
	// Every `import { … } from "@lucide/svelte"`, on one line or several, with the names it takes.
	const imports = sources(src).flatMap((file) =>
		[...readFileSync(file, "utf8").matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"@lucide\/svelte"/g)].map(
			(m) => ({
				file: relative(src, file).split(sep).join("/"),
				names: m[1]!
					.split(",")
					.map(
						(name) =>
							name
								.trim()
								.replace(/^type\s+/, "")
								.split(/\s+as\s+/)[0]!,
					)
					.filter(Boolean),
			}),
		),
	);

	test("finds the views' imports", () => {
		expect(imports.length).toBeGreaterThan(50);
	});

	test("no view takes from the package a glyph the app draws itself, or the deprecated `Text`", () => {
		expect(
			imports.flatMap(({ file, names }) =>
				names.filter((name) => name in NOT_FROM_THE_PACKAGE).map((name) => `${file}: ${name}`),
			),
		).toEqual([]);
	});

	test("every icon a view names is one the installed package has", () => {
		// Its icons, and the older names it still answers to (Loader2).
		const exported =
			readFileSync(join(installed, "icons", "index.js"), "utf8") +
			readFileSync(join(installed, "aliases", "aliases.js"), "utf8");
		const missing = imports.flatMap(({ file, names }) =>
			names
				.filter((name) => !["Icon", "IconProps", "IconNode"].includes(name))
				.filter((name) => !new RegExp(`\\bdefault as ${name}\\b`).test(exported))
				.map((name) => `${file}: ${name}`),
		);
		expect(missing).toEqual([]);
	});
});
