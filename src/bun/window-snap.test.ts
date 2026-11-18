import { expect, test } from "bun:test";
import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARRANGEABLE, letWindowsArrange } from "./window-snap";

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
		SetWindowPos: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32],
			returns: FFIType.i32,
		},
		IsWindowUnicode: { args: [FFIType.ptr], returns: FFIType.i32 },
		IsZoomed: { args: [FFIType.ptr], returns: FFIType.i32 },
		GetWindowLongW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
		GetWindowRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		GetClientRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		ClientToScreen: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		MonitorFromWindow: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
		GetMonitorInfoW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
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

// A window as Electrobun 1.15.1 makes one with titleBarStyle "hidden": an ANSI class (RegisterClassA, CreateWindowExA)
// and a bare WS_POPUP.
const className = ansi("DuvetWindowSnapTest");
function electrobunWindow({ user32, kernel32 }: ReturnType<typeof win32>): Pointer {
	const windowClass = Buffer.alloc(80);
	windowClass.writeUInt32LE(80, 0);
	const defWindowProc = kernel32.GetProcAddress(kernel32.GetModuleHandleA(ansi("user32.dll")), ansi("DefWindowProcA"));
	windowClass.writeBigUInt64LE(BigInt(defWindowProc ?? 0), 8);
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

// #345: Windows' shell snaps a window (Win+Left, Win+Right) only when it has a sizing frame, and maximizes, restores or
// minimizes it (Win+Up, Win+Down) only with its maximize and minimize boxes: Electrobun's "hidden" window had none.
test.skipIf(process.platform !== "win32")(
	"the window takes what Windows snaps and maximizes, keeps no frame, and maximizes to its display's work area",
	() => {
		const api = win32();
		const { user32 } = api;
		const window = electrobunWindow(api);
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

			// Electrobun's title-bar drag (SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE) leaves a maximized window in place.
			const maximized = windowRect(user32, window);
			user32.SetWindowPos(window, null, maximized.x + 60, maximized.y + 40, 0, 0, 0x1 | 0x4 | 0x10);
			expect(windowRect(user32, window)).toEqual(maximized);

			user32.ShowWindow(window, 9);
			expect(user32.IsZoomed(window)).toBe(0);
			expect(clientRect(user32, window)).toEqual(before);
		} finally {
			user32.DestroyWindow(window);
			rmSync(dir, { recursive: true, force: true });
		}
	},
);
