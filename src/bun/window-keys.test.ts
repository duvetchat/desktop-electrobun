/* oxlint-disable typescript/no-unsafe-type-assertion -- a test's pointers are numbers it makes up or reads off the bridge. */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Pointer } from "bun:ffi";
import { keepKeysReachingThePage, mainWindowTitleBar, type AppKit, type KeyWindow } from "./window-keys";

const pointer = (address: number) => address as Pointer;

/** A window as Electrobun hands it, with what listens to it, and an AppKit that notes what it's asked. */
function fixture() {
	const windowHandlers = new Map<string, (event: unknown) => void>();
	const viewHandlers = new Map<string, (event: unknown) => void>();
	const asked: string[] = [];
	const window: KeyWindow = {
		ptr: pointer(0x1000),
		on: (name, handler) => void windowHandlers.set(name, handler),
		webview: { ptr: pointer(0x2000), on: (name, handler) => void viewHandlers.set(name, handler) },
	};
	const appkit: AppKit = {
		focusWebview: (win, view) => asked.push(`focus ${Number(win).toString(16)} ${Number(view).toString(16)}`) > 0,
		hideWindowButtons: (win) => (asked.push(`hide ${Number(win).toString(16)}`), 3),
	};
	return { window, appkit, asked, windowHandlers, viewHandlers };
}

// macOS 27: a window without a title bar can't become key, so no key reached the page (PLATFORM.md §12).
describe("the main window's title bar", () => {
	test("on macOS is one the window can be key with: there, and showing nothing", () => {
		expect(mainWindowTitleBar("darwin")).toBe("hiddenInset");
	});

	test("on Windows and Linux stays hidden, as it was", () => {
		expect(mainWindowTitleBar("win32")).toBe("hidden");
		expect(mainWindowTitleBar("linux")).toBe("hidden");
	});
});

describe("keeping keys reaching the page", () => {
	let said: ReturnType<typeof spyOn>;
	beforeEach(() => {
		said = spyOn(console, "log").mockImplementation(() => {});
	});
	afterEach(() => said.mockRestore());

	test("says once, as the app starts, what it did", () => {
		const { window, appkit } = fixture();
		keepKeysReachingThePage(window, appkit, { nativeButtons: false });
		expect(said.mock.calls).toEqual([
			["[window] macOS: the web view is asked to take the keyboard; 3 of the system's window buttons hidden"],
		]);
	});

	test("gives the page the keyboard at once, when a page loads, and each time the window becomes key", () => {
		const { window, appkit, asked, windowHandlers, viewHandlers } = fixture();
		keepKeysReachingThePage(window, appkit, { nativeButtons: true });
		expect(asked).toEqual(["focus 1000 2000"]);
		viewHandlers.get("dom-ready")!(undefined);
		windowHandlers.get("focus")!(undefined);
		windowHandlers.get("focus")!(undefined);
		expect(asked).toEqual(["focus 1000 2000", "focus 1000 2000", "focus 1000 2000", "focus 1000 2000"]);
	});

	test("hides the system's buttons while the page draws its own, before anything else", () => {
		const { window, appkit, asked } = fixture();
		keepKeysReachingThePage(window, appkit, { nativeButtons: false });
		expect(asked).toEqual(["hide 1000", "focus 1000 2000"]);
	});

	test("leaves the system's buttons when they're the window's", () => {
		const { window, appkit, asked } = fixture();
		keepKeysReachingThePage(window, appkit, { nativeButtons: true });
		expect(asked.filter((ask) => ask.startsWith("hide"))).toEqual([]);
	});

	test("does nothing off macOS, where there's no AppKit: it doesn't even listen", () => {
		const { window, asked, windowHandlers, viewHandlers } = fixture();
		keepKeysReachingThePage(window, null, { nativeButtons: false });
		expect(asked).toEqual([]);
		expect(windowHandlers.size + viewHandlers.size).toBe(0);
	});

	// An exception in Electrobun's Bun worker ends the app: AppKit failing must not.
	test("a failure of AppKit's is logged, and the app goes on", () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const { window, windowHandlers } = fixture();
			const failing: AppKit = {
				focusWebview: () => {
					throw new Error("no web view");
				},
				hideWindowButtons: () => {
					throw new Error("no buttons");
				},
			};
			expect(() => keepKeysReachingThePage(window, failing, { nativeButtons: false })).not.toThrow();
			expect(() => windowHandlers.get("focus")!(undefined)).not.toThrow();
			expect(logged).toHaveBeenCalledTimes(3);
		} finally {
			logged.mockRestore();
		}
	});
});
