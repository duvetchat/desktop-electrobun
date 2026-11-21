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
	expect(settings).toContain("openPreview(src, att.filename)");
	expect(settings).toContain("openTextPreview(src, att.filename)");
	// Both live in the Attachments section, and so in the settings sheet's dialog: outside it, the sheet would take a
	// press on the viewer for one outside and close.
	const attachments = settings.indexOf('{:else if activeSection === "attachments"}');
	const buckets = settings.indexOf('{:else if activeSection === "buckets"}');
	const viewer = settings.indexOf("<ImagePreview src={previewSrc}");
	expect(attachments).toBeGreaterThan(-1);
	expect(viewer).toBeGreaterThan(attachments);
	expect(viewer).toBeLessThan(buckets);
});

// A transform makes a box the containing block of its fixed descendants: the sheet centered by one would keep the
// viewer's fixed box in the sheet, not over the window.
test("the settings sheet centers itself without a transform", () => {
	const frame = readFileSync(join(import.meta.dir, "SettingsFrame.svelte"), "utf8");
	expect(frame).toContain("fixed inset-0 z-501 m-auto");
	expect(frame).not.toContain("-translate-x-1/2 -translate-y-1/2");
});
