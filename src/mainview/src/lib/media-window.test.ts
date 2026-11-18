import { describe, expect, test } from "bun:test";
import { DOCKED, isAppPage, parseWish, popOutStep, type PopOutState } from "$lib/media-window";

// The media controls' pop-out (#357): where the controls are, and what the main window asks of Bun.
const out: PopOutState = popOutStep(DOCKED, "popOut");

describe("popping the controls out and back", () => {
	test("they start in the sidebar, with no window wanted", () => {
		expect(DOCKED).toEqual({ out: false, wish: { open: false, shown: 0 } });
	});

	test("Pop out asks for the window, and the sidebar shows its slim row", () => {
		expect(out).toEqual({ out: true, wish: { open: true, shown: 0 } });
	});

	test("Put back docks them again and asks for the window to go", () => {
		expect(popOutStep(out, "putBack")).toEqual({ out: false, wish: { open: false, shown: 0 } });
	});

	test("a window that closed by itself docks them too: its button, or Put back inside it", () => {
		expect(popOutStep(out, "closed")).toEqual({ out: false, wish: { open: false, shown: 0 } });
	});

	test("the slim row brings the window to the front, each time it is pressed", () => {
		const once = popOutStep(out, "show");
		const twice = popOutStep(once, "show");
		expect(once.wish).toEqual({ open: true, shown: 1 });
		expect(twice.wish).toEqual({ open: true, shown: 2 });
		expect(twice.out).toBe(true);
	});

	test("Pop out while they're out brings the window to the front instead of asking twice", () => {
		expect(popOutStep(out, "popOut")).toEqual({ out: true, wish: { open: true, shown: 1 } });
	});

	test("nothing happens to docked controls that are shown, put back or told of a close", () => {
		expect(popOutStep(DOCKED, "show")).toBe(DOCKED);
		expect(popOutStep(DOCKED, "putBack")).toBe(DOCKED);
		expect(popOutStep(DOCKED, "closed")).toBe(DOCKED);
	});

	test("out and back any number of times ends where it started, but for the asks to show", () => {
		let state = DOCKED;
		for (let i = 0; i < 5; i++) state = popOutStep(popOutStep(popOutStep(state, "popOut"), "show"), "putBack");
		expect(state).toEqual({ out: false, wish: { open: false, shown: 5 } });
	});
});

describe("a wish that crossed the RPC", () => {
	test("comes back as it was sent", () => {
		expect(parseWish(JSON.parse(JSON.stringify(out.wish)))).toEqual(out.wish);
	});

	test("anything else is no wish", () => {
		for (const value of [null, "open", {}, { open: "yes", shown: 0 }, { open: true }, { open: true, shown: "1" }])
			expect(parseWish(value)).toBeNull();
	});
});

describe("the app's own page", () => {
	test("is app.html in the packaged app and /app under the dev server", () => {
		expect(isAppPage("views://mainview/app.html")).toBe(true);
		expect(isAppPage("http://localhost:5173/app")).toBe(true);
		expect(isAppPage("http://localhost:5173/app?shell=mac")).toBe(true);
	});

	test("isn't the sign-in page, another page, or no address at all", () => {
		expect(isAppPage("views://mainview/sign-in.html")).toBe(false);
		expect(isAppPage("views://mainview/voice-controls.html")).toBe(false);
		expect(isAppPage("http://localhost:5173/sign-in")).toBe(false);
		expect(isAppPage("views://mainview/apps.html")).toBe(false);
		expect(isAppPage("")).toBe(false);
	});
});
