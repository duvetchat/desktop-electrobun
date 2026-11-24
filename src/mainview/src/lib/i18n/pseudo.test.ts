import { expect, test } from "bun:test";
import { IntlMessageFormat } from "intl-messageformat";
import { PSEUDO_CLOSE, PSEUDO_OPEN, pseudoMessage, pseudoMessages } from "./pseudo";

const format = (message: string, values?: Record<string, string | number>) =>
	new IntlMessageFormat(message, "en-XA").format(values);

test("accents the words, in brackets and a third longer", () => {
	const pseudo = pseudoMessage("Language");
	expect(pseudo.startsWith(`${PSEUDO_OPEN}Ļáñĝûáĝé`)).toBe(true);
	expect(pseudo.endsWith(PSEUDO_CLOSE)).toBe(true);
	expect(pseudo.length).toBeGreaterThanOrEqual(Math.ceil("Language".length * 1.33) + 2);
});

test("keeps the placeholders, so the message formats as the English does", () => {
	expect(format(pseudoMessage("Match system ({language})"), { language: "Español" })).toContain("(Español)");
});

test("accents each plural case's words and keeps its number", () => {
	const pseudo = pseudoMessage("{count, plural, one {# member} other {# members}}");
	expect(format(pseudo, { count: 1 })).toContain("1 ɱéɱƀéŕ");
	expect(format(pseudo, { count: 3 })).toContain("3 ɱéɱƀéŕš");
});

test("keeps the tags", () => {
	const pseudo = pseudoMessage("<b>{name}</b> pinned <link>a message</link>.");
	expect(pseudo).toContain("<b>{name}</b>");
	expect(pseudo).toContain("<link>á ɱéššáĝé</link>");
});

test("makes over a whole language file", () => {
	expect(Object.keys(pseudoMessages({ a: "One", b: "Two" }))).toEqual(["a", "b"]);
});
