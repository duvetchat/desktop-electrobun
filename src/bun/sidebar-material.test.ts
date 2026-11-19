/* oxlint-disable typescript/no-unsafe-type-assertion -- a test's pointers are numbers it makes up. */
import { describe, expect, test } from "bun:test";
import type { Pointer } from "bun:ffi";
import { hasSidebarMaterial, parseWindowTheme, SidebarMaterial, type MaterialKit } from "./sidebar-material";

// The sidebar's glass on macOS (#374): the system's material behind the main window's page, in the page's theme.
const WINDOW = 0x1000 as Pointer;
const VIEW = 0x2000n;

/** AppKit's part, recorded: which windows got a material, and which theme each view was given. */
function kit(options: { view?: bigint; failAdd?: boolean; failTheme?: boolean } = {}) {
	const added: Pointer[] = [];
	const themes: [view: bigint, theme: string][] = [];
	const appkit: MaterialKit = {
		addSidebarMaterial(window) {
			if (options.failAdd) throw new Error("no AppKit");
			added.push(window);
			return options.view ?? VIEW;
		},
		setViewTheme(view, theme) {
			if (options.failTheme) throw new Error("no appearance");
			themes.push([view, theme]);
		},
	};
	const lines: string[] = [];
	const material = new SidebarMaterial(appkit, (line) => lines.push(line));
	return { appkit, added, themes, lines, material };
}

describe("which window gets the material", () => {
	test("macOS's, with AppKit's bridge loaded", () => {
		expect(hasSidebarMaterial("darwin", kit().appkit)).toBe(true);
	});

	test("none without the bridge: the page is told the sidebar is solid", () => {
		expect(hasSidebarMaterial("darwin", null)).toBe(false);
	});

	test("none on Windows or Linux, whatever is loaded", () => {
		expect(hasSidebarMaterial("win32", kit().appkit)).toBe(false);
		expect(hasSidebarMaterial("linux", kit().appkit)).toBe(false);
	});
});

describe("the page's theme", () => {
	test("is light or dark, as the page's message names it", () => {
		expect(parseWindowTheme({ theme: "light" })).toBe("light");
		expect(parseWindowTheme({ theme: "dark" })).toBe("dark");
	});

	test("is nothing for anything else a page could send", () => {
		for (const message of [undefined, null, "dark", 1, {}, { theme: "system" }, { theme: 1 }, { scheme: "dark" }]) {
			expect(parseWindowTheme(message)).toBeNull();
		}
	});
});

describe("the sidebar's material", () => {
	test("goes behind the window's page once, and says it is there", () => {
		const { material, added, lines } = kit();
		expect(material.add(WINDOW)).toBe(true);
		expect(material.add(WINDOW)).toBe(true);
		expect(added).toEqual([WINDOW]);
		expect(lines).toEqual(["[window] macOS: the sidebar's material is behind the page"]);
	});

	test("takes the theme the page wears, once per change", () => {
		const { material, themes } = kit();
		material.add(WINDOW);
		material.themed({ theme: "light" });
		material.themed({ theme: "light" });
		material.themed({ theme: "dark" });
		expect(themes).toEqual([
			[VIEW, "light"],
			[VIEW, "dark"],
		]);
	});

	// Until the page says, the material follows the system's appearance, as the page does while its pick is System.
	test("is given no theme before the page names one", () => {
		const { material, themes } = kit();
		material.add(WINDOW);
		material.themed({ theme: "sepia" });
		material.themed(null);
		expect(themes).toEqual([]);
	});

	test("takes a theme named before it was there as soon as it is", () => {
		const { material, themes } = kit();
		material.themed({ theme: "light" });
		expect(themes).toEqual([]);
		material.add(WINDOW);
		expect(themes).toEqual([[VIEW, "light"]]);
	});

	test("a window that takes none has none, and no theme is sent to nothing", () => {
		const { material, themes, lines } = kit({ view: 0n });
		expect(material.add(WINDOW)).toBe(false);
		material.themed({ theme: "dark" });
		expect(themes).toEqual([]);
		expect(lines).toEqual(["[window] macOS: the sidebar's material isn't behind the page"]);
	});

	// The app goes on either way: a window without the material shows its own background under the sidebar's tint.
	test("a failure in AppKit is logged, and nothing is thrown", () => {
		const failing = kit({ failAdd: true });
		expect(failing.material.add(WINDOW)).toBe(false);
		expect(failing.lines).toEqual(["[window] couldn't put the sidebar's material behind the page:"]);

		const themeless = kit({ failTheme: true });
		themeless.material.add(WINDOW);
		expect(() => themeless.material.themed({ theme: "dark" })).not.toThrow();
		expect(themeless.lines.at(-1)).toBe("[window] couldn't give the sidebar's material the page's theme:");
	});

	test("without AppKit's bridge it does nothing at all", () => {
		const material = new SidebarMaterial(null, () => {
			throw new Error("nothing to say");
		});
		expect(material.add(WINDOW)).toBe(false);
		expect(() => material.themed({ theme: "dark" })).not.toThrow();
	});
});
