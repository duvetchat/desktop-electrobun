import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Attachments list in Settings: the magnifier the chat's attachments have, for a picture or a text file.
const settings = readFileSync(join(import.meta.dir, "SettingsScreen.svelte"), "utf8");

test("an image or a text file has a magnifier, to the left of its download", () => {
	const preview = settings.indexOf('label="Preview {att.filename}"');
	const download = settings.indexOf('aria-label="Download {att.filename}"');
	expect(preview).toBeGreaterThan(-1);
	expect(download).toBeGreaterThan(-1);
	expect(preview).toBeLessThan(download);
	expect(settings).toContain("{#if isImage || isText}");
	expect(settings).toContain("isImageAttachment(att.content_type)");
	expect(settings).toContain("isTextAttachment(att.content_type, att.filename)");
});

test("opens the chat's image viewer for a picture and the read-only dialog for a text file", () => {
	expect(settings).toContain("<ImagePreview src={previewSrc} alt={previewAlt} bind:open={previewOpen} />");
	expect(settings).toContain(
		"<TextFilePreview bind:open={textPreviewOpen} filename={textPreviewName} src={textPreviewSrc} />",
	);
	// The magnifier and the file's own icon each open it.
	expect(settings.match(/openPreview\(src, att\.filename\)/g)?.length).toBeGreaterThanOrEqual(2);
	expect(settings.match(/openTextPreview\(src, att\.filename\)/g)?.length).toBeGreaterThanOrEqual(2);
	expect(settings.match(/aria-label="Preview \{att\.filename\}"/g)).toHaveLength(2);
});

test("every file has a checkbox for deletion, and the selected ones get a button left of Delete all", () => {
	expect(settings).toContain('aria-label="Select {att.filename} for deletion"');
	expect(settings).toContain("selectedForDelete");
	expect(settings).toContain("handleDeleteSelected");
	expect(settings).toContain("Delete selected");
	expect(settings).toContain('variant="warn"');
	expect(settings).toContain("disabled={selectedDeleteCount === 0}");
	expect(settings).toContain("Promise.allSettled");
	expect(settings).toContain("Delete ${count} selected attachment");
	const all = settings.lastIndexOf("Delete all");
	const selected = settings.lastIndexOf("Delete selected");
	expect(selected).toBeGreaterThan(-1);
	expect(all).toBeGreaterThan(-1);
	expect(selected).toBeLessThan(all);
});
