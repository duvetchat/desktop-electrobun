import { cc, dlopen, FFIType, type Pointer } from "bun:ffi";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import procedureSource from "./window-snap.c" with { type: "text" };

// What Windows asks of a window before Win+Left and Win+Right snap it (a sizing frame), and before Win+Up and Win+Down
// maximize, restore or minimize it (a system menu with its maximize and minimize boxes). Electrobun 1.15.1 makes a
// "hidden" title bar's window a bare WS_POPUP, with none of them (#345). The caption makes it an app window, which
// Windows maximizes to its display's work area: maximized, a popup covers the whole display, the taskbar included.
const WS_CAPTION = 0xc00000;
const WS_THICKFRAME = 0x40000;
const WS_SYSMENU = 0x80000;
const WS_MINIMIZEBOX = 0x20000;
const WS_MAXIMIZEBOX = 0x10000;
export const ARRANGEABLE = WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
const GWL_STYLE = -16;
const GWLP_WNDPROC = -4;
// SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED: the frame worked out again, and nothing moves.
const FRAME_CHANGED = 0x1 | 0x2 | 0x4 | 0x10 | 0x20;

// NUL-terminated, as Win32 reads its strings.
const wide = (text: string) => Buffer.concat([Buffer.from(text, "utf16le"), Buffer.alloc(2)]);
const ansi = (text: string) => Buffer.concat([Buffer.from(text, "latin1"), Buffer.alloc(1)]);
const isAscii = (text: string) => [...text].every((character) => character.charCodeAt(0) < 0x80);

function openWin32() {
	const procedureRead = { args: [FFIType.ptr, FFIType.i32], returns: FFIType.ptr } as const;
	const procedureChange = { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.ptr } as const;
	const user32 = dlopen("user32.dll", {
		IsWindowUnicode: { args: [FFIType.ptr], returns: FFIType.i32 },
		GetWindowLongW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
		SetWindowLongW: { args: [FFIType.ptr, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
		GetWindowLongPtrA: procedureRead,
		GetWindowLongPtrW: procedureRead,
		SetWindowLongPtrA: procedureChange,
		SetWindowLongPtrW: procedureChange,
		SetWindowPos: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32],
			returns: FFIType.i32,
		},
	}).symbols;
	const kernel32 = dlopen("kernel32.dll", {
		GetModuleHandleW: { args: [FFIType.ptr], returns: FFIType.ptr },
		GetProcAddress: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
		GetShortPathNameW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
	}).symbols;
	return { user32, kernel32 };
}

// The compiled procedure (window-snap.c), kept for the process's life: Windows calls it for as long as the window lives,
// and Electrobun's quit stops the window's loop before the Bun worker ends.
let procedure: ReturnType<typeof compile> | null = null;

function compile(dir: string, kernel32: ReturnType<typeof openWin32>["kernel32"]) {
	// TinyCC compiles a file: the source is bundled as text, and written for it.
	const source = join(dir, `duvet-window-snap-${process.pid}.c`);
	writeFileSync(source, procedureSource);
	try {
		return cc({
			source: compilablePath(source, kernel32),
			symbols: {
				windowSnapSetUp: {
					args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
					returns: FFIType.void,
				},
				windowSnapProcedure: { args: [], returns: FFIType.ptr },
			},
		});
	} finally {
		rmSync(source, { force: true });
	}
}

// TinyCC finds no file whose path has other than ASCII characters (a profile folder such as C:\Users\José): such a
// path goes by its short name, which is ASCII on a volume that keeps short names, as Windows' own does by default.
function compilablePath(path: string, kernel32: ReturnType<typeof openWin32>["kernel32"]): string {
	if (isAscii(path)) return path;
	const capacity = 32768;
	const short = Buffer.alloc(capacity * 2);
	const length = kernel32.GetShortPathNameW(wide(path), short, capacity);
	const shortPath = short.subarray(0, length * 2).toString("utf16le");
	if (length === 0 || length >= capacity || !isAscii(shortPath)) {
		throw new Error(`TinyCC can't open ${path}: its folder has no ASCII short name`);
	}
	return shortPath;
}

/** Lets Windows snap window (an HWND) with Win+Left and Win+Right, and maximize, restore and minimize it with Win+Up and
 * Win+Down, as it does any window: the styles those take, behind a procedure that keeps the window frameless and
 * maximized to its display's work area (window-snap.c). dir is where TinyCC's source is written for it, and deleted.
 * Windows only, for one window. False when the window couldn't take the procedure, which leaves it as it was; throws
 * when the procedure doesn't compile. */
export function letWindowsArrange(window: Pointer, dir = tmpdir()): boolean {
	if (procedure) throw new Error("window-snap arranges one window per process");
	const { user32, kernel32 } = openWin32();
	procedure = compile(dir, kernel32);
	const user32Module = kernel32.GetModuleHandleW(wide("user32.dll"));
	const user32Function = (name: string) => kernel32.GetProcAddress(user32Module, ansi(name));

	// In the window's own character set (Electrobun 1.15.1's is ANSI): the other one would make it a Unicode window,
	// whose text messages Windows would convert on their way to Electrobun's procedure.
	const charset = user32.IsWindowUnicode(window) ? "W" : "A";
	const previous = user32[`GetWindowLongPtr${charset}`](window, GWLP_WNDPROC);
	if (!previous) return false;
	procedure.symbols.windowSnapSetUp(
		user32Function(`CallWindowProc${charset}`),
		user32Function("IsZoomed"),
		user32Function("ReleaseCapture"),
		previous,
	);
	// The procedure first, so the frame and caption the styles would add never show.
	if (!user32[`SetWindowLongPtr${charset}`](window, GWLP_WNDPROC, procedure.symbols.windowSnapProcedure()))
		return false;
	user32.SetWindowLongW(window, GWL_STYLE, user32.GetWindowLongW(window, GWL_STYLE) | ARRANGEABLE);
	user32.SetWindowPos(window, null, 0, 0, 0, 0, FRAME_CHANGED);
	return true;
}

interface Point {
	x: number;
	y: number;
}

/** A press as Bun reads it: where the cursor is, whether the primary button is still down, and how far the cursor may
 * move before the press is a drag. */
export interface PressInput {
	cursor(): Point;
	pressed(): boolean;
	distance: Point;
}

/** Follows a press that began at the cursor until it ends, a click (false), or moves past input.distance, a drag: drag
 * then gets the point it began at (true). */
export async function followPress(input: PressInput, drag: (from: Point) => void, pause = 8): Promise<boolean> {
	const from = input.cursor();
	while (input.pressed()) {
		const at = input.cursor();
		if (Math.abs(at.x - from.x) > input.distance.x || Math.abs(at.y - from.y) > input.distance.y) {
			drag(from);
			return true;
		}
		await Bun.sleep(pause);
	}
	return false;
}

// window-snap.c's WINDOW_SNAP_DRAG (WM_APP + 0x0D07): a press that turned into a drag, at the point it began.
const WINDOW_SNAP_DRAG = 0x8d07;
const SM_SWAPBUTTON = 23;
const SM_CXDRAG = 68;
const SM_CYDRAG = 69;
const VK_LBUTTON = 1;
const VK_RBUTTON = 2;

// The press's reads and the move loop's message, from user32, opened at the first press.
let pressUser32: ReturnType<typeof openPressUser32> | null = null;
function openPressUser32() {
	return dlopen("user32.dll", {
		GetCursorPos: { args: [FFIType.ptr], returns: FFIType.i32 },
		GetAsyncKeyState: { args: [FFIType.i32], returns: FFIType.i16 },
		GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },
		PostMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i32 },
	}).symbols;
}
let following = false;

/** The title bar's drag on Windows (#348), for a press the page reports (startWindowDrag) on the window letWindowsArrange
 * took, whose procedure starts the move loop (WINDOW_SNAP_DRAG): once the press moves past the system's drag distance,
 * Windows' own move loop takes the window, as it does a caption's. A maximized window then restores as it's dragged,
 * and a display's edges and Snap layouts snap it. A click or a double click moves no further and stays the page's. One
 * press at a time. */
export async function dragWithWindows(window: Pointer): Promise<void> {
	if (following) return;
	following = true;
	try {
		pressUser32 ??= openPressUser32();
		const user32 = pressUser32;
		// GetAsyncKeyState reads the physical buttons: swapped, the primary one is the right.
		const primary = user32.GetSystemMetrics(SM_SWAPBUTTON) ? VK_RBUTTON : VK_LBUTTON;
		const point = new Int32Array(2);
		const input: PressInput = {
			cursor: () => {
				user32.GetCursorPos(point);
				return { x: point[0], y: point[1] };
			},
			pressed: () => (user32.GetAsyncKeyState(primary) & 0x8000) !== 0,
			distance: { x: user32.GetSystemMetrics(SM_CXDRAG), y: user32.GetSystemMetrics(SM_CYDRAG) },
		};
		// To the window's thread, which shares the webview's input: there the procedure releases the webview's hold on the
		// mouse, and Windows' move loop runs. The point's 16-bit halves, as Windows packs them.
		await followPress(input, ({ x, y }) => {
			user32.PostMessageW(window, WINDOW_SNAP_DRAG, 0n, BigInt((((y & 0xffff) << 16) | (x & 0xffff)) >>> 0));
		});
	} catch (err) {
		console.error("[window] Windows' move loop didn't take the title bar's drag:", err);
	} finally {
		following = false;
	}
}
