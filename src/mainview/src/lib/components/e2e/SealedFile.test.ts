import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A conversation's file as a message draws it (PLAN-E2E-CLIENTES.md, «Adjuntos», Review Focus 6): decrypted, a file
// is drawn in the element its own bytes are for, or saved as bytes; it never opens, so nothing of the sender's runs in
// the app's origin. Read from the component's source, as the other components' rules are.
const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8").replace(/\r\n/g, "\n");
const sealed = source("SealedFile.svelte");
const attachments = source("../MessageAttachments.svelte");

test("a decrypted file is drawn by its bytes or downloaded, never opened", () => {
	// The element is the bytes' (drawnBy, of the type sniffed from them), never what the sender called them.
	expect(sealed).toContain("drawnBy(ready.type)");
	// Nothing navigates to it: no new tab, no window, no link to follow; what isn't drawn is saved, as bytes.
	for (const opens of ['target="_blank"', "window.open", "location.", "<iframe", "<object", "<embed"]) {
		expect(sealed).not.toContain(opens);
	}
	expect(sealed).toContain("saveFile(ready.blob, file.name)");
	// A picture and a video are marked as decrypted, which the default menu reads: Copy image, nothing to open.
	expect(sealed.match(/<img\b[^>]*data-decrypted/g)?.length).toBeGreaterThan(0);
	expect(sealed).toMatch(/<video\b[^>]*data-decrypted/);
	// A message's sealed files take this path alone: the API's URL of one is never drawn or linked as it is.
	expect(attachments).toContain("<SealedFile");
	expect(attachments).toMatch(/\{#if att\.sealed\}/);
});

test("a video is downloaded whole, with its progress, before it plays", () => {
	// Its element gets the file once it's all here, decrypted; until then its thumbnail and the bar of how far it is.
	expect(sealed.match(/<video\b/g)).toHaveLength(1);
	expect(sealed).toMatch(/<video\b[^>]*src=\{ready\.url\}/);
	expect(sealed).toContain('const ready = $derived(opened?.status === "ready" ? opened : null);');
	expect(sealed).toMatch(/opened\?\.status === "loading"[\s\S]*?progress/);
	// Asked for by a click, not as the message shows: 20 MiB at most, whole.
	expect(sealed).toMatch(/const auto = \$derived\(kind === "image" \|\| kind === "audio" \|\| kind === "voice"\);/);
	expect(sealed).toContain("if (auto) void decryptedFiles.open(file, messageId, { auto: true });");
});
