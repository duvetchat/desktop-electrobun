import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	VIBRANT_CLASS,
	VIBRANT_SIDEBAR,
	followWornTheme,
	showsMaterial,
	watchClasses,
	wornTheme,
	type ThemedRoot,
} from "$lib/vibrancy";

// The sidebar's glass on macOS (#374): the system's material is behind the main window's page, and the page leaves it
// uncovered behind the sidebar, and nowhere else.
const source = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");
const css = source("app.css");

/** <html>, as far as its classes go, and what watches them. */
function root(...classes: string[]) {
	const worn = new Set(classes);
	const watchers = new Set<() => void>();
	const html: ThemedRoot = { classList: { contains: (name) => worn.has(name) } };
	return {
		html,
		watch: (changed: () => void) => {
			watchers.add(changed);
			return () => void watchers.delete(changed);
		},
		toggle(name: string, on: boolean) {
			if (on) worn.add(name);
			else worn.delete(name);
			for (const changed of watchers) changed();
		},
		watchers,
	};
}

describe("when the page leaves the material uncovered", () => {
	test("only while the app's shell is up, in a window that has the material", () => {
		expect(showsMaterial({ vibrancy: true }, true)).toBe(true);
		// Signing in, an invite, the app while it connects: nothing of the page is glass there.
		expect(showsMaterial({ vibrancy: true }, false)).toBe(false);
		expect(showsMaterial({ vibrancy: false }, true)).toBe(false);
		expect(showsMaterial({ vibrancy: false }, false)).toBe(false);
	});

	test("the layout says so on <html>, and lets go of its own background with it", () => {
		const layout = source("routes/+layout.svelte");
		expect(layout).toContain("const glass = $derived(showsMaterial(shell, appChrome.shellUp));");
		expect(layout).toContain("document.documentElement.classList.toggle(VIBRANT_CLASS, glass);");
		expect(layout).toContain("{glass ? '' : 'bg-duvet-sunk'}");
		// Its background is that one class: nothing else of the layout covers the window.
		expect(layout.match(/\bbg-duvet-[a-z0-9-]+/g)).toEqual(["bg-duvet-sunk"]);
	});

	test("<html> and <body> let go of theirs under that class, and only under it", () => {
		expect(VIBRANT_CLASS).toBe("duvet-vibrant");
		expect(css).toMatch(/html\.duvet-vibrant,\s*html\.duvet-vibrant body \{\s*background: transparent;\s*\}/);
		expect(css.match(/duvet-vibrant\b(?!-)/g)).toHaveLength(2);
		expect(css).toMatch(/\n\thtml \{[^}]*background: var\(--duvet-bg\);/);
		expect(css).toMatch(/\n\tbody \{\s*background: var\(--duvet-bg\);/);
	});

	// Before the shell, the app page is its own opaque screen, as every other page is under the layout's background.
	test("the app page covers the window while it connects", () => {
		const page = source("routes/app/+page.svelte");
		expect(page).toMatch(
			/\{#if !\$currentUser \|\| !\$friendsReady\}\s*<div class="bg-duvet-bg flex h-full items-center justify-center">/,
		);
		expect(page).toMatch(/appChrome\.shellUp = !!\$currentUser && \$friendsReady;/);
	});
});

describe("the shell over the material", () => {
	const page = source("routes/app/+page.svelte");

	test("paints no background of its own behind the sidebar's column where the sidebar is glass", () => {
		expect(page).toContain("const glass = shell.vibrancy;");
		expect(page).toMatch(
			/<div\s+class="text-duvet-ink grid h-full grid-rows-\[52px_minmax\(0,1fr\)\] overflow-hidden \{glass\s*\? ''\s*: 'bg-duvet-bg'\}/,
		);
	});

	test("the sidebar's column takes the vibrant tint, ring and blur there, for all it holds", () => {
		expect(page).toMatch(/: 'row-start-2'\} \{glass \? VIBRANT_SIDEBAR : ''\}"\s*onpointerenter/);
		expect(VIBRANT_SIDEBAR.split(" ")).toEqual([
			"[--duvet-sb-bg:var(--duvet-sb-bg-vibrant)]",
			"[--duvet-sb-ring:var(--duvet-sb-ring-vibrant)]",
			"[--duvet-sb-filter:var(--duvet-sb-filter-vibrant)]",
		]);
		// Each token it reads has a value in dark and in light.
		for (const [, token] of VIBRANT_SIDEBAR.matchAll(/var\((--duvet-[a-z-]+)\)/g)) {
			expect(css.match(new RegExp(`^\\s*${token}: `, "gm")), token).toHaveLength(2);
		}
	});

	// The sidebar and its folded edge are one tint over the material: neither paints anything else under it.
	test("the sidebar and its folded edge paint the sidebar's tint, which is what turns to glass", () => {
		expect(source("lib/components/SpaceNav.svelte")).toMatch(/<nav class="bg-duvet-sb-bg text-duvet-ink flex h-full /);
		expect(source("lib/components/SpaceEdge.svelte")).toMatch(/<div class="bg-duvet-sb-bg relative z-10 flex h-full /);
	});

	test("the title strip and the chats each paint the window's background, under their edge too", () => {
		expect(source("lib/components/TitleStrip.svelte")).toMatch(/<div\s+class="bg-duvet-bg text-duvet-ink relative /);
		// The main column's left edge is a 1 px line of its own border: with no background under it, the material
		// would show through that line, a seam beside the sidebar.
		expect(page).toContain(
			'<main class="border-duvet-line bg-duvet-bg col-start-2 row-start-2 flex min-h-0 min-w-0 border-l">',
		);
	});

	// Folded, the column shows over the chat, where the page itself is behind it: the page blurs that.
	test("the column shown over the chat blurs what it covers, by the sidebar's own filter", () => {
		expect(page).toMatch(/shadow-duvet-float absolute top-0 left-full [^`]*backdrop-filter-\(--duvet-sb-filter\)/);
		expect(css).toMatch(/--duvet-sb-filter: none;/);
	});

	// A solid color cut into the sidebar must be the ring's, which matches the glass; the tint itself is see-through.
	test("nothing in the sidebar uses its tint as a solid cut-out", () => {
		const lock = /<LockSimpleIcon\s+class="([^"]+)"/.exec(source("lib/components/ChannelsSidebar.svelte"))?.[1];
		expect(lock).toContain("bg-duvet-sb-ring");
		expect(lock).not.toContain("bg-duvet-sb-bg");
	});
});

describe("the theme the page wears", () => {
	test("is light under the light theme's class, dark without it", () => {
		expect(wornTheme(root().html)).toBe("dark");
		expect(wornTheme(root("duvet-light").html)).toBe("light");
		expect(wornTheme(root("duvet-vibrant").html)).toBe("dark");
	});

	test("is told at once, then on each change, once per change", () => {
		const page = root("duvet-light");
		const told: string[] = [];
		followWornTheme(page.html, (theme) => told.push(theme), page.watch);
		expect(told).toEqual(["light"]);
		page.toggle("duvet-light", false);
		// Another class changing says nothing new.
		page.toggle("duvet-vibrant", true);
		page.toggle("duvet-vibrant", false);
		page.toggle("duvet-light", true);
		expect(told).toEqual(["light", "dark", "light"]);
	});

	test("is no longer told once stopped", () => {
		const page = root();
		const told: string[] = [];
		const stop = followWornTheme(page.html, (theme) => told.push(theme), page.watch);
		stop();
		expect(page.watchers.size).toBe(0);
		page.toggle("duvet-light", true);
		expect(told).toEqual(["dark"]);
	});

	describe("on <html>", () => {
		const globals = globalThis as { MutationObserver?: unknown };
		const real = globals.MutationObserver;
		afterEach(() => {
			globals.MutationObserver = real;
		});

		test("its classes are watched, and nothing else of it", () => {
			const seen: { target: unknown; options: unknown; disconnected: boolean; changed: () => void }[] = [];
			globals.MutationObserver = class {
				private entry = { target: null as unknown, options: null as unknown, disconnected: false, changed: () => {} };
				constructor(changed: () => void) {
					this.entry.changed = changed;
					seen.push(this.entry);
				}
				observe(target: unknown, options: unknown) {
					Object.assign(this.entry, { target, options });
				}
				disconnect() {
					this.entry.disconnected = true;
				}
			};
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for <html>: only which object it is matters.
			const html = {} as Element;
			let changes = 0;
			const stop = watchClasses(html)(() => changes++);
			expect(seen).toHaveLength(1);
			expect(seen[0]?.target).toBe(html);
			expect(seen[0]?.options).toEqual({ attributes: true, attributeFilter: ["class"] });
			seen[0]?.changed();
			expect(changes).toBe(1);
			stop();
			expect(seen[0]?.disconnected).toBe(true);
		});
	});

	test("the layout tells Bun, in a window that has the material and in no other", () => {
		const layout = source("routes/+layout.svelte");
		expect(layout).toMatch(
			/const stopMaterial = shell\.vibrancy\s*\? followWornTheme\(\s*root,\s*\(theme\) => void getElectrobunRpc\(\)\.then\(\(rpc\) => rpc\?\.send\.windowTheme\(\{ theme \}\)\),\s*watchClasses\(root\),\s*\)\s*: \(\) => \{\};/,
		);
		expect(layout).toMatch(/stopTheme\(\);\s*stopMaterial\(\);/);
	});
});
