// Puts the keys of every file in messages/ in alphabetical order (lib/i18n.test.ts checks it), so branches that each add
// words to a language's file land them in different places and merge cleanly. usage: bun run messages:sort
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..", "messages");
for (const name of readdirSync(dir).filter((file) => file.endsWith(".json"))) {
	const path = join(dir, name);
	const messages: Record<string, string> = JSON.parse(readFileSync(path, "utf8"));
	const sorted = Object.fromEntries(
		Object.keys(messages)
			.sort()
			.map((key) => [key, messages[key]]),
	);
	writeFileSync(path, `${JSON.stringify(sorted, null, "\t")}\n`);
}
