// Bun's own words (#464): the menu_, window_ and os_ messages of each of the app's language files
// (src/mainview/messages/<locale>.json), and the pseudo-language's made from English's. i18n.ts imports this as a macro
// (with { type: "macro" }): it runs as Bun's bundle is built, which then holds these messages as they are and none of
// the page's, the thousands the page has itself. The tests and `bun run` run it as they read i18n.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALES, PSEUDO } from "../mainview/src/lib/i18n/locale";
import { pseudoMessages } from "../mainview/src/lib/i18n/pseudo";

/** The prefixes of the keys whose words the Bun process shows (src/mainview/messages/README.md). */
export const BUN_PREFIXES = ["menu_", "window_", "os_"] as const;

export const isBunKey = (key: string) => BUN_PREFIXES.some((prefix) => key.startsWith(prefix));

const MESSAGES = join(import.meta.dir, "..", "mainview", "messages");

/** A language file's messages of Bun's. */
function bunOnly(locale: string): Record<string, string> {
	const file: Record<string, unknown> = JSON.parse(readFileSync(join(MESSAGES, `${locale}.json`), "utf8"));
	return Object.fromEntries(
		Object.entries(file).filter(
			(entry): entry is [string, string] => isBunKey(entry[0]) && typeof entry[1] === "string",
		),
	);
}

/** Each language's messages of Bun's, by locale, the pseudo-language's among them. */
export function bunMessages(): Record<string, Record<string, string>> {
	const messages = Object.fromEntries(LOCALES.map((locale) => [locale, bunOnly(locale)]));
	return { ...messages, [PSEUDO]: pseudoMessages(messages.en ?? {}) };
}
