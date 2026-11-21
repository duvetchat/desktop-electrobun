import { describe, expect, test } from "bun:test";
import {
	defaultMenuOf,
	withoutLongPress,
	isMenuKey,
	KeyMenuEcho,
	keyMenuPoint,
	LINK,
	MEDIA,
	onRects,
	readTarget,
	searchLabel,
	TEXT_FIELD,
	type MenuAbilities,
	type MenuTarget,
} from "./default-menu";

const NOTHING: MenuTarget = { textField: false, selection: "", messageId: null, link: null, media: null };
const EVERYTHING: MenuAbilities = { quote: () => true, search: true, app: true, devTools: false };
const ids = (menu: ReturnType<typeof defaultMenuOf>) =>
	menu === null || menu === "native" ? menu : menu.map((group) => group.map((item) => item.id));

describe("the default menu of what's under the pointer", () => {
	test("a text field keeps the webview's own menu, whatever else is there", () => {
		expect(defaultMenuOf({ ...NOTHING, textField: true }, EVERYTHING)).toBe("native");
		expect(
			defaultMenuOf({ ...NOTHING, textField: true, selection: "hi", link: "https://a.example/" }, EVERYTHING),
		).toBe("native");
	});

	test("anywhere else with nothing to act on, no menu at all", () => {
		expect(defaultMenuOf(NOTHING, EVERYTHING)).toBeNull();
	});

	test("a development build's main window has DevTools there, and at the bottom of any other menu", () => {
		const dev = { ...EVERYTHING, devTools: true };
		expect(ids(defaultMenuOf(NOTHING, dev))).toEqual([["devtools"]]);
		expect(ids(defaultMenuOf({ ...NOTHING, link: "https://a.example/" }, dev))).toEqual([
			["open-link", "copy-link"],
			["devtools"],
		]);
	});

	test("selected text in a message: Copy, Quote in reply and Search Duvet, with its text", () => {
		const menu = defaultMenuOf({ ...NOTHING, selection: "hello there", messageId: "m1" }, EVERYTHING);
		expect(ids(menu)).toEqual([["copy-selection", "quote", "search"]]);
		expect(menu !== null && menu !== "native" ? menu[0] : []).toEqual([
			{ id: "copy-selection" },
			{ id: "quote", messageId: "m1", text: "hello there" },
			{ id: "search", text: "hello there" },
		]);
	});

	test("Quote in reply only for a message a chat's list can reply to, and Search only where there's a search", () => {
		const selected = { ...NOTHING, selection: "hello", messageId: "m1" };
		expect(ids(defaultMenuOf(selected, { ...EVERYTHING, quote: () => false }))).toEqual([["copy-selection", "search"]]);
		expect(ids(defaultMenuOf({ ...selected, messageId: null }, EVERYTHING))).toEqual([["copy-selection", "search"]]);
		expect(ids(defaultMenuOf(selected, { ...EVERYTHING, quote: () => false, search: false }))).toEqual([
			["copy-selection"],
		]);
	});

	test("a link: Open link and Copy link; Open only where the app's Bun side opens it", () => {
		const link = { ...NOTHING, link: "https://a.example/page" };
		expect(defaultMenuOf(link, EVERYTHING)).toEqual([
			[
				{ id: "open-link", href: "https://a.example/page" },
				{ id: "copy-link", href: "https://a.example/page" },
			],
		]);
		expect(ids(defaultMenuOf(link, { ...EVERYTHING, app: false }))).toEqual([["copy-link"]]);
	});

	test("a picture: Open, Copy image and its link; a video: Open and its link", () => {
		const image = { ...NOTHING, media: { type: "image" as const, src: "https://api.example/a.png" } };
		expect(defaultMenuOf(image, EVERYTHING)).toEqual([
			[
				{ id: "open-media", type: "image", src: "https://api.example/a.png" },
				{ id: "copy-image", src: "https://api.example/a.png" },
				{ id: "copy-media-link", type: "image", src: "https://api.example/a.png" },
			],
		]);
		const video = { ...NOTHING, media: { type: "video" as const, src: "https://api.example/a.mp4" } };
		expect(ids(defaultMenuOf(video, EVERYTHING))).toEqual([["open-media", "copy-media-link"]]);
		// Copying a picture and opening anything go through the app's Bun side.
		expect(ids(defaultMenuOf(image, { ...EVERYTHING, app: false }))).toEqual([["copy-media-link"]]);
	});

	test("what's under the pointer at once has each of its groups: the selection, then the link, then the picture", () => {
		const all = {
			...NOTHING,
			selection: "a caption",
			link: "https://a.example/",
			media: { type: "image" as const, src: "https://a.example/a.png" },
		};
		expect(ids(defaultMenuOf(all, { ...EVERYTHING, quote: () => false, devTools: true }))).toEqual([
			["copy-selection", "search"],
			["open-link", "copy-link"],
			["open-media", "copy-image", "copy-media-link"],
			["devtools"],
		]);
	});

	test("Search Duvet names the selection, cut short and on one line", () => {
		expect(searchLabel("hello")).toBe("Search Duvet for “hello”");
		expect(searchLabel("  two\n\nlines  ")).toBe("Search Duvet for “two lines”");
		expect(searchLabel("x".repeat(40))).toBe(`Search Duvet for “${"x".repeat(28)}…”`);
	});
});

// An element as readTarget reads it: what each of the menu's selectors finds around it, and its attributes. A real
// element's closest() runs the selector; here each selector the menu uses has its answer.
class Fake {
	constructor(
		private attrs: Record<string, string> = {},
		private around: Partial<Record<string, Fake>> = {},
		readonly currentSrc = "",
	) {}
	closest(selector: string): Fake | null {
		return this.around[selector] ?? null;
	}
	getAttribute(name: string): string | null {
		return this.attrs[name] ?? null;
	}
	hasAttribute(name: string): boolean {
		return name in this.attrs;
	}
	get classList() {
		const names = (this.attrs.class ?? "").split(/\s+/);
		return { contains: (name: string) => names.includes(name) };
	}
	get tagName() {
		return (this.attrs["#tag"] ?? "div").toUpperCase();
	}
}

const APP = "views://mainview";

describe("reading what a right-click is on", () => {
	test("in a text field", () => {
		const field = new Fake({ "#tag": "textarea" });
		const inside = new Fake({}, { [TEXT_FIELD]: field });
		expect(readTarget(inside, null, APP).textField).toBe(true);
		expect(readTarget(new Fake(), null, APP).textField).toBe(false);
	});

	test("in a link: its address as the browser opens it, never the app's own pages nor another scheme", () => {
		const at = (href: string) => readTarget(new Fake({}, { [LINK]: new Fake({ href }) }), null, APP).link;
		expect(at("https://a.example/x")).toBe("https://a.example/x");
		expect(at("mailto:a@b.example")).toBe("mailto:a@b.example");
		expect(at("/app")).toBeNull();
		expect(at("javascript:alert(1)")).toBeNull();
	});

	test("on a picture or a video from the network, not on an emoji or a picture of the app's own", () => {
		const on = (attrs: Record<string, string>, src: string) =>
			readTarget(new Fake({}, { [MEDIA]: new Fake(attrs, {}, src) }), null, APP).media;
		expect(on({ "#tag": "img" }, "https://api.example/a.png")).toEqual({
			type: "image",
			src: "https://api.example/a.png",
		});
		expect(on({ "#tag": "video" }, "https://api.example/a.mp4")).toEqual({
			type: "video",
			src: "https://api.example/a.mp4",
		});
		expect(on({ "#tag": "img", class: "emoji-img" }, "https://cdn.example/1f600.png")).toBeNull();
		expect(on({ "#tag": "img" }, "views://mainview/mascot.svg")).toBeNull();
		expect(on({ "#tag": "img" }, "data:image/png;base64,AAAA")).toBeNull();
		expect(on({ "#tag": "img" }, "")).toBeNull();
	});

	test("on the selected text: its text and the message holding it", () => {
		const target = readTarget(new Fake(), { text: "  hi  ", messageId: "m1" }, APP);
		expect(target.selection).toBe("hi");
		expect(target.messageId).toBe("m1");
		expect(readTarget(new Fake(), { text: " \n ", messageId: "m1" }, APP).selection).toBe("");
	});

	test("nothing for a target that isn't an element", () => {
		expect(readTarget(null, null, APP)).toEqual(NOTHING);
	});
});

describe("a list's one menu, for the row right-clicked", () => {
	test("opens on the menu event alone: bits-ui's long press would open it for the row picked before", () => {
		const ref = Symbol("ref");
		const props = {
			id: "menu",
			oncontextmenu: () => {},
			onpointerdown: () => {},
			onpointermove: () => {},
			onpointercancel: () => {},
			onpointerup: () => {},
			[ref]: () => {},
		};
		const kept = withoutLongPress(props);
		expect(Object.keys(kept)).toEqual(["id", "oncontextmenu"]);
		// The trigger's own reference, which bits-ui keeps under a symbol, stays.
		expect(kept[ref]).toBe(props[ref]);
	});
});

describe("whether a right-click is on the selection", () => {
	const rects = [
		{ left: 10, top: 10, right: 50, bottom: 20 },
		{ left: 0, top: 20, right: 30, bottom: 30 },
	];
	test("on one of its rectangles, edges included", () => {
		expect(onRects(rects, 10, 10)).toBe(true);
		expect(onRects(rects, 30, 30)).toBe(true);
		expect(onRects(rects, 40, 25)).toBe(false);
		expect(onRects([], 0, 0)).toBe(false);
	});
});

describe("the keyboard's way to the menu", () => {
	const key = (k: string, mods: Partial<Parameters<typeof isMenuKey>[0]> = {}) =>
		isMenuKey({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods });

	test("Shift+F10 and the context-menu key open it, and no other key", () => {
		expect(key("ContextMenu")).toBe(true);
		expect(key("F10", { shiftKey: true })).toBe(true);
		expect(key("F10")).toBe(false);
		expect(key("F10", { shiftKey: true, ctrlKey: true })).toBe(false);
		expect(key("ContextMenu", { altKey: true })).toBe(false);
		expect(key("Enter")).toBe(false);
	});

	test("a menu the keyboard opens goes to its element's bottom left, kept inside the window", () => {
		const view = { width: 800, height: 600 };
		expect(keyMenuPoint({ left: 100, bottom: 140 }, view)).toEqual({ x: 100, y: 140 });
		expect(keyMenuPoint({ left: -20, bottom: 900 }, view)).toEqual({ x: 0, y: 599 });
	});

	test("the webview's own menu event after a key that opened the menu isn't a second menu, once", () => {
		const echo = new KeyMenuEcho();
		expect(echo.takes(0)).toBe(false);
		echo.opened(1000);
		expect(echo.takes(1500)).toBe(true);
		expect(echo.takes(1600)).toBe(false);
		echo.opened(2000);
		// Too late to be its echo: a right-click of the user's own.
		expect(echo.takes(2000 + KeyMenuEcho.WITHIN_MS + 1)).toBe(false);
		echo.opened(5000);
		// A right press since is the user's own right-click.
		echo.pressed();
		expect(echo.takes(5100)).toBe(false);
	});
});
