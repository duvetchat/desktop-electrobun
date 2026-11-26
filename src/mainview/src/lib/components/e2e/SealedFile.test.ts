import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A conversation's file as a message draws it (PLAN-E2E-CLIENTES.md, «Adjuntos», Review Focus 6): decrypted, a file
// is drawn in the element its own bytes are for, or saved as bytes; it never opens, so nothing of the sender's runs in
// the app's origin. Read from the component's source, as the other components' rules are.
const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8").replace(/\r\n/g, "\n");
const sealed = source("SealedFile.svelte");
const attachments = source("../MessageAttachments.svelte");
const audio = source("../AudioFilePlayer.svelte");

test("a decrypted file is drawn by its bytes or downloaded, never opened", () => {
	// The element is the bytes' (drawnBy, of the type sniffed from them), never what the sender called them.
	expect(sealed).toContain("drawnBy(ready.type)");
	// Nothing navigates to it: no new tab, no window, no link to follow; what isn't drawn is saved, as bytes.
	for (const opens of ['target="_blank"', "window.open", "location.", "<iframe", "<object", "<embed"]) {
		expect(sealed).not.toContain(opens);
	}
	expect(sealed).toContain("saveFile(ready.blob, file.name)");
	// Nor does the player it plays an audio file in: its name saves the decrypted file, and is no link to its URL
	// (task 18's review, M1).
	expect(sealed).toMatch(/<AudioFilePlayer\b[^>]*blob=\{ready\.blob\}/);
	expect(audio).toMatch(
		/\{#if blob\}\s*<!--[^>]*-->\s*<button\b[^>]*onclick=\{\(\) => blob && saveFile\(blob, filename\)\}[\s\S]*?\{:else\}\s*<a\b/,
	);
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
	expect(sealed).toContain("if (!auto || !near || !placeOfFile) return;");
	expect(sealed).toContain("void decryptedFiles.open(shown, messageId, { auto: true });");
});

// Task 18's review, I1, I4, I5, M2, M3 and M7: what a file's view does with its state.
test("a file is the one its message says, opened by itself only as it nears the screen", () => {
	// Its state is its own, by what its message says of it: never another message's file of the same ID.
	expect(sealed).toContain("const opened = $derived(decryptedFiles.state(file));");
	expect(sealed).toContain("decryptedFiles.state(ref)");
	expect(sealed).not.toMatch(/state\((file|ref)\.id\)/);
	// A loaded page mounts every row: a file comes by itself only once it's near.
	expect(sealed).toContain("new IntersectionObserver(");
	expect(sealed).toMatch(/rootMargin: "\d+px 0px"/);
	expect(sealed).toContain("if (!near || !placeOfRef) return;");
	expect(sealed).toContain("void decryptedFiles.open(thumb, messageId, { auto: true });");
});

test("a download that failed is asked again by a click, and says what failed", () => {
	expect(sealed).toContain('const again = $derived(opened?.status === "failed" && opened.reason === "download");');
	expect(sealed).toContain('"e2e_file_download_failed"');
	expect(sealed).toContain('disabled={opened?.status === "loading" || (!!failure && !again) || !listed}');
	expect(sealed).toMatch(/\{#if again\}\s*<button[^>]*onclick=\{fetchFile\}/);
});

test("a video plays by itself only after the click that asked for it, never under a spoiler", () => {
	expect(sealed).toMatch(/<video\b[^>]*autoplay=\{asked && !hidden\}/);
	expect(sealed).toMatch(/async function fetchFile\(\) \{\s*asked = true;/);
	expect(attachments).toContain('<SealedFile {preview} {att} kind="video" {hidden} />');
});

test("a picture its engine can't draw offers Save, as a video it can't play does", () => {
	expect(sealed).toMatch(/<img\b[^>]*data-decrypted[^>]*onerror=\{\(\) => \(undrawable = true\)\}/);
	expect(sealed).toContain('{#if drawn === "image" && ready && !undrawable}');
});

test("a file's card says to a screen reader what shows on it", () => {
	expect(sealed).toContain("aria-label={cardLabel}");
	expect(sealed).toMatch(
		/const cardLabel = \$derived\(\s*!listed\s*\?\s*file\.name\s*:\s*failure\s*\?\s*t\("e2e_file_named", \{ name: file\.name, status: failure \}\)/,
	);
	expect(sealed).toMatch(
		/opened\?\.status === "loading"\s*\?\s*t\("e2e_file_named", \{ name: file\.name, status: t\("e2e_file_progress"/,
	);
});

// Task 18's re-review, N3: a view that goes lets go of what it asked for, which comes down only while it's asked for.
test("a file a view no longer shows goes from the queue, by what its message says of it", () => {
	expect(sealed).toMatch(/return \(\) => decryptedFiles\.letGo\(shown\);/);
	expect(sealed).toMatch(/return \(\) => decryptedFiles\.letGo\(thumb\);/);
	// The list makes the file anew with each change: what's asked for is its place, not the object.
	expect(sealed).toContain("untrack(() => file)");
});

// Task 18's re-review, N6: a device search's results name no file the API serves: they ask nothing, and warn of nothing.
test("in a preview, a file without a URL is its name, size and thumbnail, with no warning", () => {
	const preview = source("../MessagePreview.svelte");
	expect(preview.match(/<MessageAttachments\b[^>]*\bpreview\b/g)).toHaveLength(2);
	expect(attachments.match(/<SealedFile\b[^>]*\{preview\}/g)?.length).toBe(5);
	expect(sealed).toContain("const listed = $derived(!!file.url || !preview);");
	expect(sealed).toMatch(/const failure = \$derived\(\s*opened\?\.status === "failed" && listed/);
});

// Step 5's review, M4 (desktop-electrobun#544): a thumbnail of its own came down whatever its file was laid out as,
// a file only saved on a click among them, and was never drawn there.
test("a thumbnail of its own is fetched only for a file laid out as a picture or a video", () => {
	expect(sealed).toMatch(/const ref = \$derived\(\s*file\.thumbnail_ref && \(kind === "image" \|\| kind === "video"\)/);
	expect(sealed).toContain("if (!near || !placeOfRef) return;");
});

// The mobile app's review (I3), for both apps: a sender writes a thumbnail's header, which can say any size.
test("a thumbnail is drawn only once its header says it's 320 px a side at most, at its box's size", () => {
	expect(sealed).toContain("if (!bytes || !thumbnailDrawn(bytes)) return;");
	expect(sealed).toMatch(/\.then\(\(head\) => current && \(refDrawn = thumbnailDrawn\(new Uint8Array\(head\)\)\)\)/);
	expect(sealed).toContain('refState?.status === "ready" && refDrawn ? refState.url : null');
	expect(sealed).toMatch(/<img src=\{thumbnail\} alt="" class="absolute inset-0 size-full object-cover/);
});
