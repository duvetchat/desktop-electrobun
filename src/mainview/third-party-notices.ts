import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { OutputBundle, PluginContext } from "rollup";
import type { Plugin } from "vite";
import { MANIFEST, type NoticesManifest, type VendoredNotice } from "./licenses/notices";
import type { Licenses, Notice } from "./src/lib/licenses";

// The Licenses page's notices (#628), made from what the page's build ships, so they follow the dependencies: the
// packages whose code a chunk carries, those a plugin read on its own (RNNoise's WebAssembly, Tailwind's stylesheet),
// the packages a stylesheet names for a plugin of Tailwind's, and the same of the workers' bundles. To them it adds the
// Bun process's packages (licenses/bun.json, which scripts/third-party-notices.ts makes from its bundle), the lists of
// licenses/notices.ts, and the encryption core's notices. It refuses the build when a package it ships has no licence
// text or one outside the accepted list, when a file of others' work in the page's own folders ships with no notice,
// or when one of the lists names what no longer ships. It runs under Node or Bun, as Vite does, so it uses neither's
// own API.

/** The core's notices, from the repository's root, where scripts/core-artifacts.ts puts them (its CARRIED). */
export const CORE_NOTICES = "native/core/THIRD-PARTY-NOTICES.txt";

const slashes = (path: string) => path.replaceAll("\\", "/");

/** The package a module or file belongs to: the folder after the last node_modules in its path. Vite's cache
 * (node_modules/.vite) is none: what it holds is a plugin's, and that plugin read it from its package. */
export function packageOf(path: string): { name: string; dir: string } | null {
	const clean = slashes(path.replace(/^\0/, "").split("?")[0] ?? "");
	const at = clean.lastIndexOf("node_modules/");
	if (at < 0 || (at > 0 && clean[at - 1] !== "/")) return null;
	const [first = "", second = ""] = clean.slice(at + "node_modules/".length).split("/");
	if (!first || first.startsWith(".") || (first.startsWith("@") && !second)) return null;
	const name = first.startsWith("@") ? `${first}/${second}` : first;
	return { name, dir: `${clean.slice(0, at)}node_modules/${name}` };
}

/** Whether an SPDX expression is one the accepted licences satisfy: one side of an OR, both of an AND. An exception
 * (WITH) is never accepted, nor anything that doesn't read as an expression. */
export function isAccepted(expression: string, accepted: readonly string[]): boolean {
	const allowed = new Set(accepted.map((id) => id.toLowerCase()));
	const tokens = expression.match(/[()]|[^\s()]+/g) ?? [];
	let at = 0;
	const next = () => tokens[at]?.toUpperCase();
	function atom(): boolean | null {
		const token = tokens[at++];
		if (token === undefined || token === ")" || ["AND", "OR", "WITH"].includes(token.toUpperCase())) return null;
		if (token === "(") {
			const inside = any();
			return tokens[at++] === ")" ? inside : null;
		}
		if (next() === "WITH") {
			at += 2;
			return tokens[at - 1] === undefined ? null : false;
		}
		return allowed.has(token.replace(/\+$/, "").toLowerCase());
	}
	function all(): boolean | null {
		let value = atom();
		while (value !== null && next() === "AND") {
			at++;
			const right = atom();
			value = right === null ? null : value && right;
		}
		return value;
	}
	function any(): boolean | null {
		let value = all();
		while (value !== null && next() === "OR") {
			at++;
			const right = all();
			value = right === null ? null : value || right;
		}
		return value;
	}
	return any() === true && at === tokens.length;
}

/** A licence as a package.json declares it: an SPDX expression, or an old one's object or list of them. */
function declaredLicense(json: { license?: unknown; licenses?: unknown }): string {
	const type = (entry: unknown): string => {
		if (typeof entry === "string") return entry;
		const value = typeof entry === "object" && entry !== null && "type" in entry ? entry.type : undefined;
		return typeof value === "string" ? value : "";
	};
	if (json.license !== undefined) return type(json.license);
	if (Array.isArray(json.licenses)) return json.licenses.map(type).filter(Boolean).join(" OR ");
	return type(json.licenses);
}

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;
/** A package's licence before its notice: LICENSE, then COPYING, then NOTICE. */
const kind = (name: string) => (/^licen/i.test(name) ? 0 : /^copying/i.test(name) ? 1 : 2);

/** The texts of files, in a row; each file's own ending trimmed. */
const textsOf = (files: string[]) =>
	files
		.map((file) => readFileSync(file, "utf8").trimEnd())
		.filter((text) => text.trim())
		.join("\n\n");

/** A package's notice: its name, version and licence, and its licence files' texts, with the override of that very
 * version applied. An override's files are named from `root`, the page's folder. */
export function packageNotice(
	dir: string,
	overrides: NoticesManifest["overrides"] = MANIFEST.overrides,
	root = "",
): Notice {
	const json = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	const override = overrides[`${json.name}@${json.version}`];
	const own = readdirSync(dir)
		.filter((name) => LICENCE_FILE.test(name) && statSync(join(dir, name)).isFile())
		.sort((a, b) => kind(a) - kind(b) || a.localeCompare(b))
		.map((name) => join(dir, name));
	const texts = [
		...(override?.text ? [join(root, override.text)] : own),
		...(override?.also ?? []).map((f) => join(root, f)),
	];
	return {
		name: String(json.name),
		version: String(json.version),
		license: override?.license ?? declaredLicense(json),
		text: textsOf(texts),
	};
}

/** What keeps a package's notice from shipping. */
export function noticeProblems(notice: Notice, accepted: readonly string[]): string[] {
	const id = `${notice.name}@${notice.version}`;
	const problems: string[] = [];
	if (!notice.text.trim()) problems.push(`${id} ships no licence text`);
	if (!notice.license.trim()) problems.push(`${id} names no licence in its package.json`);
	else if (!isAccepted(notice.license, accepted)) {
		problems.push(`${id} is under ${notice.license}, which isn't an accepted licence`);
	}
	return problems;
}

/** The overrides no shipped package uses: written for a version that's gone. */
export function unusedOverrides(overrides: NoticesManifest["overrides"], shipped: Notice[]): string[] {
	const used = new Set(shipped.map((notice) => `${notice.name}@${notice.version}`));
	return Object.keys(overrides)
		.filter((key) => !used.has(key))
		.map((key) => `the override for ${key} matches no package the app ships`);
}

type Coverage = Pick<NoticesManifest, "assets" | "vendored" | "own">;

/** The shipped files of the page's own folders of others' work that no asset's notice covers. */
export function uncovered(files: string[], { assets, vendored, own }: Coverage): string[] {
	return [...new Set(files)]
		.filter((file) => vendored.some((folder) => folder.test(file)) && !own.includes(file))
		.filter((file) => !assets.some((asset) => asset.covers?.test(file)))
		.sort()
		.map((file) => `${file} ships with no notice`);
}

/** The assets' notices that cover no shipped file. */
export function idleAssets(files: string[], { assets }: Pick<NoticesManifest, "assets">): string[] {
	return assets
		.filter((asset) => !files.some((file) => asset.covers?.test(file)))
		.map((asset) => `the notice of ${asset.name} covers nothing the app ships`);
}

/** A notice of the lists, its texts read from the page's folder. */
function vendoredNotice(notice: VendoredNotice, root: string): Notice {
	const { name, version, license, platforms } = notice;
	return { name, version, license, platforms, text: textsOf(notice.texts.map((file) => join(root, file))) };
}

/** The core's notices, with the commit they came from, if the checkout has them. */
function coreNotices(root: string): Licenses["core"] {
	const repository = join(root, "..", "..");
	const file = join(repository, CORE_NOTICES);
	if (!existsSync(file)) return null;
	const source = JSON.parse(readFileSync(join(repository, "native", "core", "SOURCE.json"), "utf8"));
	return { commit: String(source.commit), text: readFileSync(file, "utf8") };
}

/** The folder of the package a stylesheet names, found as Node finds one: in the node_modules of each folder up. */
function stylesheetPackage(from: string, specifier: string): string | null {
	const parts = specifier.split("/");
	const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
	for (let dir = from; ; dir = dirname(dir)) {
		const candidate = join(dir, "node_modules", name);
		if (existsSync(join(candidate, "package.json"))) return slashes(candidate);
		if (dirname(dir) === dir) return null;
	}
}

/** The step, for the page's build, and a step of each worker's build that tells it what the worker ships. */
export function thirdPartyNotices(manifest: NoticesManifest = MANIFEST): { plugin: Plugin; worker: () => Plugin } {
	let root = "";
	let server = false;
	const packages = new Set<string>();
	const files = new Set<string>();

	/** A path a bundle ships: a package's, or one of the page's own files (from its folder). */
	function shipped(path: string) {
		const found = packageOf(path);
		if (found) return void packages.add(found.dir);
		if (path.startsWith("\0")) return;
		const file = slashes(isAbsolute(path) ? relative(root, path.split("?")[0] ?? "") : (path.split("?")[0] ?? ""));
		if (file && !file.startsWith("..")) files.add(file);
	}

	function collect(context: PluginContext, bundle: OutputBundle) {
		for (const output of Object.values(bundle)) {
			if (output.type === "chunk") {
				for (const [id, module] of Object.entries(output.modules)) if (module.renderedLength > 0) shipped(id);
			} else {
				for (const file of output.originalFileNames ?? []) shipped(file);
			}
		}
		// A file a plugin read on its own and declared, which no module is: only a package's counts, as its plugin turned
		// it into what ships; the page's own such files are its configuration.
		const modules = new Set(context.getModuleIds());
		for (const file of context.getWatchFiles()) {
			const found = !modules.has(file) && packageOf(file);
			if (found) packages.add(found.dir);
		}
	}

	const plugin: Plugin = {
		name: "duvet-third-party-notices",
		enforce: "pre",
		configResolved(config) {
			root = config.root;
			server = Boolean(config.build.ssr);
		},
		buildStart() {
			packages.clear();
			files.clear();
		},
		transform(code, id) {
			const file = id.split("?")[0] ?? "";
			if (!file.endsWith(".css") || packageOf(file)) return null;
			// The stylesheet as written: Tailwind's own step, which may run first, leaves no @plugin in it.
			const source = existsSync(file) ? readFileSync(file, "utf8") : code;
			for (const [, specifier = ""] of source.matchAll(/@(?:import|plugin)\s+["']([^"'./][^"':]*)["']/g)) {
				const dir = stylesheetPackage(dirname(file), specifier);
				if (dir) packages.add(dir);
			}
			return null;
		},
		generateBundle(_options, bundle) {
			if (server) return;
			collect(this, bundle);
			const page = new Map<string, Notice>();
			for (const dir of packages) {
				const notice = packageNotice(dir, manifest.overrides, root);
				page.set(`${notice.name}@${notice.version}`, notice);
			}
			const licenses: Licenses = {
				page: [...page.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version!.localeCompare(b.version!)),
				bun: JSON.parse(readFileSync(join(root, "licenses", "bun.json"), "utf8")),
				runtime: manifest.runtime.map((notice) => vendoredNotice(notice, root)),
				assets: manifest.assets.map((notice) => vendoredNotice(notice, root)),
				core: coreNotices(root),
			};
			const shippedFiles = [...files];
			const problems = [
				...[...licenses.page, ...licenses.bun].flatMap((notice) => noticeProblems(notice, manifest.accepted)),
				...unusedOverrides(manifest.overrides, [...licenses.page, ...licenses.bun]),
				...uncovered(shippedFiles, manifest),
				...idleAssets(shippedFiles, manifest),
			];
			if (problems.length)
				this.error(`the Licenses page's notices (third-party-notices.ts):\n  ${problems.join("\n  ")}`);
			this.emitFile({ type: "asset", fileName: "licenses.json", source: JSON.stringify(licenses) });
		},
	};
	return {
		plugin,
		worker: () => ({
			name: "duvet-third-party-notices-worker",
			generateBundle(_options, bundle) {
				collect(this, bundle);
			},
		}),
	};
}
