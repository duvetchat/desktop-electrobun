// usage: bun fonts-build.ts [fonts-dir]        (default ../../../mobile/assets/fonts; needs uv, for fontTools)
// Builds the app's font files from the design system's (mobile/assets/fonts, the same TTFs the mobile app ships):
// Inter, Roboto and Fraunces as woff2 split by script, as Google serves a face, so a page loads only the subsets its
// text needs; Twemoji as one woff2 behind the emoji's unicode-range. Fira Mono's files are kept as they are. It
// rewrites src/lib/fonts/fonts.css and copies each face's license beside the files.
import { $ } from "bun";
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const source = resolve(process.argv[2] ?? join(import.meta.dir, "../../../mobile/assets/fonts"));
const out = join(import.meta.dir, "src/lib/fonts");
const python = ["uv", "run", "--quiet", "--with", "fonttools", "--with", "brotli"];

// The subsets Google serves these faces in, most specific first: a character belongs to the first that names it.
const SUBSETS: [name: string, range: string][] = [
	["cyrillic-ext", "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F"],
	["cyrillic", "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116"],
	["greek-ext", "U+1F00-1FFF"],
	["greek", "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF"],
	[
		"vietnamese",
		"U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
	],
	[
		"latin-ext",
		"U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
	],
	[
		"latin",
		"U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
	],
];

// The emoji Twemoji draws, as the design's stylesheet lists them: the face is asked for nothing else.
const EMOJI_RANGE =
	"U+00A9, U+00AE, U+203C, U+2049, U+2122, U+2139, U+2194-2199, U+21A9-21AA, U+231A-231B, U+2328, U+23CF, U+23E9-23F3, U+23F8-23FA, U+24C2, U+25AA-25AB, U+25B6, U+25C0, U+25FB-25FE, U+2600-27BF, U+2934-2935, U+2B05-2B07, U+2B1B-2B1C, U+2B50, U+2B55, U+3030, U+303D, U+3297, U+3299, U+FE0F, U+200D, U+1F000-1FAFF, U+E0020-E007F";

type Face = { family: string; slug: string; file: string; weight: string };
const FACES: Face[] = [
	{ family: "Inter", slug: "inter-400", file: "Inter-Regular.ttf", weight: "400" },
	{ family: "Inter", slug: "inter-500", file: "Inter-Medium.ttf", weight: "500" },
	{ family: "Inter", slug: "inter-600", file: "Inter-SemiBold.ttf", weight: "600" },
	{ family: "Inter", slug: "inter-700", file: "Inter-Bold.ttf", weight: "700" },
	{ family: "Roboto", slug: "roboto-400", file: "Roboto-Regular.ttf", weight: "400" },
	{ family: "Roboto", slug: "roboto-500", file: "Roboto-Medium.ttf", weight: "500" },
	{ family: "Roboto", slug: "roboto-700", file: "Roboto-Bold.ttf", weight: "700" },
	// One variable file: weight 100 to 900, with its opsz, SOFT and WONK axes kept (app.css sets them).
	{ family: "Fraunces", slug: "fraunces", file: "Fraunces.ttf", weight: "100 900" },
];
const LICENSES = ["Inter-OFL.txt", "Roboto-OFL.txt", "Fraunces-OFL.txt", "Twemoji-LICENSE.md"];

const parseRange = (range: string): number[] =>
	range.split(",").flatMap((part) => {
		const [from = "", to] = part.trim().replace("U+", "").split("-");
		const start = parseInt(from, 16);
		const end = to ? parseInt(to, 16) : start;
		return Array.from({ length: end - start + 1 }, (_, i) => start + i);
	});

/** Code points as a unicode-range: runs joined, in hex. */
export function formatRange(points: number[]): string {
	const runs: [from: number, to: number][] = [];
	for (const point of [...new Set(points)].sort((a, b) => a - b)) {
		const last = runs.at(-1);
		if (last && last[1] === point - 1) last[1] = point;
		else runs.push([point, point]);
	}
	const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
	return runs.map(([from, to]) => (from === to ? `U+${hex(from)}` : `U+${hex(from)}-${hex(to)}`)).join(", ");
}

async function codePoints(file: string): Promise<number[]> {
	const program =
		"import sys, json; from fontTools.ttLib import TTFont; print(json.dumps(sorted(TTFont(sys.argv[1]).getBestCmap().keys())))";
	return JSON.parse(await $`${python} python -c ${program} ${file}`.text());
}

const rule = (family: string, weight: string, file: string, range: string, note: string) => `/* ${note} */
@font-face {
	font-family: "${family}";
	font-style: normal;
	font-weight: ${weight};
	font-display: swap;
	src: url("./${file}") format("woff2");
	unicode-range: ${range};
}
`;

if (import.meta.main) {
	if (!existsSync(join(source, "Inter-Regular.ttf"))) throw new Error(`no fonts in ${source}`);
	const rules: string[] = [];

	for (const face of FACES) {
		const path = join(source, face.file);
		const has = new Set(await codePoints(path));
		const taken = new Set<number>();
		const subsets: [string, number[], string][] = [];
		for (const [name, range] of SUBSETS) {
			const points = parseRange(range).filter((p) => has.has(p));
			points.forEach((p) => taken.add(p));
			subsets.push([name, points, range]);
		}
		// What the face draws beyond those scripts: arrows, the keys' signs (⌘ ⇧ ⌥), math, boxes. Kept, as the design
		// shows them in this face.
		const rest = [...has].filter((p) => !taken.has(p) && p > 0x20);
		subsets.unshift(["symbols", rest, formatRange(rest)]);

		for (const [name, points, range] of subsets) {
			if (points.length === 0) continue;
			const file = `${face.slug}-${name}.woff2`;
			await $`${python} pyftsubset ${path} --unicodes=${formatRange(points)} --flavor=woff2 ${"--layout-features=*"} --output-file=${join(out, file)}`.quiet();
			rules.push(rule(face.family, face.weight, file, range, `${face.family} ${face.weight}, ${name}`));
			console.log(`${file}  ${points.length} characters  ${statSync(join(out, file)).size} bytes`);
		}
	}

	// Twemoji whole: its glyphs are color layers (COLR), which a subset by script has no use for.
	const twemoji = "twemoji.woff2";
	await $`${python} fonttools ttLib.woff2 compress -o ${join(out, twemoji)} ${join(source, "Twemoji.ttf")}`.quiet();
	console.log(`${twemoji}  ${statSync(join(out, twemoji)).size} bytes`);
	const emoji = `/* Twemoji, the emoji (art CC-BY 4.0, Twemoji-LICENSE.md): one color font, asked only for emoji */
@font-face {
	font-family: "Twemoji";
	font-style: normal;
	font-display: swap;
	src: url("./${twemoji}") format("woff2");
	unicode-range: ${EMOJI_RANGE};
}
`;

	for (const license of LICENSES) copyFileSync(join(source, license), join(out, license));

	// Fira Mono's rules stay as they are (its files came from Google, #284).
	const current = readFileSync(join(out, "fonts.css"), "utf8");
	const firaMono = [...current.matchAll(/\/\* Fira Mono [^*]*\*\/\n@font-face \{[^}]*\}\n/g)].map((m) => m[0]);
	if (firaMono.length === 0) throw new Error("fonts.css has no Fira Mono rules to keep");

	const header = `/* The app's faces, shipped with it so its first paint waits on no network (#284), each under the SIL Open Font
   License 1.1 (the *-OFL.txt files here): Inter for the interface, Roboto for what people write, Fraunces for titles,
   Fira Mono for code; and Twemoji for emoji. Inter, Roboto, Fraunces and Twemoji are the design system's files
   (mobile/assets/fonts), built by fonts-build.ts: don't edit their rules by hand. Each face is split by script, as
   Google serves one, by unicode-range: a page loads only the subsets its text needs. */
`;
	writeFileSync(join(out, "fonts.css"), [header, ...rules, emoji, ...firaMono].join("\n"));
	// As the repo's format check wants it.
	await $`bunx prettier --write ${join(out, "fonts.css")}`.quiet();
	console.log(`fonts.css: ${rules.length + 1 + firaMono.length} faces`);
}
