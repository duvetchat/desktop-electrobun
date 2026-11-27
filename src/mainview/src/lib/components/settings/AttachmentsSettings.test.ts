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
	// The magnifier and the file's own icon each open it.
	expect(settings.match(/openPreview\(src, att\.filename\)/g)?.length).toBeGreaterThanOrEqual(2);
	expect(settings.match(/openTextPreview\(src, att\.filename\)/g)?.length).toBeGreaterThanOrEqual(2);
	expect(
		settings.match(/aria-label=\{t\("settings_attachment_preview_named", \{ name: att\.filename \}\)\}/g),
	).toHaveLength(2);
});

test("every file has a checkbox for deletion, and the selected ones get a button left of Delete all", () => {
	expect(settings).toContain('aria-label={t("settings_attachment_select_delete", { name: att.filename })}');
	expect(en.settings_attachment_select_delete).toBe("Select {name} for deletion");
	expect(settings).toContain("selectedForDelete");
	expect(settings).toContain("handleDeleteSelected");
	expect(settings).toContain('{t("settings_attachments_delete_selected")}');
	expect(en.settings_attachments_delete_selected).toBe("Delete selected");
	expect(settings).toContain('variant="warn"');
	expect(settings).toContain("disabled={selectedDeleteCount === 0}");
	expect(settings).toContain("Promise.allSettled");
	expect(settings).toContain('t("settings_attachments_delete_selected_confirm", { count })');
	expect(en.settings_attachments_delete_selected_confirm).toContain("Delete # selected attachment");
	const all = settings.lastIndexOf('{t("settings_attachments_delete_all")}');
	const selected = settings.lastIndexOf('{t("settings_attachments_delete_selected")}');
	expect(selected).toBeGreaterThan(-1);
	expect(all).toBeGreaterThan(-1);
	expect(selected).toBeLessThan(all);
});
