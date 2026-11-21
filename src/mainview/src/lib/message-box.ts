// The message box's text (ChatInput.svelte). The box is a contenteditable that the component writes from the raw text
// and reads back after every edit: text in text nodes, a line break as a <br>, and a mention, a room or a custom emoji
// as one node the caret can't enter, which stands for its raw form (<@id>, <#id>, <:id:>).
//
// These read only what BoxNode names of a node, so they run on the web view's nodes and on a test's stand-ins.

/** What is read of a node in the box. */
export interface BoxNode {
	readonly nodeType: number;
	readonly textContent: string | null;
	readonly childNodes: ArrayLike<BoxNode>;
	readonly tagName?: string;
	readonly alt?: string;
	getAttribute?(name: string): string | null;
}

/** A node whose children are nodes of its own kind: a place among them is one of them. */
export interface BoxTree<N extends BoxNode> extends BoxNode {
	readonly childNodes: ArrayLike<N>;
}

const TEXT_NODE = 3;

/** The raw text of a node the caret can't enter (a line break, a mention's or a room's chip, an emoji's image); null
 * for a node that holds others. */
function atom(node: BoxNode): string | null {
	if (node.tagName === "BR") return "\n";
	const mention = node.getAttribute?.("data-mention");
	if (mention) return `<@${mention}>`;
	const room = node.getAttribute?.("data-room");
	if (room) return `<#${room}>`;
	const emoji = node.getAttribute?.("data-cemoji");
	if (emoji) return `<:${emoji}:>`;
	if (node.tagName === "IMG") return node.alt ?? "";
	return null;
}

/** A paragraph, which starts on a line of its own. The component writes none: WebKit makes one for a line break it is
 * left to make. */
const startsLine = (node: BoxNode) => node.tagName === "DIV" || node.tagName === "P";

function read(node: BoxNode): string {
	if (node.nodeType === TEXT_NODE) return node.textContent ?? "";
	const raw = atom(node);
	if (raw !== null) return raw;
	return (startsLine(node) ? "\n" : "") + readChildren(node);
}

function readChildren(parent: BoxNode): string {
	let raw = "";
	for (const child of Array.from(parent.childNodes)) raw += read(child);
	return raw;
}

/**
 * The raw text the box holds. A line break that nothing follows shows no line (a web view draws a last, empty line
 * only for a second break, which lineBreaksHtml adds), so the box's last break isn't text: neither the one after a
 * text that ends in a line break, nor the one a web view leaves in a box it emptied.
 */
export function rawOf(box: BoxNode): string {
	const raw = readChildren(box);
	return raw.endsWith("\n") ? raw.slice(0, -1) : raw;
}

/**
 * How far into the raw text a caret is, given as a selection gives it: in a text node, or before the `offset`th child
 * of an element. A caret after the box's last break, which isn't text, is at the text's end.
 */
export function rawOffsetOf(box: BoxNode, container: BoxNode, offset: number): number {
	let count = 0;
	const lengthOf = (node: BoxNode) =>
		node.nodeType === TEXT_NODE ? (node.textContent ?? "").length : (atom(node)?.length ?? -1);

	function whole(node: BoxNode) {
		const length = lengthOf(node);
		if (length >= 0) {
			count += length;
			return;
		}
		if (startsLine(node)) count += 1;
		for (const child of Array.from(node.childNodes)) whole(child);
	}

	function upTo(node: BoxNode): boolean {
		if (node === container) {
			if (node.nodeType === TEXT_NODE) count += offset;
			else {
				// A paragraph's own line break comes before what it holds.
				if (node !== box && startsLine(node)) count += 1;
				const children = Array.from(node.childNodes);
				for (let i = 0; i < offset && i < children.length; i++) whole(children[i]!);
			}
			return true;
		}
		const length = lengthOf(node);
		if (length >= 0) {
			count += length;
			return false;
		}
		if (node !== box && startsLine(node)) count += 1;
		for (const child of Array.from(node.childNodes)) if (upTo(child)) return true;
		return false;
	}

	upTo(box);
	return Math.min(count, rawOf(box).length);
}

/** Where a caret goes among the box's nodes: at an offset in a text node, or right before or after a node. */
export interface CaretPlace<N> {
	readonly node: N;
	readonly at: number | "before" | "after";
}

/**
 * Where the caret goes for an offset into the raw text; null in a box that holds nothing. It goes after a node it
 * can't enter, and so before what follows a line break, on the new line; at the text's very start it goes before the
 * first node, on the first line. An offset past the text is its end, which is before the box's last break when
 * nothing follows it: text typed after that break would turn it into a line.
 */
export function caretAt<N extends BoxTree<N>>(box: N, target: number): CaretPlace<N> | null {
	let left = Math.min(target, rawOf(box).length);

	function within(node: N): CaretPlace<N> | null {
		if (node.nodeType === TEXT_NODE) {
			const length = (node.textContent ?? "").length;
			if (left <= length) return { node, at: left };
			left -= length;
			return null;
		}
		const raw = atom(node);
		if (raw !== null || startsLine(node)) {
			if (left === 0) return { node, at: "before" };
			if (raw !== null) {
				if (left <= raw.length) return { node, at: "after" };
				left -= raw.length;
				return null;
			}
			left -= 1;
		}
		for (const child of Array.from(node.childNodes)) {
			const place = within(child);
			if (place) return place;
		}
		return null;
	}

	for (const child of Array.from(box.childNodes)) {
		const place = within(child);
		if (place) return place;
	}
	return null;
}

/**
 * The line breaks of the box's HTML, as the box shows them: a <br> each, and one more after a text that ends in a
 * line break, without which its last, empty line doesn't show and the caret has nowhere to be on it. rawOf doesn't
 * read that last one.
 */
export function lineBreaksHtml(html: string): string {
	return html.replace(/\n/g, "<br>") + (html.endsWith("\n") ? "<br>" : "");
}

/** The text and the caret after a line break typed at the caret, or over the selection (from `start` to `end`). */
export function breakLine(raw: string, start: number, end = start): { raw: string; caret: number } {
	const from = Math.max(0, Math.min(start, end, raw.length));
	const to = Math.min(raw.length, Math.max(start, end));
	return { raw: `${raw.slice(0, from)}\n${raw.slice(to)}`, caret: from + 1 };
}

/**
 * What Enter does in the box: sends the message, or with Shift starts a new line. Neither while an IME composes, when
 * the key is the IME's own (it picks the composed text).
 */
export function enterKey(e: { key: string; shiftKey: boolean; isComposing: boolean }): "send" | "break" | null {
	if (e.key !== "Enter" || e.isComposing) return null;
	return e.shiftKey ? "break" : "send";
}

/** What a mention of `userId` adds at the end of the box's raw text: after a space, unless the text is empty or ends
 * in one, and a space after it, as a pick from the @ suggestions leaves. */
export function mentionAfter(raw: string, userId: string): string {
	return `${raw === "" || /\s$/.test(raw) ? "" : " "}<@${userId}> `;
}

/**
 * What a quote of `text` adds at the end of the box's raw text: on a line of its own, each of its lines under "> "
 * (markdown's quote, which takes one line at a time), trimmed, its blank lines at either end left out, then a line
 * break, where the reply goes on.
 */
export function quoteAfter(raw: string, text: string): string {
	const lines = text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.trim());
	while (lines.length > 0 && !lines[0]) lines.shift();
	while (lines.length > 0 && !lines.at(-1)) lines.pop();
	const quote = lines.map((line) => `> ${line}`).join("\n");
	return `${raw === "" || raw.endsWith("\n") ? "" : "\n"}${quote}\n`;
}
