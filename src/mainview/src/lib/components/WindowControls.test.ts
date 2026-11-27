import { describe, expect, mock, test } from "bun:test";
import { createRawSnippet } from "svelte";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Shell } from "$lib/platform";
import en from "../../../messages/en.json";
import { tags } from "./server-render";

// The window's own buttons (#357, S-01). On Windows and Linux no window of the app has the system's: the main window,
// Settings, a Space's settings and the media controls' pop-out each draw theirs, and a button nothing answers leaves a
// window that can't be minimized, maximized or closed with the mouse. The Settings windows once drew three such
// buttons, found by an ID nothing looked up any more: every window's buttons are WindowControls' now.

const SRC = join(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");
const under = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? under(join(dir, entry.name)) : [join(dir, entry.name)],
	);
/** Every component and page, by its path under src. */
const COMPONENTS = under(SRC)
	.filter((path) => path.endsWith(".svelte"))
	.map((path) => relative(SRC, path).split(sep).join("/"))
	.toSorted((a, b) => a.localeCompare(b));

// The shell the components read, which each test sets before it renders.
let shell: Shell;
const shellOf = (chrome: Shell["chrome"], nativeTrafficLights = chrome === "mac"): Shell => ({
	chrome,
	os: chrome === "web" ? "other" : chrome,
	window: "settings",
	nativeTrafficLights,
	ownWindowControls: chrome !== "web" && !nativeTrafficLights,
	draggableTitleBar: chrome !== "web",
	settingsInWindows: false,
	popOut: chrome !== "web",
	vibrancy: false,
	preview: false,
});
mock.module("$lib/platform", () => ({ currentShell: () => shell }));
const { default: WindowControls } = await import("./WindowControls.svelte");
const { default: SettingsFrame } = await import("./settings/SettingsFrame.svelte");

const FUNCTION_OF: Record<string, string> = {
	"Minimize window": "minimizeWindow",
	"Maximize window": "maximizeWindow",
	"Close window": "closeWindow",
};
const LABELS = Object.keys(FUNCTION_OF);

/** Each opening tag of a component's source that draws a control, whole. */
const controlTags = (source: string) => [...source.matchAll(/<(?:button|IconButton|Button)\b[^>]*>/g)].map((m) => m[0]);
/** A control's name: as written, or its message's English, from en.json (#464). */
const english: Record<string, string> = en;
const labelOf = (tag: string) => {
	const key = /\b(?:aria-label|label)=\{t\("(\w+)"\)\}/.exec(tag)?.[1];
	if (key) return english[key] ?? null;
	return /\b(?:aria-label|label)="([^"]*)"/.exec(tag)?.[1] ?? null;
};

describe("the window's buttons", () => {
	test("each one calls its function of lib/window-controls.ts", () => {
		const source = read("lib/components/WindowControls.svelte");
		expect(source).toContain('import { closeWindow, maximizeWindow, minimizeWindow } from "$lib/window-controls";');
		const buttons = controlTags(source);
		// Three for each system that draws its own: macOS's drawn lights, Windows' and Linux's.
		const sorted = (labels: (string | null)[]) => labels.map(String).toSorted((a, b) => a.localeCompare(b));
		expect(sorted(buttons.map(labelOf))).toEqual(sorted([...LABELS, ...LABELS, ...LABELS]));
		for (const button of buttons) {
			expect(button).toContain(`onclick={${FUNCTION_OF[labelOf(button) ?? ""]}}`);
		}
	});

	test("they are drawn at the end on Windows and Linux, and nowhere where macOS draws its own", async () => {
		const labels = async (side: "start" | "end") =>
			(await tags(WindowControls, { side })).map((tag) => tag.attributes["aria-label"]).filter(Boolean);
		for (const chrome of ["windows", "linux"] as const) {
			shell = shellOf(chrome);
			expect(await labels("start")).toEqual([]);
			expect(await labels("end")).toEqual(LABELS);
		}
		shell = shellOf("mac");
		expect([await labels("start"), await labels("end")]).toEqual([[], []]);
		// A macOS window without the system's lights draws them, in their corner and their order.
		shell = shellOf("mac", false);
		expect(await labels("start")).toEqual(["Close window", "Minimize window", "Maximize window"]);
		shell = shellOf("web");
		expect([await labels("start"), await labels("end")]).toEqual([[], []]);
	});

	test("no other component draws one that does nothing", () => {
		const found: string[] = [];
		for (const path of COMPONENTS) {
			if (path === "lib/components/WindowControls.svelte") continue;
			for (const tag of controlTags(read(path))) {
				if (!LABELS.includes(labelOf(tag) ?? "")) continue;
				found.push(path);
				expect(tag).toMatch(/\bonclick=\{/);
			}
		}
		// The pop-out's close puts the controls back in the sidebar (Bun closes the window): its own function.
		expect(found).toEqual(["routes/voice-controls/+page.svelte"]);
	});
});

describe("a Settings window's chrome", () => {
	const snippet = (html: string) => createRawSnippet(() => ({ render: () => html }));
	const frame = (chrome: Shell["chrome"]) => {
		shell = shellOf(chrome);
		return tags(SettingsFrame, {
			mode: "window",
			chrome,
			name: "Duvet settings",
			groups: [],
			active: "account",
			head: snippet("<p>head</p>"),
			children: snippet("<p>page</p>"),
		});
	};
	const labels = (all: Awaited<ReturnType<typeof frame>>) =>
		all.map((tag) => tag.attributes["aria-label"]).filter((label) => LABELS.includes(label ?? ""));

	test("on Windows and Linux its title bar has the shell's own minimize, maximize and close", async () => {
		for (const chrome of ["windows", "linux"] as const) {
			const all = await frame(chrome);
			expect(labels(all)).toEqual(LABELS);
			expect(all.some((tag) => "data-title-bar" in tag.attributes)).toBe(true);
		}
		const source = read("lib/components/settings/SettingsFrame.svelte");
		expect(source).toContain('<WindowControls side="end" />');
		// None of its own: the three it once drew carried IDs nothing looked up.
		expect(source).not.toMatch(/window-(minimize|maximize|close)/);
	});

	test("on macOS the system's lights are the window's buttons: the page draws none, and no title bar", async () => {
		const all = await frame("mac");
		expect(labels(all)).toEqual([]);
		expect(all.some((tag) => "data-title-bar" in tag.attributes)).toBe(false);
	});

	test("every strip that drags the window is a region of its own, in each system's chrome", async () => {
		// macOS: the lights' strip and the toolbar. Windows and Linux: the title bar and the toolbar.
		for (const chrome of ["mac", "windows", "linux"] as const) {
			const regions = (await frame(chrome)).filter((tag) => "data-drag-region" in tag.attributes);
			expect(regions).toHaveLength(2);
			for (const region of regions) expect(region.name).toBe("div");
		}
	});
});

// The pop-out has one button of the window's own, its close, wherever the system draws none (C-21).
test("the pop-out draws its close where the system draws none, and it puts the controls back", () => {
	const page = read("routes/voice-controls/+page.svelte").replace(/\s+/g, " ");
	expect(page).toMatch(
		/\{#if shell\.ownWindowControls\} <IconButton size="sm" label=\{t\("call_close_window"\)\} onclick=\{putBack\}> .*? <\/IconButton> \{\/if\}/,
	);
	// Put back asks Bun, which closes the window; if Bun doesn't take it, the window is closed all the same.
	expect(page).toContain('aboutWindow("putBack").catch(() => rpc?.send.closeWindow())');
});

// Electrobun's preload starts a window move on a press anywhere inside an element with its drag class
// (node_modules/electrobun: preload/dragRegions.ts reads target.closest), and knows no class that takes a control back
// out. A button inside such an element moves the window as it is pressed, so the class is DragRegion's alone, which
// has no children: a region lies beside or under what shares its line.
test("only DragRegion carries Electrobun's drag class, and it wraps nothing", () => {
	const carriers = COMPONENTS.filter((path) => read(path).includes("app-region"));
	expect(carriers).toEqual(["lib/components/DragRegion.svelte"]);
	const region = read("lib/components/DragRegion.svelte");
	expect(region).not.toContain("children");
	// Its whole markup is one empty element.
	const markup = region.slice(region.indexOf("</script>") + "</script>".length).trim();
	expect(markup).toMatch(/^<div\s[^<]*electrobun-webkit-app-region-drag[^<]*><\/div>$/);
});
