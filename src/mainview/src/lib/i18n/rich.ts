// A message whose sentence has markup in it (#464), in pieces: "<b>{name}</b> pinned <link>a message</link>." gives its
// words and each tag's words with the tag's name, for Rich.svelte to draw each tag as its caller says. The values are
// filled in after the message is read, so a name with a tag in it stays words.
import { IntlMessageFormat } from "intl-messageformat";
import { TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";

/** A piece of a message with tags in it: words, or the words inside a tag and the tag's name. */
export type RichPart = string | { tag: string; text: string };

export type RichValues = Record<string, string | number | Date>;

function tagNames(elements: MessageFormatElement[], names = new Set<string>()): Set<string> {
	for (const element of elements) {
		if (element.type === TYPE.tag) {
			names.add(element.value);
			tagNames(element.children, names);
		} else if (element.type === TYPE.plural || element.type === TYPE.select) {
			for (const option of Object.values(element.options)) tagNames(option.value, names);
		}
	}
	return names;
}

const words = (chunks: (string | RichPart)[]) =>
	chunks.map((chunk) => (typeof chunk === "string" ? chunk : chunk.text)).join("");

/** A message read once, in a language, with tags. */
export function richFormat(message: string, locale: string): IntlMessageFormat {
	return new IntlMessageFormat(message, locale, undefined, { ignoreTag: false });
}

/** The message's pieces with its values filled in. A tag inside another gives its words to the outer one. */
export function richPieces(format: IntlMessageFormat, values: RichValues = {}): RichPart[] {
	const tags: Record<string, (chunks: (string | RichPart)[]) => RichPart> = {};
	for (const name of tagNames(format.getAst())) tags[name] = (chunks) => ({ tag: name, text: words(chunks) });
	const formatted = format.format<RichPart>({ ...values, ...tags });
	const parts: RichPart[] = [];
	for (const part of Array.isArray(formatted) ? formatted : [formatted]) {
		const last = parts.at(-1);
		if (typeof part === "string" && typeof last === "string") parts[parts.length - 1] = last + part;
		else parts.push(part);
	}
	return parts;
}
