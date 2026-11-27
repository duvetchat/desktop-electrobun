import { describe, expect, test } from "bun:test";
import { CString, ptr, type Pointer } from "bun:ffi";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import config from "../../electrobun.config";
import {
	CF_UNICODETEXT,
	copySecret,
	macPasteboard,
	SECRET_ON_CLIPBOARD_MS,
	type ClipboardCalls,
	type ClipboardEntry,
} from "./secret-clipboard";

// The recovery key's Copy on Windows (#569): Bun puts it on the clipboard with the registered formats that keep it out
// of the clipboard history and the cloud clipboard, and takes it off a minute later while nothing was copied since. A
// clipboard of the test's own stands in for Windows', whose calls only a Windows machine runs.

/** A clipboard that records what it's given, its sequence number moved by each change, as Windows' is. */
function fakeClipboard(takes = true) {
	const puts: ClipboardEntry[][] = [];
	let emptied = 0;
	let sequence = 7;
	const clipboard: ClipboardCalls = {
		put: async (items) => {
			if (!takes) return false;
			puts.push(items);
			sequence++;
			return true;
		},
		sequence: () => sequence,
		empty: async (copied) => {
			if (copied === sequence) {
				emptied++;
				sequence++;
			}
			return true;
		},
	};
	return {
		clipboard,
		puts,
		emptied: () => emptied,
		/** Another program copies something. */
		copiedElsewhere: () => void sequence++,
	};
}

/** A timer the test runs by hand: what's due, by its wait. */
function laterByHand() {
	const due: { ms: number; run: () => void }[] = [];
	return { due, later: (ms: number, run: () => void) => void due.push({ ms, run }) };
}

const KEY = "1234 5678 9ABC DEFG HJKL MNPQ RSTU VWXY Zabc defg hijk mnop";
const utf16 = (text: string) => new Uint8Array(Buffer.from(`${text}\0`, "utf16le"));
const DWORD_ZERO = new Uint8Array(4);

describe("a secret on Windows' clipboard", () => {
	test("goes on it as text, with the formats that keep it out of the history and the cloud clipboard", async () => {
		const { clipboard, puts } = fakeClipboard();
		expect(await copySecret(KEY, clipboard, laterByHand().later)).toBe(true);
		expect(puts).toEqual([
			[
				{ format: CF_UNICODETEXT, bytes: utf16(KEY) },
				{ format: "ExcludeClipboardContentFromMonitorProcessing", bytes: DWORD_ZERO },
				{ format: "CanIncludeInClipboardHistory", bytes: DWORD_ZERO },
				{ format: "CanUploadToCloudClipboard", bytes: DWORD_ZERO },
			],
		]);
	});

	test("is taken off a minute later while nothing was copied since", async () => {
		const { clipboard, emptied } = fakeClipboard();
		const { due, later } = laterByHand();
		await copySecret(KEY, clipboard, later);
		expect(due.map(({ ms }) => ms)).toEqual([SECRET_ON_CLIPBOARD_MS]);
		expect(SECRET_ON_CLIPBOARD_MS).toBe(60_000);
		expect(emptied()).toBe(0);
		due[0].run();
		await Bun.sleep(0);
		expect(emptied()).toBe(1);
	});

	test("leaves what was copied since, elsewhere or by the person's next Copy, which has a minute of its own", async () => {
		const elsewhere = fakeClipboard();
		const first = laterByHand();
		await copySecret(KEY, elsewhere.clipboard, first.later);
		elsewhere.copiedElsewhere();
		first.due[0].run();
		await Bun.sleep(0);
		expect(elsewhere.emptied()).toBe(0);

		const again = fakeClipboard();
		const { due, later } = laterByHand();
		await copySecret(KEY, again.clipboard, later);
		await copySecret(KEY, again.clipboard, later);
		due[0].run();
		await Bun.sleep(0);
		expect(again.emptied()).toBe(0);
		due[1].run();
		await Bun.sleep(0);
		expect(again.emptied()).toBe(1);
	});

	test("a clipboard that took nothing says so, and nothing is taken off later", async () => {
		const { clipboard, emptied } = fakeClipboard(false);
		const { due, later } = laterByHand();
		expect(await copySecret(KEY, clipboard, later)).toBe(false);
		expect(due).toEqual([]);
		expect(emptied()).toBe(0);
	});
});

const ROOT = join(import.meta.dir, "../..");
/** The library scripts/build-native.ts builds on a Mac (a placeholder elsewhere, which nothing loads). */
const LIBRARY = join(ROOT, "native/macos/build/libPasteboard.dylib");

/** What a pasteboard of the test's own holds, read through the Objective-C runtime: its text, and whether it's concealed. */
async function pasteboardHolds(name: string): Promise<{ text: string | null; concealed: boolean }> {
	const { cls, msg, nil } = await import("./appkit");
	const kept: Buffer[] = [];
	const nsString = (text: string) => {
		const bytes = Buffer.from(`${text}\0`, "utf8");
		kept.push(bytes);
		return msg(cls("NSString"), "stringWithUTF8String:", BigInt(ptr(bytes)));
	};
	const board = msg(cls("NSPasteboard"), "pasteboardWithName:", nsString(name));
	const text = msg(board, "stringForType:", nsString("public.utf8-plain-text"));
	const types = msg(cls("NSArray"), "arrayWithObject:", nsString("org.nspasteboard.ConcealedType"));
	const concealed = msg(board, "availableTypeFromArray:", types) !== nil;
	if (text === nil) return { text: null, concealed };
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- UTF8String's C string, as bun:ffi hands it over.
	const utf8 = Number(msg(text, "UTF8String")) as Pointer;
	return { text: new CString(utf8).toString(), concealed };
}

/** The test's pasteboard, let go of: the pasteboard server keeps a named one until then. */
async function releasePasteboard(name: string) {
	const { cls, msg } = await import("./appkit");
	const bytes = Buffer.from(`${name}\0`, "utf8");
	msg(
		msg(cls("NSPasteboard"), "pasteboardWithName:", msg(cls("NSString"), "stringWithUTF8String:", BigInt(ptr(bytes)))),
		"releaseGlobally",
	);
}

/** Something else copied on that pasteboard meanwhile, by another program. */
async function copyElsewhere(name: string, text: string) {
	const { cls, msg } = await import("./appkit");
	const bytes = [Buffer.from(`${name}\0`), Buffer.from(`${text}\0`), Buffer.from("public.utf8-plain-text\0")];
	const [board, string, type] = bytes.map((cstring) =>
		msg(cls("NSString"), "stringWithUTF8String:", BigInt(ptr(cstring))),
	);
	const pasteboard = msg(cls("NSPasteboard"), "pasteboardWithName:", board);
	msg(pasteboard, "clearContents");
	msg(pasteboard, "setString:forType:", string, type);
}

// The recovery key's Copy on macOS (PLAN-E2E-PLATAFORMAS.md, Task 6): the app's own library writes the pasteboard
// (native/macos/pasteboard.mm), for this Mac alone (Universal Clipboard doesn't hand it to the person's other devices)
// and concealed (org.nspasteboard.ConcealedType, which clipboard managers leave out of their history), and takes it off a
// minute later while the pasteboard's changeCount says nothing was copied since.
describe("a secret on macOS's pasteboard", () => {
	test("is written for this Mac alone, concealed, by a library the app builds and carries", () => {
		const source = readFileSync(join(ROOT, "native/macos/pasteboard.mm"), "utf8");
		expect(source).toContain("prepareForNewContentsWithOptions:NSPasteboardContentsCurrentHostOnly");
		expect(source).toContain('@"org.nspasteboard.ConcealedType"');
		expect(source).toContain("pasteboard.changeCount != copied");
		const build = readFileSync(join(ROOT, "scripts/build-native.ts"), "utf8");
		expect(build).toContain(
			'{ name: "libPasteboard.dylib", source: "native/macos/pasteboard.mm", frameworks: ["Cocoa"] }',
		);
		const copy: Record<string, string> = config.build.copy;
		expect(copy["native/macos/build/libPasteboard.dylib"]).toBe("native/libPasteboard.dylib");
		// On macOS the app copies through it; with no library, the page copies, as on Linux.
		const index = readFileSync(join(import.meta.dir, "index.ts"), "utf8").replaceAll("\r\n", "\n");
		expect(index).toMatch(
			/process\.platform === "darwin"\s*\?\s*macPasteboard\(nativeLibraryPath\("libPasteboard\.dylib"\)\)/,
		);
	});

	test.skipIf(process.platform !== "darwin" || !existsSync(LIBRARY))(
		"on macOS the key stays on this Mac, and leaves the pasteboard after a minute",
		async () => {
			// A pasteboard of the test's own: the person's clipboard is never touched.
			const name = `chat.duvet.test.${crypto.randomUUID()}`;
			const pasteboard = macPasteboard(LIBRARY, name);
			expect(pasteboard).not.toBeNull();
			try {
				const { due, later } = laterByHand();
				expect(await copySecret(KEY, pasteboard!, later)).toBe(true);
				expect(await pasteboardHolds(name)).toEqual({ text: KEY, concealed: true });
				expect(due.map(({ ms }) => ms)).toEqual([SECRET_ON_CLIPBOARD_MS]);
				due[0].run();
				await Bun.sleep(0);
				expect(await pasteboardHolds(name)).toEqual({ text: null, concealed: false });

				// What was copied since stays.
				await copySecret(KEY, pasteboard!, later);
				await copyElsewhere(name, "something else");
				due[1].run();
				await Bun.sleep(0);
				expect(await pasteboardHolds(name)).toEqual({ text: "something else", concealed: false });
			} finally {
				await releasePasteboard(name);
			}
		},
	);

	test("without its library there's no pasteboard of Bun's, and the page copies", () => {
		expect(macPasteboard(join(ROOT, "native/macos/build/no-such-library.dylib"))).toBeNull();
	});
});
