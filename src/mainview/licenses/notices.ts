// What the Licenses page's notices (#628) take that no package's folder says: the licences the app may ship, the texts
// of the packages that ship none, and the notices of what isn't an npm package. third-party-notices.ts builds the rest
// from what the page's build ships, and the Bun process's list from its bundle (licenses/bun.json). Every path is from
// the page's folder (src/mainview), as the texts are kept: byte for byte as their upstream has them.

import type { Platform } from "../src/lib/licenses";

/** A package's notice as its folder can't give it, for the one version it was checked against: a new version is
 * checked again (the build refuses its old override, and the package if it still lacks what this gave). */
export interface PackageOverride {
	/** Its licence, when its package.json names none. */
	license?: string;
	/** Its licence text, when it ships none: a file of upstream's, from its repository at that version. */
	text?: string;
	/** Texts added after its own: the notices of what it carries that its own licence leaves out. */
	also?: string[];
	/** What's missing from the package, or what it carries. */
	why: string;
}

/** A notice of something the app ships that isn't an npm package. */
export interface VendoredNotice {
	name: string;
	version?: string;
	/** As an SPDX expression. */
	license: string;
	/** Its text, one file or several in a row. */
	texts: string[];
	/** The desktop apps it ships in, when not all of them. */
	platforms?: Platform[];
	/** The files of the page's build it's the notice of, by their path from the page's folder. */
	covers?: RegExp;
}

export interface NoticesManifest {
	/** The licences a bundled package may be under, as SPDX identifiers: permissive ones, never the GPL or the AGPL. */
	accepted: readonly string[];
	/** By name@version. */
	overrides: Record<string, PackageOverride>;
	/** The desktop app's runtime, which Electrobun's build puts beside the page. */
	runtime: VendoredNotice[];
	/** Fonts, emoji and code kept in the page's own folders, each with the files it covers. */
	assets: VendoredNotice[];
	/** The page's folders that hold others' work: each file of them that ships needs an asset's notice. */
	vendored: RegExp[];
	/** Duvet's own files in those folders. */
	own: string[];
}

export const MANIFEST: NoticesManifest = {
	accepted: [
		"MIT",
		"MIT-0",
		"ISC",
		"0BSD",
		"BSD-2-Clause",
		"BSD-3-Clause",
		"Apache-2.0",
		"Zlib",
		"BlueOak-1.0.0",
		"CC0-1.0",
		"Unlicense",
	],
	overrides: {
		// https://github.com/blackboardsh/electrobun/blob/v1.15.1/LICENSE
		"electrobun@1.15.1": {
			text: "licenses/electrobun.txt",
			why: "its npm package ships no licence file; its package.json says MIT",
		},
		// https://github.com/kazuhikoarase/qrcode-generator/blob/js2.0.4/LICENSE
		"qrcode-generator@2.0.4": {
			text: "licenses/qrcode-generator.txt",
			why: "its npm package ships no licence file; its package.json says MIT",
		},
		"svelte-toolbelt@0.10.6": {
			license: "MIT",
			why: "its package.json names no licence; the LICENSE it ships is MIT's",
		},
		// https://github.com/xiph/rnnoise/blob/main/COPYING
		"@shiguredo/rnnoise-wasm@2025.1.5": {
			also: ["licenses/rnnoise.txt"],
			why: "its WebAssembly is RNNoise, whose BSD licence its own Apache licence leaves out",
		},
	},
	runtime: [
		{
			// Its launcher, native wrapper, self-extractor and libasar (zig-asar 0.2.2, whose package.json says MIT and
			// whose repository has no licence file), then the update tools beside them: bspatch (zig-bsdiff 0.1.19,
			// https://github.com/blackboardsh/zig-bsdiff/blob/v0.1.19/LICENSE) and zig-zstd 0.1.3
			// (https://github.com/blackboardsh/zig-zstd/blob/v0.1.3/LICENSE), both built with Zstandard
			// (https://github.com/facebook/zstd/blob/1168da0e567960d50cba1b58c9b0ba047ece4733/LICENSE).
			name: "Electrobun",
			version: "1.15.1",
			license: "MIT AND BSD-3-Clause",
			texts: ["licenses/electrobun.txt", "licenses/zig-bsdiff.txt", "licenses/zig-zstd.txt", "licenses/zstd.txt"],
		},
		{
			// The runtime Electrobun ships: https://github.com/oven-sh/bun/blob/bun-v1.3.9/LICENSE.md
			name: "Bun",
			version: "1.3.9",
			license: "MIT",
			texts: ["licenses/bun.md"],
		},
		{
			// WebView2Loader.dll, from the Microsoft.Web.WebView2 package of that version: its LICENSE.txt, then its
			// NOTICE.txt.
			name: "Microsoft Edge WebView2 loader",
			version: "1.0.3800.47",
			license: "BSD-3-Clause",
			texts: ["licenses/webview2-loader.txt"],
			platforms: ["windows"],
		},
		{
			// Electrobun's CEF for Linux (bundleCEF in electrobun.config.ts): the LICENSE.txt of CEF's distribution of that
			// version, then its README's word on Chromium's own credits, which ship inside CEF (about:credits).
			name: "Chromium Embedded Framework",
			version: "145.0.23+g3e7fe1c+chromium-145.0.7632.68",
			license: "BSD-3-Clause",
			texts: ["licenses/cef.txt"],
			platforms: ["linux"],
		},
	],
	assets: [
		{
			name: "Inter",
			license: "OFL-1.1",
			texts: ["src/lib/fonts/Inter-OFL.txt"],
			covers: /^src\/lib\/fonts\/inter-/,
		},
		{
			name: "Roboto",
			license: "OFL-1.1",
			texts: ["src/lib/fonts/Roboto-OFL.txt"],
			covers: /^src\/lib\/fonts\/roboto-/,
		},
		{
			name: "Fraunces",
			license: "OFL-1.1",
			texts: ["src/lib/fonts/Fraunces-OFL.txt"],
			covers: /^src\/lib\/fonts\/fraunces-/,
		},
		{
			name: "Fira Mono",
			license: "OFL-1.1",
			texts: ["src/lib/fonts/OFL-FiraMono.txt"],
			covers: /^src\/lib\/fonts\/fira-mono-/,
		},
		{
			// Its font, and the emoji images lib/emoji.ts loads from jsDelivr (jdecked/twemoji 16.0.1), under the same terms.
			name: "Twemoji",
			version: "16.0.1",
			license: "CC-BY-4.0 AND Apache-2.0",
			texts: ["src/lib/fonts/Twemoji-LICENSE.md"],
			covers: /^src\/lib\/fonts\/twemoji\.woff2$/,
		},
		{
			// https://github.com/kelvinkn17/skills/blob/main/LICENSE, the repository of skills/fun-isometric.
			name: "fun-isometric",
			license: "MIT",
			texts: ["src/lib/stickers/fun-isometric-LICENSE.txt"],
			covers: /^src\/lib\/stickers\/(fun|motions|icons)\.ts$/,
		},
	],
	vendored: [/^src\/lib\/fonts\//, /^src\/lib\/stickers\//],
	own: ["src/lib/stickers/duvet.ts"],
};
