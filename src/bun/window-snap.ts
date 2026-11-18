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
				windowSnapSetUp: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
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
	procedure.symbols.windowSnapSetUp(user32Function(`CallWindowProc${charset}`), user32Function("IsZoomed"), previous);
	// The procedure first, so the frame and caption the styles would add never show.
	if (!user32[`SetWindowLongPtr${charset}`](window, GWLP_WNDPROC, procedure.symbols.windowSnapProcedure()))
		return false;
	user32.SetWindowLongW(window, GWL_STYLE, user32.GetWindowLongW(window, GWL_STYLE) | ARRANGEABLE);
	user32.SetWindowPos(window, null, 0, 0, 0, 0, FRAME_CHANGED);
	return true;
}
