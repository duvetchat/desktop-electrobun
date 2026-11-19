/* oxlint-disable typescript/no-unsafe-type-assertion -- bun:ffi hands values over untyped where they cross. */
// What the app asks of AppKit itself on macOS. For keys to reach its page (window-keys.ts): make a window's web view
// its first responder, and hide the window's three buttons. For the sidebar's glass (vibrancy.ts, #374): put the
// system's sidebar material behind the web view, and keep it in the page's theme. Electrobun has no call for any of
// them, so they go through the Objective-C runtime with bun:ffi, public API only. Imported on macOS only
// (src/bun/index.ts).
//
// Electrobun runs this code in a Worker, off the process's main thread, and AppKit wants its windows and views touched
// on the main thread: every AppKit message here is run there (performSelectorOnMainThread). A message with an integer
// or a BOOL argument goes in an NSInvocation, which carries them; one with a single object needs none.
//
// bun:ffi hands pointers to JavaScript as doubles, which keep 53 bits, and Objective-C's tagged pointers have their top
// bit set (on macOS 27 even a method signature can be one): every object here is a u64, a BigInt.
import { CFunction, FFIType, dlopen, type Pointer } from "bun:ffi";

/** An Objective-C object, class or selector; 0n is nil. */
export type Id = bigint;
export const nil: Id = 0n;

const cstr = (text: string) => Buffer.from(`${text}\0`, "utf8");

const system = dlopen("/usr/lib/libSystem.B.dylib", {
	dlopen: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.ptr },
	dlsym: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
}).symbols;
const RTLD_NOW = 2;
const objc = system.dlopen(cstr("/usr/lib/libobjc.A.dylib"), RTLD_NOW);
// The app has AppKit loaded already; a plain Bun process (this module's test) hasn't, nor Foundation with it.
system.dlopen(cstr("/System/Library/Frameworks/AppKit.framework/AppKit"), RTLD_NOW);
const msgSend = system.dlsym(objc, cstr("objc_msgSend"));
if (!msgSend) throw new Error("objc_msgSend not found");

const runtime = dlopen("/usr/lib/libobjc.A.dylib", {
	objc_getClass: { args: [FFIType.ptr], returns: FFIType.u64 },
	sel_registerName: { args: [FFIType.ptr], returns: FFIType.u64 },
	objc_autoreleasePoolPush: { args: [], returns: FFIType.u64 },
	objc_autoreleasePoolPop: { args: [FFIType.u64], returns: FFIType.void },
}).symbols;

const selectors = new Map<string, Id>();
export function sel(name: string): Id {
	let found = selectors.get(name);
	if (found === undefined) {
		found = runtime.sel_registerName(cstr(name));
		selectors.set(name, found);
	}
	return found;
}

export function cls(name: string): Id {
	const found = runtime.objc_getClass(cstr(name));
	if (!found) throw new Error(`no class ${name}`);
	return found;
}

/** An Electrobun pointer (a window's, a view's: heap addresses, which fit a double) as an Id. */
export const idOf = (pointer: Pointer | number | null | undefined): Id => BigInt(pointer ?? 0);

// objc_msgSend, typed once per signature. After the receiver and the selector: "o" an object or selector, "p" a
// pointer into JavaScript memory, "i" an NSInteger, "b" a BOOL.
type ArgCode = "o" | "p" | "i" | "b";
type RetCode = "o" | "b" | "v";
const FFI_OF: Record<ArgCode | RetCode, FFIType> = {
	o: FFIType.u64,
	p: FFIType.ptr,
	i: FFIType.i64,
	b: FFIType.bool,
	v: FFIType.void,
};
const senders = new Map<string, (...args: unknown[]) => unknown>();
function send(signature: string, returns: RetCode, receiver: Id, selector: string, ...args: unknown[]): unknown {
	const key = `${signature}>${returns}`;
	let sender = senders.get(key);
	if (!sender) {
		sender = CFunction({
			ptr: msgSend as Pointer,
			args: [FFIType.u64, FFIType.u64, ...[...signature].map((code) => FFI_OF[code as ArgCode])],
			returns: FFI_OF[returns],
		}) as unknown as (...args: unknown[]) => unknown;
		senders.set(key, sender);
	}
	return sender(receiver, sel(selector), ...args);
}

/** [receiver selector:objects…], returning an object. On this thread: for what any thread may do. */
export function msg(receiver: Id, selector: string, ...args: Id[]): Id {
	return send("o".repeat(args.length), "o", receiver, selector, ...args) as Id;
}

/** Whether an object answers a selector: asked before a message Electrobun's or AppKit's object might not take, as a
 * message nobody answers ends the process. */
export function responds(object: Id, selector: string): boolean {
	return object !== nil && (send("o", "b", object, "respondsToSelector:", sel(selector)) as boolean);
}

/** An NSRect: a view's frame or bounds, in points. */
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type Arg = { t: "id"; v: Id } | { t: "int"; v: number } | { t: "bool"; v: boolean } | { t: "rect"; v: Rect };

const bytesOf = (arg: Arg): Uint8Array =>
	arg.t === "id"
		? new Uint8Array(new BigUint64Array([arg.v]).buffer)
		: arg.t === "int"
			? new Uint8Array(new BigInt64Array([BigInt(Math.trunc(arg.v))]).buffer)
			: arg.t === "rect"
				? new Uint8Array(new Float64Array([arg.v.x, arg.v.y, arg.v.width, arg.v.height]).buffer)
				: new Uint8Array([arg.v ? 1 : 0]);

/** [target selector:args…] on the main thread, waited for, through an NSInvocation; what it returned is copied into
 * `out`, which is as large as the method's return value. */
function invokeOnMain(target: Id, selector: string, args: Arg[], out: BigUint64Array | Float64Array | null): void {
	const pool = runtime.objc_autoreleasePoolPush();
	try {
		const signature = msg(target, "methodSignatureForSelector:", sel(selector));
		if (!signature) throw new Error(`the object doesn't respond to ${selector}`);
		const invocation = msg(cls("NSInvocation"), "invocationWithMethodSignature:", signature);
		msg(invocation, "setTarget:", target);
		msg(invocation, "setSelector:", sel(selector));
		// Kept until the invocation has run: it reads them from this memory.
		const kept = args.map(bytesOf);
		kept.forEach((bytes, index) => send("pi", "v", invocation, "setArgument:atIndex:", bytes, index + 2));
		msg(invocation, "retainArguments");
		send("oob", "v", invocation, "performSelectorOnMainThread:withObject:waitUntilDone:", sel("invoke"), nil, true);
		if (out) send("p", "v", invocation, "getReturnValue:", out);
	} finally {
		runtime.objc_autoreleasePoolPop(pool);
	}
}

/**
 * [target selector:args…] on the main thread, waited for, through an NSInvocation. Returns the object it returned
 * when `returns` is "id" (only safe to keep while something else owns it, as a window owns its buttons).
 */
export function onMain(target: Id, selector: string, args: Arg[] = [], returns: "void" | "id" = "void"): Id {
	if (returns === "void") {
		invokeOnMain(target, selector, args, null);
		return nil;
	}
	const out = new BigUint64Array(1);
	invokeOnMain(target, selector, args, out);
	return out[0] ?? nil;
}

/** The NSRect [target selector] returns, asked on the main thread: a view's bounds or frame. */
export function rectOnMain(target: Id, selector: string): Rect {
	const out = new Float64Array(4);
	invokeOnMain(target, selector, [], out);
	return { x: out[0] ?? 0, y: out[1] ?? 0, width: out[2] ?? 0, height: out[3] ?? 0 };
}

/**
 * Makes an Electrobun view's web view the first responder of its window: keys the window gets then go to the page.
 * `view` is a BrowserView's pointer (Electrobun's AbstractView, whose `webView` is the WKWebView). Not waited for: it
 * runs when the main thread next turns. Nothing happens, and false comes back, for a view without a web view (another
 * renderer).
 */
export function focusWebview(window: Pointer, view: Pointer): boolean {
	const abstractView = idOf(view);
	if (!responds(abstractView, "webView")) return false;
	const webView = msg(abstractView, "webView");
	const target = idOf(window);
	if (!webView || !responds(target, "makeFirstResponder:")) return false;
	send(
		"oob",
		"v",
		target,
		"performSelectorOnMainThread:withObject:waitUntilDone:",
		sel("makeFirstResponder:"),
		webView,
		false,
	);
	return true;
}

// NSWindowButton: close, miniaturize, zoom.
const WINDOW_BUTTONS = [0, 1, 2];

/** Hides a window's close, minimize and zoom buttons, as Electrobun does for a window without a title bar; returns
 * how many it hid. */
export function hideWindowButtons(window: Pointer): number {
	const target = idOf(window);
	if (!responds(target, "standardWindowButton:")) return 0;
	let hidden = 0;
	for (const kind of WINDOW_BUTTONS) {
		const button = onMain(target, "standardWindowButton:", [{ t: "int", v: kind }], "id");
		if (!button) continue;
		onMain(button, "setHidden:", [{ t: "bool", v: true }]);
		hidden++;
	}
	return hidden;
}

// NSVisualEffectMaterialSidebar; NSVisualEffectBlendingModeBehindWindow: what is behind the window shows through;
// NSVisualEffectStateFollowsWindowActiveState: a window that isn't the active one loses the blur, as Finder's does.
const MATERIAL_SIDEBAR = 7;
const BLENDING_BEHIND_WINDOW = 0;
const STATE_FOLLOWS_WINDOW = 0;
// NSViewWidthSizable | NSViewHeightSizable: the view keeps to its superview's size.
const FILLS_ITS_SUPERVIEW = 2 | 16;
// NSWindowBelow: under every view the superview already has.
const BELOW = -1;

/**
 * Puts the system's sidebar material (an NSVisualEffectView) under everything in a window's content view, as large as
 * it and staying so. Electrobun's web view draws no background of its own, so wherever the page paints nothing the
 * material shows, and through it the desktop, blurred: the sidebar's glass (#374). The window stays opaque, with its
 * shadow and its corners. Returns the view, which the window keeps, or nil for a window that isn't one.
 */
export function addSidebarMaterial(window: Pointer): Id {
	const target = idOf(window);
	if (!responds(target, "contentView")) return nil;
	const content = onMain(target, "contentView", [], "id");
	if (!responds(content, "addSubview:positioned:relativeTo:")) return nil;
	// Made here and set up on the main thread; never released, so the view lasts as long as the app, whatever becomes
	// of its window.
	const material = onMain(
		msg(cls("NSVisualEffectView"), "alloc"),
		"initWithFrame:",
		[{ t: "rect", v: rectOnMain(content, "bounds") }],
		"id",
	);
	if (!material) return nil;
	onMain(material, "setMaterial:", [{ t: "int", v: MATERIAL_SIDEBAR }]);
	onMain(material, "setBlendingMode:", [{ t: "int", v: BLENDING_BEHIND_WINDOW }]);
	onMain(material, "setState:", [{ t: "int", v: STATE_FOLLOWS_WINDOW }]);
	onMain(material, "setAutoresizingMask:", [{ t: "int", v: FILLS_ITS_SUPERVIEW }]);
	onMain(content, "addSubview:positioned:relativeTo:", [
		{ t: "id", v: material },
		{ t: "int", v: BELOW },
		{ t: "id", v: nil },
	]);
	return material;
}

/** An NSString of a text, autoreleased: the caller's pool, or the thread's, keeps it. */
export function nsString(text: string): Id {
	return send("p", "o", cls("NSString"), "stringWithUTF8String:", cstr(text)) as Id;
}

/** NSAppearanceNameAqua and NSAppearanceNameDarkAqua, by the names AppKit gives them. */
const APPEARANCES = { light: "NSAppearanceNameAqua", dark: "NSAppearanceNameDarkAqua" } as const;

/**
 * Gives a view the light or the dark appearance, whatever the system's is: the sidebar's material is then the page's
 * theme, which the user can pick apart from the system's (lib/theme.ts). Nothing happens for what isn't a view.
 */
export function setViewTheme(view: Id, theme: "light" | "dark"): void {
	if (!responds(view, "setAppearance:")) return;
	const pool = runtime.objc_autoreleasePoolPush();
	try {
		// Both live in this pool until the view has the appearance, and keeps it.
		const appearance = msg(cls("NSAppearance"), "appearanceNamed:", nsString(APPEARANCES[theme]));
		if (appearance) onMain(view, "setAppearance:", [{ t: "id", v: appearance }]);
	} finally {
		runtime.objc_autoreleasePoolPop(pool);
	}
}
