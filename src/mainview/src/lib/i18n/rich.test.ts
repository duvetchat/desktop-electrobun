import { expect, test } from "bun:test";
import { richFormat, richPieces } from "./rich";

const pieces = (message: string, values?: Record<string, string | number>, locale = "en") =>
	richPieces(richFormat(message, locale), values);

test("a sentence with tags comes in its words and each tag's", () => {
	expect(pieces("<b>{name}</b> pinned <link>a message</link> to this room.", { name: "Ana" })).toEqual([
		{ tag: "b", text: "Ana" },
		" pinned ",
		{ tag: "link", text: "a message" },
		" to this room.",
	]);
});

test("each language puts the tags where its sentence needs them", () => {
	expect(pieces("<link>Un mensaje</link> fijado por <b>{name}</b>.", { name: "Ana" }, "es")).toEqual([
		{ tag: "link", text: "Un mensaje" },
		" fijado por ",
		{ tag: "b", text: "Ana" },
		".",
	]);
});

test("a value with a tag in it stays words", () => {
	expect(pieces("Hi {name}!", { name: "<b>Eve</b>" })).toEqual(["Hi <b>Eve</b>!"]);
});

test("tags work inside plural cases", () => {
	const message = "{count, plural, one {<b>#</b> new message} other {<b>#</b> new messages}}";
	expect(pieces(message, { count: 3 })).toEqual([{ tag: "b", text: "3" }, " new messages"]);
});

test("a message without tags is one piece", () => {
	expect(pieces("Language")).toEqual(["Language"]);
});
