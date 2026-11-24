import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../../../messages/en.json";

// The Attachments list in Settings: the magnifier the chat's attachments have, for a picture or a text file.
const settings = readFileSync(join(import.meta.dir, "SettingsScreen.svelte"), "utf8");

test("an image or a text file has a magnifier, to the left of its download", () => {
	const preview = settings.indexOf('label={t("settings_attachment_preview_named", { name: att.filename })}');
	const download = settings.indexOf('aria-label={t("settings_attachment_download_named", { name: att.filename })}');
	expect(en.settings_attachment_preview_named).toBe("Preview {name}");
	expect(en.settings_attachment_download_named).toBe("Download {name}");
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
});
