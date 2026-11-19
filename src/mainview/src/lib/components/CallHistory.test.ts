import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");
const components = readdirSync(import.meta.dir).filter((file) => file.endsWith(".svelte"));

// #369: the button that opens the call history had a phone, which reads as "start a call". It opens from a history
// mark wherever it opens from; the phone stays with what calls.
test("the call history opens from a history mark, never a phone", () => {
	const openers = components.flatMap((file) =>
		[...source(file).matchAll(/<IconButton\b[^>]*\blabel="Call history"[^>]*>\s*<(\w+)/g)].map(
			(m) => `${file}: ${m[1]}`,
		),
	);
	expect(openers).toEqual(["SpaceNav.svelte: HistoryIcon"]);
	expect(source("SpaceNav.svelte")).toContain("History as HistoryIcon,");
});

test("a row's call back keeps its phone", () => {
	const rows = source("CallHistory.svelte");
	const start = rows.indexOf('label={action === "join" ? `Join the call in ${row.title}` : `Call ${row.title}`}');
	expect(start).toBeGreaterThan(-1);
	expect(rows.slice(start, rows.indexOf("</IconButton>", start))).toContain("<PhoneIcon size={16} />");
});
