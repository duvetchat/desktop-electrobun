// A page's static module graph, as its source says it: what `import … from`, `export … from`, `import "…"` and
// `import("…")` reach, from a route's +page.svelte and the layouts above it, through $lib and relative paths.
// Packages are left out: none of them opens the gateway. It is the guard of the app's other windows (#357,
// lib/app-windows.ts): a window that must never open a second gateway connection must never reach
// lib/api/ws/connection.ts, which also does work as it loads (it wires the activity RPC and a timer). Only tests
// import this (module-graph.test.ts): it reads files, and never runs in the app.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SPECIFIER =
	/(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
const EXTENSIONS = ["", ".ts", ".svelte.ts", ".js", ".svelte", "/index.ts", "/index.js"];

/** A source without its comments, so an import a comment only mentions isn't one. */
const withoutComments = (text: string) =>
	text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1")
		.replace(/<!--[\s\S]*?-->/g, "");

/** The files a source file imports, resolved against src (for $lib) or its own folder. Type-only imports count too:
 * they reach nothing when the app runs, and a guard that errs is one that errs towards saying so. */
export function importsOf(file: string, src: string, dynamic = true): string[] {
	const text = withoutComments(readFileSync(file, "utf8"));
	const found: string[] = [];
	for (const match of text.matchAll(SPECIFIER)) {
		// match[2] is an `import("…")`, which loads only when it runs: left out of a graph of what loads with the page.
		const specifier = match[1] ?? (dynamic ? match[2] : undefined) ?? match[3];
		if (!specifier) continue;
		let base: string | null = null;
		if (specifier.startsWith("$lib/") || specifier === "$lib") base = join(src, "lib", specifier.slice(5));
		else if (specifier.startsWith(".")) base = resolve(dirname(file), specifier);
		if (!base) continue;
		const resolved = base;
		const hit = EXTENSIONS.map((extension) => resolved + extension).find(
			(candidate) => existsSync(candidate) && statSync(candidate).isFile(),
		);
		if (hit) found.push(hit);
	}
	return found;
}

/** The layouts a route's page renders inside: every +layout.svelte and +layout.ts from src/routes down to its folder. */
export function layoutsOf(page: string, src: string): string[] {
	const routes = join(src, "routes");
	const layouts: string[] = [];
	let dir = dirname(page);
	while (dir.startsWith(routes)) {
		for (const name of ["+layout.svelte", "+layout.ts"]) if (existsSync(join(dir, name))) layouts.push(join(dir, name));
		if (dir === routes) break;
		dir = dirname(dir);
	}
	return layouts;
}

/** Every file a page reaches, each with the chain of imports that reaches it first: a failure can say how. */
export function moduleGraph(page: string, src: string, dynamic = true): Map<string, string[]> {
	const seen = new Map<string, string[]>();
	const queue: [string, string[]][] = [page, ...layoutsOf(page, src)].map((file) => [file, [file]]);
	for (let next = queue.shift(); next; next = queue.shift()) {
		const [file, chain] = next;
		if (seen.has(file)) continue;
		seen.set(file, chain);
		for (const imported of importsOf(file, src, dynamic)) {
			if (!seen.has(imported)) queue.push([imported, [...chain, imported]]);
		}
	}
	return seen;
}

/** A file's path from src, with forward slashes. */
export const shortName = (file: string, src: string) => relative(src, file).split(sep).join("/");

/** How a page reaches a file, as the chain of imports from the page or a layout to it; null when it doesn't. Without
 * `dynamic`, only what loads with the page counts. */
export function reaches(page: string, target: string, src: string, dynamic = true): string[] | null {
	return (
		moduleGraph(page, src, dynamic)
			.get(target)
			?.map((file) => shortName(file, src)) ?? null
	);
}
