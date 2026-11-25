// The pseudo-language (en-XA, lib/i18n/locale.ts): English with its letters accented, in brackets and a third longer.
// Only the words change: a message's placeholders, plural and select cases and tags are the English one's, so it
// formats as English does. Development builds load it when it's picked, and the tests render with it.
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js";

// Each plain letter and its accented one, in the same order.
const PLAIN = Array.from("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");
const ACCENTED = Array.from("áƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇÐÉƑĜĤÎĴĶĻṀÑÖƤǪŔŠŢÛṼŴẊÝŽ");

/** What every message of the pseudo-language starts and ends with: a string seen without them came from no key. */
export const PSEUDO_OPEN = "⟦";
export const PSEUDO_CLOSE = "⟧";

const accent = (text: string) => text.replace(/[A-Za-z]/g, (letter) => ACCENTED[PLAIN.indexOf(letter)] ?? letter);

/** Accents the words of each element, in place, and counts them. */
function walk(elements: MessageFormatElement[]): number {
	let letters = 0;
	for (const element of elements) {
		if (element.type === TYPE.literal) {
			letters += element.value.length;
			element.value = accent(element.value);
		} else if (element.type === TYPE.tag) {
			letters += walk(element.children);
		} else if (element.type === TYPE.plural || element.type === TYPE.select) {
			for (const option of Object.values(element.options)) letters += walk(option.value);
		}
	}
	return letters;
}

/** An English message in the pseudo-language. */
export function pseudoMessage(message: string): string {
	const elements = parse(message, { ignoreTag: false });
	const letters = walk(elements);
	const padding = "·".repeat(Math.ceil(letters / 3));
	return `${PSEUDO_OPEN}${printAST(elements)}${padding}${PSEUDO_CLOSE}`;
}

/** Every message of a language's file, in the pseudo-language. */
export function pseudoMessages(messages: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(messages).map(([key, message]) => [key, pseudoMessage(message)]));
}
