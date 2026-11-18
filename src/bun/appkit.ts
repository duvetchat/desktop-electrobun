/* oxlint-disable typescript/no-unsafe-type-assertion -- bun:ffi hands values over untyped where they cross. */
// The two things the app asks of AppKit itself on macOS, for keys to reach its page (window-keys.ts): make a window's
// web view its first responder, and hide the window's three buttons. Electrobun has no call for either, so they go
// through the Objective-C runtime with bun:ffi, public API only. Imported on macOS only (src/bun/index.ts).
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

export type Arg = { t: "id"; v: Id } | { t: "int"; v: number } | { t: "bool"; v: boolean };

const bytesOf = (arg: Arg): Uint8Array =>
	arg.t === "id"
		? new Uint8Array(new BigUint64Array([arg.v]).buffer)
		: arg.t === "int"
			? new Uint8Array(new BigInt64Array([BigInt(Math.trunc(arg.v))]).buffer)
			: new Uint8Array([arg.v ? 1 : 0]);

/**
 * [target selector:args…] on the main thread, waited for, through an NSInvocation. Returns the object it returned
 * when `returns` is "id" (only safe to keep while something else owns it, as a window owns its buttons).
 */
export function onMain(target: Id, selector: string, args: Arg[] = [], returns: "void" | "id" = "void"): Id {
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
		if (returns === "void") return nil;
		const out = new BigUint64Array(1);
		send("p", "v", invocation, "getReturnValue:", out);
		return out[0] ?? nil;
	} finally {
		runtime.objc_autoreleasePoolPop(pool);
	}
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
