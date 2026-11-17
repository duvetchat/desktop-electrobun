import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The blink effect patches/facehash-sv@0.0.5.patch gives every default avatar (facehash-sv's Facehash), as it adds it. */
function blinkEffect(patch: string): string {
	const added = patch
		.split(/\r?\n/)
		.filter((line) => line.startsWith("+") && !line.startsWith("+++"))
		.map((line) => line.slice(1))
		.join("\n");
	return added.slice(added.indexOf("// deterministic blink"), added.indexOf("let blinkTiming"));
}

// The blink our patch gives every default avatar started an interval inside a timeout, and returned that interval's
// cleanup from the timeout's callback, where nothing calls it: each face kept blinking after it went, and its timer held
// the face's props, its UserAvatar and the message row around it for good. Every timer the effect starts is cleared by
// its cleanup.
test("a default avatar's blink stops with the avatar", () => {
	const effect = blinkEffect(readFileSync(join(import.meta.dir, "../../../patches/facehash-sv@0.0.5.patch"), "utf8"));
	const cleanup = effect.slice(effect.lastIndexOf("return () => {"));
	expect(effect.match(/setInterval\(/g)).toHaveLength(2);
	expect(cleanup).toContain("clearTimeout(timeout);");
	expect(cleanup).toContain("clearInterval(delayed);");
	expect(cleanup).toContain("clearInterval(id);");
	expect(cleanup).toContain("clearTimeout(open);");
	// One cleanup, the effect's own: none returned from a timer's callback.
	expect(effect.match(/return \(\) =>/g)).toHaveLength(1);
});
