import { afterAll, expect, test } from "bun:test";
import { dlopen, FFIType, JSCallback, ptr, type Pointer } from "bun:ffi";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARRANGEABLE, followPress, letWindowsArrange } from "./window-snap";

// Opened in the test: CI runs these files on Linux.
function win32() {
	const user32 = dlopen("user32.dll", {
		RegisterClassExA: { args: [FFIType.ptr], returns: FFIType.u16 },
		CreateWindowExA: {
			args: [
				FFIType.u32,
				FFIType.ptr,
				FFIType.ptr,
				FFIType.u32,
				FFIType.i32,
				FFIType.i32,
				FFIType.i32,
				FFIType.i32,
				FFIType.ptr,
				FFIType.ptr,
				FFIType.ptr,
				FFIType.ptr,
			],
			returns: FFIType.ptr,
		},
		SetLayeredWindowAttributes: { args: [FFIType.ptr, FFIType.u32, FFIType.u8, FFIType.u32], returns: FFIType.i32 },
		DestroyWindow: { args: [FFIType.ptr], returns: FFIType.i32 },
		ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
		IsWindowUnicode: { args: [FFIType.ptr], returns: FFIType.i32 },
		IsZoomed: { args: [FFIType.ptr], returns: FFIType.i32 },
		GetWindowLongW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
		GetWindowRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		GetClientRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		ClientToScreen: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		MonitorFromWindow: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
		GetMonitorInfoW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		SetFocus: { args: [FFIType.ptr], returns: FFIType.ptr },
		GetFocus: { args: [], returns: FFIType.ptr },
		SendMessageA: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
		DefWindowProcA: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
	}).symbols;
	const kernel32 = dlopen("kernel32.dll", {
		GetModuleHandleA: { args: [FFIType.ptr], returns: FFIType.ptr },
		GetProcAddress: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
	}).symbols;
	return { user32, kernel32 };
}

// NUL-terminated, as Win32 reads its strings.
const ansi = (text: string) => Buffer.concat([Buffer.from(text, "latin1"), Buffer.alloc(1)]);
const WS_POPUP = 0x80000000 | 0;
// Layered and fully transparent, and never activated, so out of the taskbar: the test's window shows nowhere, maximized
// too. Not a tool window (WS_EX_TOOLWINDOW), which Windows maximizes over the taskbar, unlike Electrobun's.
const WS_EX_INVISIBLE = 0x80000 | 0x8000000;

const WM_ACTIVATE = 0x6;
const WA_INACTIVE = 0n;
const WA_ACTIVE = 1n;
const WM_SYSCOMMAND = 0x112;
const SC_KEYMENU = 0xf100n;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;

// Electrobun's procedure, as the test stands it in: Windows' default for every message but the window's commands, which
// it records instead of running, as an Alt's menu would wait in a menu loop no test ends.
const commands: { command: bigint; key: bigint }[] = [];
let electrobunProcedure: JSCallback | null = null;
afterAll(() => electrobunProcedure?.close());

// A window as Electrobun 1.15.1 makes one with titleBarStyle "hidden": an ANSI class (RegisterClassA, CreateWindowExA)
// and a bare WS_POPUP.
const className = ansi("DuvetWindowSnapTest");
function electrobunWindow({ user32, kernel32 }: ReturnType<typeof win32>): Pointer {
	electrobunProcedure ??= new JSCallback(
		(window: Pointer, message: number, wParam: bigint, lParam: bigint) => {
			if (message !== WM_SYSCOMMAND) return user32.DefWindowProcA(window, message, wParam, lParam);
			commands.push({ command: wParam & 0xfff0n, key: lParam });
			return 0n;
		},
		{ args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
	);
	const windowClass = Buffer.alloc(80);
	windowClass.writeUInt32LE(80, 0);
	windowClass.writeBigUInt64LE(BigInt(electrobunProcedure.ptr ?? 0), 8);
	windowClass.writeBigUInt64LE(BigInt(kernel32.GetModuleHandleA(null) ?? 0), 24);
	windowClass.writeBigUInt64LE(BigInt(ptr(className)), 64);
	user32.RegisterClassExA(windowClass);
	const window = user32.CreateWindowExA(
		WS_EX_INVISIBLE,
		className,
		ansi("Duvet"),
		WS_POPUP,
		40,
		30,
		1400,
		900,
		null,
		null,
		null,
		null,
	);
	if (!window) throw new Error("CreateWindowExA failed");
	user32.SetLayeredWindowAttributes(window, 0, 0, 2);
	return window;
}

const rect = (r: Int32Array) => ({ x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] });
function windowRect(user32: ReturnType<typeof win32>["user32"], window: Pointer) {
	const r = new Int32Array(4);
	user32.GetWindowRect(window, r);
	return rect(r);
}
// The client area in screen coordinates: what the webview fills.
function clientRect(user32: ReturnType<typeof win32>["user32"], window: Pointer) {
	const r = new Int32Array(4);
	user32.GetClientRect(window, r);
	user32.ClientToScreen(window, r);
	user32.ClientToScreen(window, r.subarray(2));
	return rect(r);
}

// The window letWindowsArrange arranged, for the tests after the first: it arranges one window per process.
let snapped: { user32: ReturnType<typeof win32>["user32"]; window: Pointer } | null = null;
afterAll(() => {
	if (snapped) snapped.user32.DestroyWindow(snapped.window);
});

// #345: Windows' shell snaps a window (Win+Left, Win+Right) only when it has a sizing frame, and maximizes, restores or
// minimizes it (Win+Up, Win+Down) only with its maximize and minimize boxes: Electrobun's "hidden" window had none.
test.skipIf(process.platform !== "win32")(
	"the window takes what Windows snaps and maximizes, keeps no frame, and maximizes to its display's work area",
	() => {
		const api = win32();
		const { user32 } = api;
		const window = electrobunWindow(api);
		snapped = { user32, window };
		// TinyCC opens only ASCII paths: a profile folder with an accent (C:\Users\José) holds the temp folder.
		const dir = mkdtempSync(join(tmpdir(), "duvet window snap José "));
		try {
			const before = windowRect(user32, window);
			expect(letWindowsArrange(window, dir)).toBe(true);
			expect(readdirSync(dir)).toEqual([]);

			expect(user32.GetWindowLongW(window, -16) & ARRANGEABLE).toBe(ARRANGEABLE);
			// A sizing frame alone takes 7 px a side of the window, and a caption its top.
			expect(windowRect(user32, window)).toEqual(before);
			expect(clientRect(user32, window)).toEqual(before);
			// Subclassed in its own character set: an ANSI window's messages reach Electrobun's procedure unconverted.
			expect(user32.IsWindowUnicode(window)).toBe(0);

			// Maximized, the webview fills its display's work area: not the whole display, over the taskbar, as a popup
			// does, and no caption.
			user32.ShowWindow(window, 3);
			expect(user32.IsZoomed(window)).toBe(1);
			const monitor = new Int32Array(10);
			monitor[0] = 40;
			user32.GetMonitorInfoW(user32.MonitorFromWindow(window, 2), monitor);
			const workArea = rect(monitor.subarray(5, 9));
			expect(clientRect(user32, window)).toEqual(workArea);

			user32.ShowWindow(window, 9);
			expect(user32.IsZoomed(window)).toBe(0);
			expect(clientRect(user32, window)).toEqual(before);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

// Electrobun gives the window's webview no focus as Windows activates the window: Windows' default gives the window
// itself the keyboard (DefWindowProc's WM_ACTIVATE), where no key reaches the page. After an Alt+Tab, and after Bun's
// win.focus() (a notification clicked), typing did nothing until a click.
test.skipIf(process.platform !== "win32")(
	"a window active again gives the keyboard back to what had it in its page",
	() => {
		if (!snapped) throw new Error("the window wasn't arranged");
		const { user32, window } = snapped;
		// The webview's window, a child: what has the keyboard while someone types in the page.
		const page = user32.CreateWindowExA(
			0,
			ansi("STATIC"),
			ansi(""),
			WS_CHILD | WS_VISIBLE,
			0,
			0,
			100,
			100,
			window,
			null,
			null,
			null,
		);
		if (!page) throw new Error("CreateWindowExA failed");
		try {
			user32.SetFocus(page);
			expect(user32.GetFocus()).toBe(page);
			// Alt+Tab away: Windows tells the window it's no longer active, and takes the keyboard away.
			user32.SendMessageA(window, WM_ACTIVATE, WA_INACTIVE, 0n);
			user32.SetFocus(null);
			// Alt+Tab back: activated, the window gets the keyboard, and gives it back to the page.
			user32.SendMessageA(window, WM_ACTIVATE, WA_ACTIVE, 0n);
			expect(user32.GetFocus()).toBe(page);
			// win.focus() gives the window itself the keyboard too.
			user32.SetFocus(window);
			expect(user32.GetFocus()).toBe(page);
		} finally {
			user32.DestroyWindow(page);
		}
		// A page's window that's gone isn't given anything: the window keeps the keyboard.
		user32.SetFocus(window);
		expect(user32.GetFocus()).toBe(window);
	},
);

// The system menu the window has for Win+Up and Win+Down (#345) has no caption to show in: Alt alone or F10 opened it
// unseen, and its loop took the next keys. Alt+Space, which shows it, still opens it.
test.skipIf(process.platform !== "win32")("Alt alone or F10 opens no menu nobody sees; Alt+Space still does", () => {
	if (!snapped) throw new Error("the window wasn't arranged");
	const { user32, window } = snapped;
	commands.length = 0;
	user32.SendMessageA(window, WM_SYSCOMMAND, SC_KEYMENU, 0n);
	user32.SendMessageA(window, WM_SYSCOMMAND, SC_KEYMENU, 0x20n);
	expect(commands).toEqual([{ command: SC_KEYMENU, key: 0x20n }]);
});

// A press as Bun reads it, one read after another: where the cursor is, and whether the primary button is still down.
function press(positions: [number, number][], downs: boolean[]) {
	let position = 0;
	let down = 0;
	return {
		cursor: () => {
			const [x, y] = positions[Math.min(position++, positions.length - 1)];
			return { x, y };
		},
		pressed: () => downs[Math.min(down++, downs.length - 1)],
		distance: { x: 4, y: 4 },
	};
}

// #348: the title bar's drag is Windows' move loop, started once the press moves past the system's drag distance, so a
// click and a double click stay the page's.
test("a press released where it started drags nothing", async () => {
	const drags: unknown[] = [];
	expect(await followPress(press([[100, 10]], [false]), (from) => drags.push(from), 0)).toBe(false);
	expect(drags).toEqual([]);
});

test("a press that moves past the drag distance drags once, from where it started", async () => {
	const drags: unknown[] = [];
	const moved = press(
		[
			[100, 10],
			[102, 11],
			[110, 12],
		],
		[true, true, true],
	);
	expect(await followPress(moved, (from) => drags.push(from), 0)).toBe(true);
	expect(drags).toEqual([{ x: 100, y: 10 }]);
});

test("a press that moves within the drag distance, then ends, drags nothing", async () => {
	const drags: unknown[] = [];
	const nudged = press(
		[
			[100, 10],
			[103, 12],
			[104, 14],
		],
		[true, true, false],
	);
	expect(await followPress(nudged, (from) => drags.push(from), 0)).toBe(false);
	expect(drags).toEqual([]);
});
