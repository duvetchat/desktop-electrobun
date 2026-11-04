import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

// A message the API would refuse for its size isn't sent: the box says why and keeps its text and files, so a file can
// come out and the rest go (#182). The check comes before the send and before the box is emptied.
test("a message too large for the API stays in the box, with why, and nothing is sent", () => {
	const input = source("ChatInput.svelte");
	expect(input).toMatch(
		/const tooLarge = messageTooLarge\(raw, pendingFiles\);\s*if \(tooLarge\) \{\s*toast\(tooLarge, "error"\);\s*return;\s*\}\s*const filesToSend = [^;]+;\s*onSubmit\(raw, filesToSend\);\s*inputEl\.innerHTML = "";/,
	);
});
