/* oxlint-disable typescript/no-unsafe-type-assertion -- a test's pointers are numbers it makes up or reads off the bridge. */
import { describe, expect, test } from "bun:test";
import type { Pointer } from "bun:ffi";

// The Objective-C bridge (appkit.ts) against Foundation's own objects: the same message sends, invocations and
// main-thread hops the app makes on its window, on objects a test can make. macOS only: elsewhere there's no runtime
// to load, and the app never imports it.
const onMac = process.platform === "darwin";

describe.skipIf(!onMac)("the Objective-C bridge", () => {
	const load = () => import("./appkit");
	/** A new NSObject, or an instance of another class without arguments. */
	const make = async (className: string) => {
		const { cls, msg } = await load();
		return msg(msg(cls(className), "alloc"), "init");
	};

	test("sends a message and gets an object back", async () => {
		const { cls, msg, nil } = await load();
		const array = await make("NSMutableArray");
		expect(array).not.toBe(nil);
		expect(msg(array, "class")).toBe(cls("__NSArrayM"));
	});

	test("says whether an object answers a selector, and nil never does", async () => {
		const { responds, nil } = await load();
		const array = await make("NSMutableArray");
		expect(responds(array, "addObject:")).toBe(true);
		expect(responds(array, "standardWindowButton:")).toBe(false);
		expect(responds(nil, "addObject:")).toBe(false);
	});

	// standardWindowButton: takes an integer and returns an object; setHidden: takes a BOOL.
	test("runs a message with an integer on the main thread and returns its object", async () => {
		const { onMain, nil } = await load();
		const array = await make("NSMutableArray");
		const first = await make("NSObject");
		const second = await make("NSObject");
		expect(onMain(array, "addObject:", [{ t: "id", v: first }])).toBe(nil);
		onMain(array, "addObject:", [{ t: "id", v: second }]);
		expect(onMain(array, "objectAtIndex:", [{ t: "int", v: 0 }], "id")).toBe(first);
		expect(onMain(array, "objectAtIndex:", [{ t: "int", v: 1 }], "id")).toBe(second);
	});

	test("carries a BOOL argument as one", async () => {
		const { cls, onMain } = await load();
		const yes = onMain(cls("NSNumber"), "numberWithBool:", [{ t: "bool", v: true }], "id");
		const no = onMain(cls("NSNumber"), "numberWithBool:", [{ t: "bool", v: false }], "id");
		// Foundation has one object for each boolean: the same ones every time, and not each other.
		expect(yes).toBe(onMain(cls("NSNumber"), "numberWithBool:", [{ t: "bool", v: true }], "id"));
		expect(no).not.toBe(yes);
	});

	test("refuses a selector the object doesn't have, rather than send it", async () => {
		const { onMain } = await load();
		const object = await make("NSObject");
		expect(() => onMain(object, "standardWindowButton:", [{ t: "int", v: 0 }], "id")).toThrow(
			"the object doesn't respond to standardWindowButton:",
		);
	});

	// What the app is handed may not be what this expects (another renderer's view, a later Electrobun): nothing is
	// sent to an object that wouldn't take it.
	test("leaves alone a window or a view that isn't one", async () => {
		const { addSidebarMaterial, focusWebview, hideWindowButtons, setViewTheme, nil } = await load();
		const notAWindow = Number(await make("NSObject")) as Pointer;
		const notAView = Number(await make("NSObject")) as Pointer;
		expect(() => hideWindowButtons(notAWindow)).not.toThrow();
		expect(() => focusWebview(notAWindow, notAView)).not.toThrow();
		expect(() => focusWebview(0 as Pointer, 0 as Pointer)).not.toThrow();
		expect(addSidebarMaterial(notAWindow)).toBe(nil);
		expect(addSidebarMaterial(0 as Pointer)).toBe(nil);
		expect(() => setViewTheme(BigInt(notAView), "dark")).not.toThrow();
		expect(() => setViewTheme(nil, "light")).not.toThrow();
	});

	// initWithFrame: takes an NSRect, and bounds and frame return one.
	test("carries a rectangle as an argument, and reads one back", async () => {
		const { cls, msg, onMain, rectOnMain } = await load();
		const frame = { x: 12, y: 34, width: 560, height: 78.5 };
		const view = onMain(msg(cls("NSView"), "alloc"), "initWithFrame:", [{ t: "rect", v: frame }], "id");
		expect(rectOnMain(view, "frame")).toEqual(frame);
		expect(rectOnMain(view, "bounds")).toEqual({ x: 0, y: 0, width: 560, height: 78.5 });
	});

	// #374. An NSBox stands for the window: like one it has a content view, and unlike one it needs no window server.
	describe("the sidebar's material", () => {
		const boxWithAView = async () => {
			const { cls, msg, onMain } = await load();
			const box = onMain(
				msg(cls("NSBox"), "alloc"),
				"initWithFrame:",
				[{ t: "rect", v: { x: 0, y: 0, width: 640, height: 480 } }],
				"id",
			);
			const content = msg(box, "contentView");
			// What the window already holds: the web view, in the app.
			const page = onMain(msg(cls("NSView"), "alloc"), "initWithFrame:", [{ t: "rect", v: rectOf(content) }], "id");
			onMain(content, "addSubview:", [{ t: "id", v: page }]);
			return { box, content, page };
		};
		let rectOf: (view: bigint) => { x: number; y: number; width: number; height: number };

		test("goes under everything the window holds, as large as its content", async () => {
			const { addSidebarMaterial, cls, msg, onMain, rectOnMain, nil } = await load();
			rectOf = (view) => rectOnMain(view, "bounds");
			const { box, content, page } = await boxWithAView();
			const material = addSidebarMaterial(Number(box) as Pointer);
			expect(material).not.toBe(nil);
			expect(msg(material, "class")).toBe(cls("NSVisualEffectView"));
			const subviews = msg(content, "subviews");
			expect(onMain(subviews, "objectAtIndex:", [{ t: "int", v: 0 }], "id")).toBe(material);
			expect(onMain(subviews, "objectAtIndex:", [{ t: "int", v: 1 }], "id")).toBe(page);
			expect(rectOnMain(material, "frame")).toEqual(rectOnMain(content, "bounds"));
		});

		test("wears the theme it is given, whatever the system's", async () => {
			const { addSidebarMaterial, cls, msg, nsString, rectOnMain, setViewTheme, nil } = await load();
			rectOf = (view) => rectOnMain(view, "bounds");
			const { box } = await boxWithAView();
			const material = addSidebarMaterial(Number(box) as Pointer);
			const named = (name: string) => msg(cls("NSAppearance"), "appearanceNamed:", nsString(name));
			// Until told, it has none of its own: the window's, which is the system's.
			expect(msg(material, "appearance")).toBe(nil);
			setViewTheme(material, "dark");
			expect(msg(material, "appearance")).toBe(named("NSAppearanceNameDarkAqua"));
			setViewTheme(material, "light");
			expect(msg(material, "appearance")).toBe(named("NSAppearanceNameAqua"));
			expect(named("NSAppearanceNameAqua")).not.toBe(named("NSAppearanceNameDarkAqua"));
		});
	});
});

test.skipIf(onMac)("off macOS the bridge isn't loaded: the app imports it on macOS only", () => {
	expect(process.platform).not.toBe("darwin");
});
