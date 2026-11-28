import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Licenses } from "./src/lib/licenses";
import { MANIFEST, type NoticesManifest } from "./licenses/notices";
import {
	idleAssets,
	isAccepted,
	noticeProblems,
	packageNotice,
	packageOf,
	thirdPartyNotices,
	uncovered,
	unusedOverrides,
} from "./third-party-notices";

// The Licenses page's notices (#628): made from what the page's build ships, and the build refused when a package it
// ships has no licence text, or one outside the accepted list.
const scratch = mkdtempSync(join(tmpdir(), "duvet-notices-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function write(path: string, text: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

/** A package's folder in a node_modules, with its package.json and the files given. */
function fakePackage(root: string, manifest: Record<string, unknown>, files: Record<string, string> = {}): string {
	const dir = join(root, "node_modules", String(manifest.name));
	write(join(dir, "package.json"), JSON.stringify(manifest));
	for (const [name, text] of Object.entries(files)) write(join(dir, name), text);
	return dir;
}

describe("the package a file belongs to", () => {
	test("is the folder after the last node_modules, scoped or not", () => {
		expect(packageOf("/app/node_modules/svelte/src/index.js")).toEqual({
			name: "svelte",
			dir: "/app/node_modules/svelte",
		});
		expect(packageOf("/app/node_modules/@floating-ui/dom/dist/index.mjs")).toEqual({
			name: "@floating-ui/dom",
			dir: "/app/node_modules/@floating-ui/dom",
		});
		expect(packageOf("/app/node_modules/bits-ui/node_modules/@scope/inner/index.js")?.name).toBe("@scope/inner");
		// Bun's isolated installs keep each package in node_modules/.bun/<name>@<version>/node_modules/<name>.
		expect(packageOf("/app/node_modules/.bun/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs")?.name).toBe("clsx");
	});

	test("reads a module's ID as Vite writes it: a query after it, \\0 before it, Windows' separators", () => {
		expect(packageOf("/app/node_modules/bits-ui/dist/a.svelte?svelte&type=style&lang.css")?.name).toBe("bits-ui");
		expect(packageOf("\0/app/node_modules/esm-env/index.js")?.name).toBe("esm-env");
		expect(packageOf("C:\\app\\node_modules\\@lucide\\svelte\\dist\\x.svelte")).toEqual({
			name: "@lucide/svelte",
			dir: "C:/app/node_modules/@lucide/svelte",
		});
	});

	test("is none for the app's own files and Vite's cache", () => {
		expect(packageOf("/app/src/lib/markdown.ts")).toBeNull();
		expect(packageOf("/app/node_modules/.vite/rnnoise.wasm?url")).toBeNull();
		expect(packageOf("\0virtual:rnnoise-wasm")).toBeNull();
	});
});

describe("an accepted licence", () => {
	const accepted = MANIFEST.accepted;

	test("is a permissive one, in any case", () => {
		for (const id of ["MIT", "mit", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"]) {
			expect({ id, accepted: isAccepted(id, accepted) }).toEqual({ id, accepted: true });
		}
	});

	test("is never the GPL, the AGPL or the LGPL, nor what an expression only adds them to", () => {
		for (const id of [
			"GPL-3.0-only",
			"GPL-2.0-or-later",
			"AGPL-3.0",
			"LGPL-2.1-only",
			"MPL-2.0",
			"MIT AND GPL-3.0-only",
			"(MIT AND AGPL-3.0)",
		]) {
			expect({ id, accepted: isAccepted(id, accepted) }).toEqual({ id, accepted: false });
		}
		expect(accepted.filter((id) => /GPL/i.test(id))).toEqual([]);
	});

	test("is an OR with one side accepted, an AND with both", () => {
		expect(isAccepted("(MIT OR GPL-3.0-only)", accepted)).toBe(true);
		expect(isAccepted("GPL-3.0-only OR Apache-2.0", accepted)).toBe(true);
		expect(isAccepted("(MIT OR Apache-2.0) AND BSD-3-Clause", accepted)).toBe(true);
		expect(isAccepted("MIT AND (GPL-2.0-only OR ISC)", accepted)).toBe(true);
	});

	test("isn't an exception, a pointer to a file, nothing, or an expression that doesn't read", () => {
		for (const id of [
			"Apache-2.0 WITH LLVM-exception",
			"SEE LICENSE IN LICENSE.txt",
			"UNLICENSED",
			"",
			"MIT OR",
			"(MIT",
		]) {
			expect({ id, accepted: isAccepted(id, accepted) }).toEqual({ id, accepted: false });
		}
	});
});

describe("a package's notice", () => {
	const root = join(scratch, "packages");
	const none: NoticesManifest["overrides"] = {};

	test("is its name, version, licence and licence files, the licence before a notice", () => {
		const dir = fakePackage(
			root,
			{ name: "plain", version: "1.2.3", license: "Apache-2.0" },
			{ NOTICE: "Notice text", "LICENSE.md": "Licence text", "README.md": "Not a licence" },
		);
		expect(packageNotice(dir, none)).toEqual({
			name: "plain",
			version: "1.2.3",
			license: "Apache-2.0",
			text: "Licence text\n\nNotice text",
		});
	});

	test("takes the licences of an old package.json's list", () => {
		const dir = fakePackage(
			root,
			{ name: "old", version: "0.1.0", licenses: [{ type: "MIT" }, { type: "ISC" }] },
			{ license: "x" },
		);
		expect(packageNotice(dir, none).license).toBe("MIT OR ISC");
		const single = fakePackage(root, { name: "older", version: "0.1.0", license: { type: "BSD-2-Clause" } }, {});
		expect(packageNotice(single, none).license).toBe("BSD-2-Clause");
	});

	test("takes what an override of its version gives: a licence, a text, and texts added", () => {
		// An override's texts are named from the page's folder, as every text of the lists is.
		const texts = join(scratch, "override-texts");
		write(join(texts, "licenses", "upstream.txt"), "Upstream licence");
		write(join(texts, "licenses", "extra.txt"), "Bundled code's licence");
		const bare = fakePackage(root, { name: "bare", version: "2.0.0", license: "MIT" });
		const nameless = fakePackage(root, { name: "nameless", version: "3.0.0" }, { LICENSE: "Its text" });
		const wrapped = fakePackage(root, { name: "wrapped", version: "4.0.0", license: "Apache-2.0" }, { LICENSE: "A" });
		const overrides: NoticesManifest["overrides"] = {
			"bare@2.0.0": { text: "licenses/upstream.txt", why: "no licence file" },
			"nameless@3.0.0": { license: "MIT", why: "no licence in package.json" },
			"wrapped@4.0.0": { also: ["licenses/extra.txt"], why: "carries other code" },
		};
		expect(packageNotice(bare, overrides, texts).text).toBe("Upstream licence");
		expect(packageNotice(nameless, overrides, texts).license).toBe("MIT");
		expect(packageNotice(wrapped, overrides, texts).text).toBe("A\n\nBundled code's licence");
		// Another version isn't the one the override was checked against.
		const bumped = fakePackage(join(scratch, "bumped"), { name: "bare", version: "2.0.1", license: "MIT" });
		expect(packageNotice(bumped, overrides, texts).text).toBe("");
	});

	test("can't ship without a licence text, or under a licence outside the list", () => {
		const accepted = MANIFEST.accepted;
		const notice = { name: "x", version: "1.0.0", license: "MIT", text: "MIT License" };
		expect(noticeProblems(notice, accepted)).toEqual([]);
		expect(noticeProblems({ ...notice, text: " \n" }, accepted)).toEqual(["x@1.0.0 ships no licence text"]);
		expect(noticeProblems({ ...notice, license: "GPL-3.0-only" }, accepted)).toEqual([
			"x@1.0.0 is under GPL-3.0-only, which isn't an accepted licence",
		]);
		expect(noticeProblems({ ...notice, license: "" }, accepted)).toEqual([
			"x@1.0.0 names no licence in its package.json",
		]);
	});

	test("an override that no shipped package uses is one that fell behind", () => {
		const overrides: NoticesManifest["overrides"] = {
			"a@1.0.0": { license: "MIT", why: "-" },
			"b@2.0.0": { license: "MIT", why: "-" },
		};
		expect(unusedOverrides(overrides, [{ name: "a", version: "1.0.0", license: "MIT", text: "t" }])).toEqual([
			"the override for b@2.0.0 matches no package the app ships",
		]);
	});
});

describe("the files of others' work in the app's own folders", () => {
	const manifest: Pick<NoticesManifest, "assets" | "vendored" | "own"> = {
		assets: [
			{ name: "Inter", license: "OFL-1.1", texts: [], covers: /^src\/lib\/fonts\/inter-/ },
			{ name: "Gone", license: "OFL-1.1", texts: [], covers: /^src\/lib\/fonts\/gone-/ },
		],
		vendored: [/^src\/lib\/fonts\//, /^src\/lib\/stickers\//],
		own: ["src/lib/stickers/duvet.ts"],
	};

	test("each needs a notice, but the app's own", () => {
		const shipped = [
			"src/lib/fonts/inter-400-latin.woff2",
			"src/lib/fonts/new-face.woff2",
			"src/lib/stickers/duvet.ts",
			"src/lib/markdown.ts",
		];
		expect(uncovered(shipped, manifest)).toEqual(["src/lib/fonts/new-face.woff2 ships with no notice"]);
	});

	test("a notice that covers nothing the app ships is one that fell behind", () => {
		expect(idleAssets(["src/lib/fonts/inter-400-latin.woff2"], manifest)).toEqual([
			"the notice of Gone covers nothing the app ships",
		]);
	});
});

describe("the build step", () => {
	/** A checkout with the page's folder (the build's root), a package or two, and the core's pin. */
	function checkout(name: string) {
		const repo = join(scratch, name);
		const root = join(repo, "src", "mainview");
		const mit = fakePackage(root, { name: "mit-package", version: "1.0.0", license: "MIT" }, { LICENSE: "MIT text" });
		const shaken = fakePackage(root, { name: "shaken", version: "1.0.0", license: "GPL-3.0-only" }, { LICENSE: "G" });
		const read = fakePackage(root, { name: "read-by-a-plugin", version: "5.0.0", license: "ISC" }, { LICENSE: "I" });
		write(join(root, "licenses", "runtime.txt"), "Runtime licence");
		write(join(root, "src", "lib", "fonts", "Face-OFL.txt"), "OFL text");
		write(join(root, "licenses", "bun.json"), JSON.stringify([{ name: "bunpkg", license: "MIT", text: "B" }]));
		write(join(repo, "native", "core", "SOURCE.json"), JSON.stringify({ commit: "b7fc99e".padEnd(40, "0") }));
		const manifest: NoticesManifest = {
			accepted: MANIFEST.accepted,
			overrides: {},
			runtime: [{ name: "Runtime", version: "1.0.0", license: "MIT", texts: ["licenses/runtime.txt"] }],
			assets: [
				{ name: "Face", license: "OFL-1.1", texts: ["src/lib/fonts/Face-OFL.txt"], covers: /^src\/lib\/fonts\/face-/ },
			],
			vendored: [/^src\/lib\/fonts\//],
			own: [],
		};
		return { repo, root, manifest, mit, shaken, read };
	}

	/** Runs the plugin's hooks as a client build does, and gives back what it emitted or the error it raised. */
	function run(
		setup: ReturnType<typeof checkout>,
		modules: Record<string, number>,
		{ ssr = false, watch = [] as string[], assets = ["src/lib/fonts/face-400.woff2"], css = "" } = {},
	) {
		const { plugin, worker } = thirdPartyNotices(setup.manifest);
		const emitted: { fileName: string; source: string }[] = [];
		const context = {
			getModuleIds: () => Object.keys(modules)[Symbol.iterator](),
			getWatchFiles: () => watch,
			emitFile: (file: { fileName: string; source: string }) => emitted.push(file),
			error: (message: string) => {
				throw new Error(message);
			},
		};
		const bundle = {
			"app.js": {
				type: "chunk",
				modules: Object.fromEntries(Object.entries(modules).map(([id, n]) => [id, { renderedLength: n }])),
			},
			...Object.fromEntries(
				assets.map((file, i) => [`asset${i}`, { type: "asset", fileName: `a${i}`, originalFileNames: [file] }]),
			),
		};
		call(plugin.configResolved, context, { root: setup.root, build: { ssr } });
		call(plugin.buildStart, context);
		if (css) call(plugin.transform, context, css, join(setup.root, "src", "app.css"));
		call(worker().generateBundle, context, {}, {});
		call(plugin.generateBundle, context, {}, bundle);
		const file = emitted.find((entry) => entry.fileName === "licenses.json");
		return file ? parsed(file.source) : null;
	}

	/** A hook as Rollup calls it: the function itself, or an object's handler. */
	function call(hook: unknown, self: object, ...args: unknown[]): unknown {
		const handler = typeof hook === "object" && hook !== null && "handler" in hook ? hook.handler : hook;
		if (typeof handler !== "function") throw new Error("not a hook");
		return Reflect.apply(handler, self, args);
	}

	const parsed = (source: string): Licenses => JSON.parse(source);

	test("lists the packages whose code ships, and those a plugin read on its own, with their notices", () => {
		const setup = checkout("lists");
		const licenses = run(
			setup,
			{
				[join(setup.mit, "index.js")]: 120,
				// Read, then shaken out of the bundle: none of its code ships.
				[join(setup.shaken, "index.js")]: 0,
				[join(setup.root, "src", "app.ts")]: 40,
			},
			{ watch: [join(setup.read, "dist", "wasm.js"), join(setup.root, "node_modules", ".vite", "x.wasm")] },
		);
		expect(licenses?.page).toEqual([
			{ name: "mit-package", version: "1.0.0", license: "MIT", text: "MIT text" },
			{ name: "read-by-a-plugin", version: "5.0.0", license: "ISC", text: "I" },
		]);
		expect(licenses?.bun).toEqual([{ name: "bunpkg", license: "MIT", text: "B" }]);
		expect(licenses?.runtime).toEqual([{ name: "Runtime", version: "1.0.0", license: "MIT", text: "Runtime licence" }]);
	});

	test("counts the packages a stylesheet names, whose CSS a plugin writes into it", () => {
		const setup = checkout("stylesheet");
		fakePackage(setup.root, { name: "css-plugin", version: "1.0.7", license: "MIT" }, { LICENSE: "C" });
		const licenses = run(setup, {}, { css: '@import "tailwindcss";\n@plugin "css-plugin";\n@import "./own.css";' });
		expect(licenses?.page.map((notice) => notice.name)).toEqual(["css-plugin"]);
	});

	test("refuses a build that ships a package it can't, and names it", () => {
		const setup = checkout("refuses");
		expect(() => run(setup, { [join(setup.shaken, "index.js")]: 10 })).toThrow(
			"shaken@1.0.0 is under GPL-3.0-only, which isn't an accepted licence",
		);
	});

	test("refuses a font that ships with no notice, and keeps the ones it has", () => {
		const setup = checkout("fonts");
		expect(() => run(setup, {}, { assets: ["src/lib/fonts/other-400.woff2"] })).toThrow(
			"src/lib/fonts/other-400.woff2 ships with no notice",
		);
		const licenses = run(setup, {}, { assets: ["src/lib/fonts/face-400.woff2"] });
		expect(licenses?.assets).toEqual([{ name: "Face", license: "OFL-1.1", text: "OFL text" }]);
	});

	test("carries the core's notices when the checkout has them, and says they're missing when not", () => {
		const setup = checkout("core");
		expect(run(setup, {})?.core).toBeNull();
		write(join(setup.repo, "native", "core", "THIRD-PARTY-NOTICES.txt"), "SQLCipher, OpenSSL, OpenMLS");
		expect(run(setup, {})?.core).toEqual({ commit: "b7fc99e".padEnd(40, "0"), text: "SQLCipher, OpenSSL, OpenMLS" });
	});

	test("emits nothing for the server's build, which ships to nobody", () => {
		const setup = checkout("server");
		expect(run(setup, { [join(setup.shaken, "index.js")]: 10 }, { ssr: true })).toBeNull();
	});
});

describe("the app's own lists", () => {
	const root = import.meta.dir;

	test("every text a notice names is there", () => {
		const files = [
			...MANIFEST.runtime.flatMap((notice) => notice.texts),
			...MANIFEST.assets.flatMap((notice) => notice.texts),
			...Object.values(MANIFEST.overrides).flatMap((override) => [override.text ?? [], override.also ?? []].flat()),
		];
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			expect({ file, text: readFileSync(join(root, file), "utf8").trim().length > 0 }).toEqual({ file, text: true });
		}
	});

	test("every override says why it's there", () => {
		for (const [key, override] of Object.entries(MANIFEST.overrides)) {
			expect({ key, why: override.why.length > 0, versioned: /^(@[^/]+\/)?[^@]+@\d/.test(key) }).toEqual({
				key,
				why: true,
				versioned: true,
			});
		}
	});

	test("the build uses the step, for the page and its workers", () => {
		const config = readFileSync(join(root, "vite.config.ts"), "utf8");
		expect(config).toMatch(/plugins: \[[^\]]*notices\.plugin/);
		expect(config).toMatch(/worker: \{[^}]*plugins: \(\) => \[notices\.worker\(\)\]/);
	});
});
