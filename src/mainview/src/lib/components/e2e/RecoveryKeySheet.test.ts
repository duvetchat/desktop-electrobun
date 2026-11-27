import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import { NOTICES } from "$lib/e2e/notices";
import en from "../../../../messages/en.json";
import { tags } from "../server-render";

// The first device's recovery key (decision 23; PLAN-E2E-CLIENTES.md, Task 12): its 48 characters in 12 groups of 4,
// with Copy and Download, and "I saved it", without which nothing goes on.
const { default: RecoveryKeySheet } = await import("./RecoveryKeySheet.svelte");

const KEY = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnop";
const props = (saved: boolean, failed = false) => ({
	...{ recoveryKey: KEY, saved, failed },
	...{ onContinue: async () => {}, onLater: async () => {} },
});
const drawn = (saved: boolean, failed = false) =>
	render(RecoveryKeySheet, { props: props(saved, failed) }).body.replace(/<!--[^]*?-->/g, "");
const named = async (saved: boolean, name: string, failed = false) =>
	(await tags(RecoveryKeySheet, props(saved, failed))).filter((tag) => tag.name === name);
const words = (html: string) =>
	[...html.matchAll(/<button [^>]*>\s*(?:<svg[^]*?<\/svg>\s*)?([^<]*?)\s*<\/button>/g)].map((match) => match[1]);

describe("the recovery key's sheet", () => {
	test("the key shows in 12 groups of 4", () => {
		const groups = [...drawn(false).matchAll(/<li[^>]*>\s*([^<]*?)\s*<\/li>/g)].map((match) => match[1]);
		expect(groups).toHaveLength(12);
		expect(groups.every((group) => group?.length === 4)).toBe(true);
		expect(groups.join("")).toBe(KEY);
	});

	test("nothing goes on until I saved it is ticked", async () => {
		const [box] = await named(false, "input");
		expect(box?.attributes).toMatchObject({ type: "checkbox" });
		expect(box?.attributes).not.toHaveProperty("checked");
		const go = (await named(false, "button")).at(-1);
		expect(go?.attributes).toHaveProperty("disabled");
		expect(drawn(false)).toContain("I saved it");

		// Ticked, it goes on.
		expect((await named(true, "input"))[0]?.attributes).toHaveProperty("checked");
		expect((await named(true, "button")).at(-1)?.attributes).not.toHaveProperty("disabled");
	});

	// #569: as a secret, which Bun keeps out of Windows' clipboard history and the cloud clipboard, and which comes off
	// the clipboard a minute later (lib/e2e/secret-copy.ts).
	test("copies the key as a secret, never through the page's clipboard itself", () => {
		const source = readFileSync(join(import.meta.dir, "RecoveryKeySheet.svelte"), "utf8");
		expect(source).toContain("copySecret(");
		expect(source).not.toContain("navigator.clipboard");
	});

	test("offers to copy the key and to download it", () => {
		const html = drawn(false);
		expect(html).toMatch(/<button [^>]*>\s*(?:<svg[^]*?<\/svg>\s*)?Copy\s*<\/button>/);
		expect(html).toMatch(/<button [^>]*>\s*(?:<svg[^]*?<\/svg>\s*)?Download\s*<\/button>/);
	});

	// Both apps say the notices word for word (lib/e2e/notices.ts, which the mobile app's test holds to the same table).
	test("says it in the notices' words", () => {
		expect(en.e2e_recovery_title).toBe(NOTICES.recovery_title);
		expect(en.e2e_recovery_saved).toBe(NOTICES.recovery_saved);
	});

	// I2: the key saved, what's left is its upload, which Finish brings back with the same bytes.
	test("after a failed upload, Later closes the sheet beside Continue, which tries again", () => {
		expect(words(drawn(true))).toEqual(["Copy", "Download", "Continue"]);
		const failed = drawn(true, true);
		expect(failed).toContain(en.e2e_recovery_failed);
		expect(words(failed)).toEqual(["Copy", "Download", "Later", "Continue"]);
	});
});
