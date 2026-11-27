import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../../messages/en.json";

// The dialog is bits-ui's, whose content a server render leaves out: what it must hold is read from its source.
const source = readFileSync(join(import.meta.dir, "TextFilePreview.svelte"), "utf8");

test("is a dialog titled by the file, with its text read-only", () => {
	expect(source).toContain('<Sheet bind:open title={filename} description={t("media_text_preview_description")}>');
	expect(en.media_text_preview_description).toBe("Read-only preview.");
	expect(source).toContain("\t\t\treadonly");
	expect(source).toContain('aria-label={t("media_text_preview_contents", { filename })}');
	expect(en.media_text_preview_contents).toBe("Contents of {filename}");
	expect(source).toContain("value={text}");
});

test("reads the file when it opens, and lets go of what a closed one had on its way", () => {
	expect(source).toContain("const preview = await readTextPreview(src);");
	expect(source).toMatch(/\$effect\(\(\) => \{[\s\S]*?if \(!open\) \{[\s\S]*?read\+\+;/);
	// A failed read says so, without the dialog going away.
	expect(source).toContain('error = "media_text_preview_failed";');
	expect(en.media_text_preview_failed).toBe("Couldn't read this file.");
	expect(source).toContain("{#if truncated}");
});

test("copies the text with a button, saying Copied! beside it for 1500 ms", () => {
	expect(source).toContain("navigator.clipboard.writeText(text)");
	expect(source).toContain('label={t("media_text_preview_copy_label")}');
	expect(en.media_text_preview_copy_label).toBe("Copy the text");
	expect(source).toContain("const COPIED_MS = 1500;");
	expect(source).toContain('{t("media_text_preview_copied")}');
	expect(en.media_text_preview_copied).toBe("Copied!");
	expect(source).toContain('role="status" aria-live="polite"');
	expect(source).toContain("}, COPIED_MS);");
});
