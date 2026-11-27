import { describe, expect, test } from "bun:test";
import { copySecret, SECRET_ON_CLIPBOARD_MS, type SecretCopy } from "./secret-copy";

// The recovery key's Copy (#569): in the desktop app Bun puts it on Windows' clipboard, out of its history and the
// cloud clipboard (src/bun/secret-clipboard.ts); where Bun doesn't (the web), the page copies it, and takes it off a
// minute later while it can tell the clipboard still holds it.

const KEY = "1234 5678 9ABC DEFG HJKL MNPQ RSTU VWXY Zabc defg hijk mnop";

/** The page's side as a test gives it: Bun's answer (none on the web), what the clipboard holds and lets be read. */
function given({ bun = null, readable = true }: { bun?: boolean | null | "none"; readable?: boolean } = {}) {
	const writes: string[] = [];
	const due: { ms: number; run: () => void }[] = [];
	let held = "";
	const copy: SecretCopy = {
		bun: bun === "none" ? null : async () => bun,
		clipboard: {
			writeText: async (text) => {
				writes.push(text);
				held = text;
			},
			readText: async () => held,
		},
		readable: async () => readable,
		later: (ms, run) => void due.push({ ms, run }),
	};
	return { copy, writes, due, copiedElsewhere: (text: string) => void (held = text) };
}

describe("a secret the person copies", () => {
	test("in the desktop app, Bun copies it, and the page writes nothing", async () => {
		const { copy, writes, due } = given({ bun: true });
		await copySecret(KEY, copy);
		expect(writes).toEqual([]);
		expect(due).toEqual([]);
	});

	test("one Bun's clipboard didn't take fails, rather than go through the page's, which the history keeps", async () => {
		const { copy, writes } = given({ bun: false });
		await expect(copySecret(KEY, copy)).rejects.toThrow();
		expect(writes).toEqual([]);
	});

	test("where Bun doesn't copy it, the page does, and takes it off a minute later while it still holds it", async () => {
		for (const bun of ["none", null] as const) {
			const { copy, writes, due } = given({ bun });
			await copySecret(KEY, copy);
			expect(writes).toEqual([KEY]);
			expect(due.map(({ ms }) => ms)).toEqual([SECRET_ON_CLIPBOARD_MS]);
			expect(SECRET_ON_CLIPBOARD_MS).toBe(60_000);
			due[0]!.run();
			await Bun.sleep(0);
			expect(writes).toEqual([KEY, ""]);
		}
	});

	test("what was copied since stays, and so does the key where the page can't tell what the clipboard holds", async () => {
		const elsewhere = given({ bun: "none" });
		await copySecret(KEY, elsewhere.copy);
		elsewhere.copiedElsewhere("something else");
		elsewhere.due[0]!.run();
		await Bun.sleep(0);
		expect(elsewhere.writes).toEqual([KEY]);

		const unread = given({ bun: "none", readable: false });
		await copySecret(KEY, unread.copy);
		unread.due[0]!.run();
		await Bun.sleep(0);
		expect(unread.writes).toEqual([KEY]);
	});
});
