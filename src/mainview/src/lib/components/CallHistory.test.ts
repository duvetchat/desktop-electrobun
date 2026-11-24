import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../../messages/en.json";

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");
const components = readdirSync(import.meta.dir).filter((file) => file.endsWith(".svelte"));
const english: Record<string, string> = en;
// A button's label in English: its key's, or the words written in the tag.
const labelOf = (tag: string) => {
	const key = /\blabel=\{t\("(\w+)"\)\}/.exec(tag)?.[1];
	if (key) return english[key] ?? null;
	return /\blabel="([^"]*)"/.exec(tag)?.[1] ?? null;
};

// #369: the button that opens the call history had a phone, which reads as "start a call". It opens from a history
// mark wherever it opens from; the phone stays with what calls.
test("the call history opens from a history mark, never a phone", () => {
	// Whichever key says "Call history" (call_history_title does too), or the words themselves.
	const openers = components.flatMap((file) =>
		[...source(file).matchAll(/(<IconButton\b[^>]*\blabel=(?:"[^"]*"|\{t\("\w+"\)\})[^>]*>)\s*<(\w+)/g)]
			.filter((m) => labelOf(m[1]!) === "Call history")
			.map((m) => `${file}: ${m[2]}`),
	);
	expect(openers).toEqual(["SpaceNav.svelte: HistoryIcon"]);
	expect(source("SpaceNav.svelte")).toContain("History as HistoryIcon,");
});

test("a row's call back keeps its phone", () => {
	const rows = source("CallHistory.svelte");
	const start =
		/label=\{action === "join"\s*\? t\("call_history_join_label", \{ name: row\.title \}\)\s*: t\("call_history_call_label", \{ name: row\.title \}\)\}/.exec(
			rows,
		)?.index ?? -1;
	expect(start).toBeGreaterThan(-1);
	expect(en.call_history_join_label).toBe("Join the call in {name}");
	expect(en.call_history_call_label).toBe("Call {name}");
	expect(rows.slice(start, rows.indexOf("</IconButton>", start))).toContain("<PhoneIcon size={16} />");
});
