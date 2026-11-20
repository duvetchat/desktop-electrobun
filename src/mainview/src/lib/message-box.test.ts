import { describe, expect, test } from "bun:test";
import { breakLine, caretAt, enterKey, lineBreaksHtml, rawOf, rawOffsetOf, type CaretPlace } from "./message-box";

// The box's nodes as a web view holds them, with only what lib/message-box.ts reads of a node.
type Fake = {
	nodeType: number;
	textContent: string | null;
	childNodes: Fake[];
	tagName?: string;
	alt?: string;
	getAttribute?: (name: string) => string | null;
};
const text = (data: string): Fake => ({ nodeType: 3, textContent: data, childNodes: [] });
const element = (tagName: string, childNodes: Fake[] = [], attributes: Record<string, string> = {}): Fake => ({
	nodeType: 1,
	textContent: null,
	childNodes,
	tagName,
	getAttribute: (name) => attributes[name] ?? null,
});
const br = () => element("BR");
const box = (...children: Fake[]) => element("DIV", children);
const KOFI = "01a1f07c-1d6a-727a-8161-196de208c63c";
const chip = () => element("SPAN", [text("@Kofi Mensah")], { "data-mention": KOFI });

/** The nodes the box holds for a text without chips: what a web view makes of the HTML ChatInput writes for it. */
function shown(raw: string): Fake {
	const lines = lineBreaksHtml(raw).split("<br>");
	return box(...lines.flatMap((line, i) => [...(line ? [text(line)] : []), ...(i < lines.length - 1 ? [br()] : [])]));
}

/** A place among the box's own nodes as a selection gives it: a container and an offset in it. */
function selection(nodes: Fake, place: CaretPlace<Fake>): [Fake, number] {
	if (typeof place.at === "number") return [place.node, place.at];
	return [nodes, nodes.childNodes.indexOf(place.node) + (place.at === "after" ? 1 : 0)];
}

/** How many lines the box shows: one, and one more for each line break that something follows. A last break shows
 * none. */
function linesShown(nodes: Fake): number {
	const breaks = nodes.childNodes.filter((n) => n.tagName === "BR").length;
	return 1 + breaks - (nodes.childNodes.at(-1)?.tagName === "BR" ? 1 : 0);
}

/** The line the caret is on, from 0: the line breaks before it. */
function caretLine(nodes: Fake, place: CaretPlace<Fake>): number {
	const [container, offset] = selection(nodes, place);
	const upTo = container === nodes ? offset : nodes.childNodes.indexOf(container);
	return nodes.childNodes.slice(0, upTo).filter((n) => n.tagName === "BR").length;
}

// #415: Shift+Enter showed a line break and left the caret where it was (WebKit, on macOS), and typing went on on the
// old line. The box makes the break itself now: one "\n" in the text, a line for it in the box, and the caret on it.
describe("Shift+Enter starts a new line", () => {
	function typed(raw: string, start: number, end = start) {
		const next = breakLine(raw, start, end);
		const nodes = shown(next.raw);
		const place = caretAt(nodes, next.caret);
		if (!place) throw new Error(`no place for the caret at ${next.caret}`);
		return { next, nodes, place };
	}

	test("at the end of the text", () => {
		const { next, nodes, place } = typed("abc", 3);
		expect(next).toEqual({ raw: "abc\n", caret: 4 });
		// One line break in what the box holds, and in what is read back from it.
		expect(nodes.childNodes.map((n) => n.tagName ?? n.textContent)).toEqual(["abc", "BR", "BR"]);
		expect(rawOf(nodes)).toBe("abc\n");
		// The caret is on the second of two lines, and reads back as where it was put.
		expect(linesShown(nodes)).toBe(2);
		expect(caretLine(nodes, place)).toBe(1);
		expect(rawOffsetOf(nodes, ...selection(nodes, place))).toBe(4);
	});

	test("in the middle of the text", () => {
		const { next, nodes, place } = typed("abcd", 2);
		expect(next).toEqual({ raw: "ab\ncd", caret: 3 });
		expect(nodes.childNodes.map((n) => n.tagName ?? n.textContent)).toEqual(["ab", "BR", "cd"]);
		expect(rawOf(nodes)).toBe("ab\ncd");
		expect(linesShown(nodes)).toBe(2);
		expect(caretLine(nodes, place)).toBe(1);
		expect(rawOffsetOf(nodes, ...selection(nodes, place))).toBe(3);
	});

	test("in an empty box", () => {
		const { next, nodes, place } = typed("", 0);
		expect(next).toEqual({ raw: "\n", caret: 1 });
		expect(nodes.childNodes.map((n) => n.tagName)).toEqual(["BR", "BR"]);
		expect(rawOf(nodes)).toBe("\n");
		expect(linesShown(nodes)).toBe(2);
		expect(caretLine(nodes, place)).toBe(1);
		expect(rawOffsetOf(nodes, ...selection(nodes, place))).toBe(1);
	});

	test("again on the new line: a line each time", () => {
		const { next, nodes, place } = typed("abc\n", 4);
		expect(next).toEqual({ raw: "abc\n\n", caret: 5 });
		expect(rawOf(nodes)).toBe("abc\n\n");
		expect(linesShown(nodes)).toBe(3);
		expect(caretLine(nodes, place)).toBe(2);
	});

	test("over a selection, whichever way it was made: the break takes its place", () => {
		expect(breakLine("abcd", 1, 3)).toEqual({ raw: "a\nd", caret: 2 });
		expect(breakLine("abcd", 3, 1)).toEqual({ raw: "a\nd", caret: 2 });
	});

	test("right after a mention's chip, and right before one", () => {
		const after = box(chip(), br(), br());
		expect(rawOf(after)).toBe(`<@${KOFI}>\n`);
		expect(caretAt(after, rawOf(after).length)).toEqual({ node: after.childNodes[1]!, at: "after" });

		// Before the chip: the chip goes down a line, and the caret with it.
		const before = box(br(), chip(), text(" "));
		expect(rawOf(before)).toBe(`\n<@${KOFI}> `);
		expect(caretAt(before, 1)).toEqual({ node: before.childNodes[0]!, at: "after" });
		expect(rawOffsetOf(before, before, 1)).toBe(1);
	});
});

describe("Enter", () => {
	const key = (over: Partial<Parameters<typeof enterKey>[0]> = {}) => ({
		key: "Enter",
		shiftKey: false,
		isComposing: false,
		...over,
	});

	test("still sends, and with Shift starts a new line", () => {
		expect(enterKey(key())).toBe("send");
		expect(enterKey(key({ shiftKey: true }))).toBe("break");
	});

	test("is the IME's own while it composes: neither sent nor a line break", () => {
		expect(enterKey(key({ isComposing: true }))).toBeNull();
		expect(enterKey(key({ shiftKey: true, isComposing: true }))).toBeNull();
	});

	test("is the only key that does either", () => {
		for (const other of ["a", "Tab", "Escape", " "]) expect(enterKey(key({ key: other, shiftKey: true }))).toBeNull();
	});
});

describe("the text the box holds", () => {
	test("comes back as it was written, line breaks and all", () => {
		for (const raw of ["", "abc", "\n", "abc\n", "abc\n\n", "\nabc", "ab\n\ncd\n"]) expect(rawOf(shown(raw))).toBe(raw);
	});

	test("a last line break shows no line, and isn't text: an emptied box is empty", () => {
		// What a web view leaves in a box whose text was deleted, and after Backspace on a last, empty line.
		expect(rawOf(box(br()))).toBe("");
		expect(rawOf(box(text("abc"), br()))).toBe("abc");
		// A caret left after that break is at the text's end, not past it.
		const left = box(br());
		expect(rawOffsetOf(left, left, 1)).toBe(0);
		const emptied = box(text("abc"), br());
		expect(rawOffsetOf(emptied, emptied, 2)).toBe(3);
	});

	test("chips and custom emoji read as their raw form", () => {
		const emoji = element("IMG", [], { "data-cemoji": "0c0ffee0" });
		const room = element("SPAN", [text("#general")], { "data-room": "0badcafe" });
		expect(rawOf(box(text("hi "), chip(), text(" in "), room, text(" "), emoji))).toBe(
			`hi <@${KOFI}> in <#0badcafe> <:0c0ffee0:>`,
		);
	});

	// What WebKit makes of a line break it is left to make: a paragraph around a break. The text counted its line and
	// the caret's offset didn't, which is how the caret stayed on the old line (#415).
	test("a paragraph a web view made is one line break, in the text and in the caret's offset", () => {
		const paragraph = element("DIV", [br()]);
		const nodes = box(text("abc"), paragraph);
		expect(rawOf(nodes)).toBe("abc\n");
		expect(rawOffsetOf(nodes, paragraph, 0)).toBe(4);
		// With text in it, and the caret in that text.
		const word = text("de");
		const written = box(text("abc"), element("DIV", [word]));
		expect(rawOf(written)).toBe("abc\nde");
		expect(rawOffsetOf(written, word, 1)).toBe(5);
		expect(caretAt(written, 5)).toEqual({ node: word, at: 1 });
	});
});

describe("the caret", () => {
	test("goes where every offset of the text says, and reads back as that offset", () => {
		const raw = "ab\n\ncd\n";
		const nodes = shown(raw);
		for (let offset = 0; offset <= raw.length; offset++) {
			const place = caretAt(nodes, offset);
			if (!place) throw new Error(`no place for the caret at ${offset}`);
			expect(rawOffsetOf(nodes, ...selection(nodes, place))).toBe(offset);
			expect(caretLine(nodes, place)).toBe(raw.slice(0, offset).split("\n").length - 1);
		}
	});

	test("past the text is at its end: before a last break, never after it", () => {
		const word = shown("abc");
		expect(caretAt(word, 99)).toEqual({ node: word.childNodes[0]!, at: 3 });
		const broken = shown("abc\n");
		expect(caretAt(broken, 99)).toEqual({ node: broken.childNodes[1]!, at: "after" });
		// The break a web view leaves in a box it emptied: the caret is before it.
		const emptied = box(br());
		expect(caretAt(emptied, 99)).toEqual({ node: emptied.childNodes[0]!, at: "before" });
		// A box that holds nothing has no place to give: the component puts the caret in the box itself.
		expect(caretAt(box(), 0)).toBeNull();
	});

	test("at the text's start is before its first node, on the first line", () => {
		const broken = shown("\nabc");
		const start = caretAt(broken, 0);
		expect(start).toEqual({ node: broken.childNodes[0]!, at: "before" });
		expect(start && caretLine(broken, start)).toBe(0);
		const mentioned = box(chip(), text(" hi"));
		expect(caretAt(mentioned, 0)).toEqual({ node: mentioned.childNodes[0]!, at: "before" });
	});

	test("goes after a chip it can't enter, and before one that follows text", () => {
		const said = text("hi ");
		const nodes = box(said, chip(), text(" "));
		const mention = `<@${KOFI}>`.length;
		expect(caretAt(nodes, 3)).toEqual({ node: said, at: 3 });
		expect(caretAt(nodes, 3 + mention)).toEqual({ node: nodes.childNodes[1]!, at: "after" });
		expect(rawOffsetOf(nodes, nodes, 2)).toBe(3 + mention);
	});
});
