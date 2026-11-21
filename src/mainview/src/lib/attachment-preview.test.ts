import { describe, expect, test } from "bun:test";
import { isImageAttachment, isTextAttachment } from "$lib/attachment-preview";

describe("what the Attachments list can preview", () => {
	test("a picture is an image, whatever its format", () => {
		for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "IMAGE/PNG"])
			expect(isImageAttachment(type), type).toBe(true);
		for (const type of ["text/plain", "application/pdf", "audio/ogg", "video/mp4", ""])
			expect(isImageAttachment(type), type).toBe(false);
	});

	test("a text file says so by its type, or by a name whose extension is text", () => {
		for (const type of ["text/plain", "text/markdown", "text/csv", "text/html; charset=utf-8"])
			expect(isTextAttachment(type, "file"), type).toBe(true);
		for (const type of ["application/json", "application/xml", "application/javascript", "application/x-yaml"])
			expect(isTextAttachment(type, "file"), type).toBe(true);
		// Uploaded as a blob, its name still says what it is.
		for (const name of ["notes.txt", "README.md", "build.log", "data.json", "rows.csv", "App.svelte", "run.sh"])
			expect(isTextAttachment("application/octet-stream", name), name).toBe(true);
		expect(isTextAttachment("application/octet-stream", "ARCHIVE.ZIP")).toBe(false);
	});

	test("a picture or a binary is no text, even with a name that could pass", () => {
		expect(isTextAttachment("image/png", "photo.png")).toBe(false);
		expect(isTextAttachment("application/pdf", "book.pdf")).toBe(false);
		// A named binary format wins over a name that looks textual; a nameless upload leaves it to the name.
		expect(isTextAttachment("application/zip", "notes.txt")).toBe(false);
		expect(isTextAttachment("application/octet-stream", "notes.txt")).toBe(true);
		expect(isTextAttachment("", "notes.txt")).toBe(true);
		expect(isTextAttachment("application/octet-stream", "archive")).toBe(false);
		expect(isTextAttachment("application/octet-stream", ".env")).toBe(false);
	});
});
