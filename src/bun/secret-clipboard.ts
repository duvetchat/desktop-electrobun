// A secret the page copies (the recovery key, #569), put on Windows' clipboard here: as text, with the registered
// formats Windows' clipboard history (Win+V) and its cloud clipboard leave out, as password managers do
// (learn.microsoft.com, Clipboard Formats, "Cloud Clipboard and Clipboard History Formats"), which the page's
// navigator.clipboard can't set. A minute later it's taken off the clipboard, while its sequence number says nothing was
// copied since. The calls are user32's and kernel32's, through bun:ffi; the rest takes any clipboard (`ClipboardCalls`).
// On macOS it's the pasteboard, through the app's own library (macPasteboard; PLAN-E2E-PLATAFORMAS.md, Task 6).
import { dlopen, FFIType, type Pointer } from "bun:ffi";

/** How long a copied secret stays on the clipboard (the page's own copy waits as long: lib/e2e/secret-copy.ts). */
export const SECRET_ON_CLIPBOARD_MS = 60_000;
/** The standard format of UTF-16 text, ending with a NUL. */
export const CF_UNICODETEXT = 13;

/** A clipboard format, standard by its number or registered by its name, with its bytes. */
export interface ClipboardEntry {
	format: number | string;
	bytes: Uint8Array;
}

/** What the copy asks of a clipboard. */
export interface ClipboardCalls {
	/** Puts the items on it together, in place of what it held: all of them, or none and false. */
	put(items: ClipboardEntry[]): Promise<boolean>;
	/** Its sequence number, which every change of it moves on. */
	sequence(): number;
	/** Empties it while its sequence number is still `copied`, as read with it open: false only when it couldn't be opened. */
	empty(copied: number): Promise<boolean>;
}

// Any data in the first keeps an item out of both, by the docs; a DWORD 0 in each of the others says the same of the
// history and of the cloud clipboard, which costs nothing more.
const LEFT_OUT = [
	"ExcludeClipboardContentFromMonitorProcessing",
	"CanIncludeInClipboardHistory",
	"CanUploadToCloudClipboard",
];

/**
 * Copies the secret, then takes it off a minute later while nothing was copied since, here or elsewhere: a newer copy
 * of it has its own minute. True once it's on the clipboard.
 */
export async function copySecret(
	text: string,
	clipboard: ClipboardCalls,
	later: (ms: number, run: () => void) => void = (ms, run) => void setTimeout(run, ms),
): Promise<boolean> {
	const items = [
		{ format: CF_UNICODETEXT, bytes: new Uint8Array(Buffer.from(`${text}\0`, "utf16le")) },
		...LEFT_OUT.map((format) => ({ format, bytes: new Uint8Array(4) })),
	];
	if (!(await clipboard.put(items))) return false;
	const copied = clipboard.sequence();
	later(SECRET_ON_CLIPBOARD_MS, () => {
		if (clipboard.sequence() !== copied) return;
		void clipboard.empty(copied).then(
			(emptied) => emptied || console.error("[clipboard] A secret stays on the clipboard: it couldn't be opened"),
			(err: unknown) => console.error("[clipboard] A secret stays on the clipboard:", err),
		);
	});
	return true;
}

/**
 * macOS's general pasteboard, through the app's own library (native/macos/pasteboard.mm, built by
 * scripts/build-native.ts): the text alone goes on it, for this Mac alone and concealed, which stand for Windows'
 * formats, and its changeCount is the sequence number. `name`, a pasteboard of a test's own. Null when the library
 * doesn't load: Bun then doesn't copy, and the page does, as on Linux.
 */
export function macPasteboard(library: string, name?: string): ClipboardCalls | null {
	let pasteboard;
	try {
		pasteboard = dlopen(library, {
			pb_copySecret: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i64 },
			pb_changeCount: { args: [FFIType.ptr], returns: FFIType.i64 },
			pb_clearIfUnchanged: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
		}).symbols;
	} catch (err) {
		console.error("[clipboard] The pasteboard's library didn't load:", err);
		return null;
	}
	const { pb_copySecret, pb_changeCount, pb_clearIfUnchanged } = pasteboard;
	const board = name === undefined ? null : Buffer.from(`${name}\0`, "utf8");
	return {
		async put(items) {
			// The text as copySecret hands it to Windows: UTF-16, with its NUL.
			const text = items.find(({ format }) => format === CF_UNICODETEXT);
			if (!text) return false;
			const utf8 = Buffer.from(`${Buffer.from(text.bytes).toString("utf16le").replace(/\0$/, "")}\0`, "utf8");
			return Number(pb_copySecret(utf8, board)) >= 0;
		},
		sequence: () => Number(pb_changeCount(board)),
		async empty(copied) {
			pb_clearIfUnchanged(copied, board);
			return true;
		},
	};
}

const GMEM_MOVEABLE = 0x0002;
/** The clipboard is held open by another program for a moment: tried this many times, 10 ms apart. */
const OPEN_TRIES = 10;

function win32() {
	const user32 = dlopen("user32.dll", {
		OpenClipboard: { args: [FFIType.ptr], returns: FFIType.i32 },
		EmptyClipboard: { args: [], returns: FFIType.i32 },
		SetClipboardData: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.ptr },
		CloseClipboard: { args: [], returns: FFIType.i32 },
		RegisterClipboardFormatW: { args: [FFIType.ptr], returns: FFIType.u32 },
		GetClipboardSequenceNumber: { args: [], returns: FFIType.u32 },
	}).symbols;
	const kernel32 = dlopen("kernel32.dll", {
		GlobalAlloc: { args: [FFIType.u32, FFIType.u64], returns: FFIType.ptr },
		GlobalLock: { args: [FFIType.ptr], returns: FFIType.ptr },
		GlobalUnlock: { args: [FFIType.ptr], returns: FFIType.i32 },
		GlobalFree: { args: [FFIType.ptr], returns: FFIType.ptr },
		RtlMoveMemory: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.void },
	}).symbols;
	return { user32, kernel32 };
}

/**
 * Windows' clipboard, opened with `owner` (the main window, on the thread that pumps its messages): EmptyClipboard makes
 * it the clipboard's owner, which SetClipboardData needs (a clipboard opened for no window has none, and its
 * SetClipboardData fails, the docs say). Windows only: its libraries load at the first call.
 */
export function windowsClipboard(owner: () => Pointer | null): ClipboardCalls {
	let calls: ReturnType<typeof win32> | null = null;
	const loaded = () => (calls ??= win32());
	const open = async () => {
		const { user32 } = loaded();
		for (let tries = 1; ; tries++) {
			if (user32.OpenClipboard(owner())) return true;
			if (tries >= OPEN_TRIES) return false;
			await Bun.sleep(10);
		}
	};
	// A movable block of global memory holding the bytes, as SetClipboardData takes one: null when none was had.
	const block = (bytes: Uint8Array): Pointer | null => {
		const { kernel32 } = loaded();
		const handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, bytes.length);
		if (!handle) return null;
		const at = kernel32.GlobalLock(handle);
		if (!at) {
			kernel32.GlobalFree(handle);
			return null;
		}
		kernel32.RtlMoveMemory(at, bytes, bytes.length);
		kernel32.GlobalUnlock(handle);
		return handle;
	};
	// One item on the clipboard, which is open: a block taken is the clipboard's, one refused still this process's to free.
	const set = ({ format, bytes }: ClipboardEntry) => {
		const { user32, kernel32 } = loaded();
		const id =
			typeof format === "number" ? format : user32.RegisterClipboardFormatW(Buffer.from(`${format}\0`, "utf16le"));
		const handle = id ? block(bytes) : null;
		if (!handle) return false;
		if (user32.SetClipboardData(id, handle)) return true;
		kernel32.GlobalFree(handle);
		return false;
	};
	return {
		async put(items) {
			const { user32 } = loaded();
			if (!(await open())) return false;
			try {
				if (!user32.EmptyClipboard()) return false;
				// All or none: the text without the formats that leave it out would reach the history, which reads the
				// clipboard once it's closed.
				const all = items.every(set);
				if (!all) user32.EmptyClipboard();
				return all;
			} finally {
				user32.CloseClipboard();
			}
		},
		sequence: () => loaded().user32.GetClipboardSequenceNumber(),
		async empty(copied) {
			const { user32 } = loaded();
			if (!(await open())) return false;
			try {
				// Read again with it open, as another program may have copied while it was opened: that stays.
				if (user32.GetClipboardSequenceNumber() === copied) user32.EmptyClipboard();
				return true;
			} finally {
				user32.CloseClipboard();
			}
		},
	};
}
