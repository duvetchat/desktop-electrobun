import { describe, expect, test } from "bun:test";
import {
	CF_UNICODETEXT,
	copySecret,
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
