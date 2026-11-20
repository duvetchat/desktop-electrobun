/* oxlint-disable typescript/no-unsafe-type-assertion -- a test's pointers are numbers it makes up or reads off the bridge. */
import { describe, expect, test } from "bun:test";
import { CString, type Pointer } from "bun:ffi";

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

	// setMinSize: takes an NSSize, two doubles by value: an NSImage is made with one the same way, and says it back.
	// (Its init hands back an object the test owns: one only autoreleased is gone once onMain's pool is.)
	test("carries a size argument as one", async () => {
		const { cls, msg, onMain } = await load();
		const image = onMain(
			msg(cls("NSImage"), "alloc"),
			"initWithSize:",
			[{ t: "size", width: 940, height: 600.5 }],
			"id",
		);
		const text = new CString(Number(msg(msg(image, "description"), "UTF8String")) as Pointer);
		expect(text.toString()).toContain("Size={940, 600.5}");
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
		const { focusWebview, hideWindowButtons, setMinSize } = await load();
		const notAWindow = Number(await make("NSObject")) as Pointer;
		const notAView = Number(await make("NSObject")) as Pointer;
		expect(() => hideWindowButtons(notAWindow)).not.toThrow();
		expect(setMinSize(notAWindow, 940, 600)).toBe(false);
		expect(setMinSize(0 as Pointer, 940, 600)).toBe(false);
		expect(() => focusWebview(notAWindow, notAView)).not.toThrow();
		expect(() => focusWebview(0 as Pointer, 0 as Pointer)).not.toThrow();
	});
});

test.skipIf(onMac)("off macOS the bridge isn't loaded: the app imports it on macOS only", () => {
	expect(process.platform).not.toBe("darwin");
});
