import { describe, expect, test } from "bun:test";
import {
	isTyping,
	markLabels,
	navigationCommand,
	nextUnread,
	shortcutCommand,
	stepIndex,
	tabAt,
	type KeyLike,
} from "$lib/keyboard";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
	key: k,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...mods,
});

describe("shortcutCommand", () => {
	test("⌘ on macOS and Ctrl elsewhere pick an open chat, 9 the last, and / shows the shortcuts", () => {
		expect(shortcutCommand(key("2", { metaKey: true }), true)).toEqual({ kind: "tab", index: 1 });
		expect(shortcutCommand(key("9", { ctrlKey: true }), false)).toEqual({ kind: "tab", index: -1 });
		expect(shortcutCommand(key("/", { metaKey: true }), true)).toEqual({ kind: "help" });
	});

	test("the other platform's modifier, or one more, is not a shortcut", () => {
		expect(shortcutCommand(key("2", { ctrlKey: true }), true)).toBeNull();
		expect(shortcutCommand(key("2", { metaKey: true }), false)).toBeNull();
		expect(shortcutCommand(key("2", { metaKey: true, shiftKey: true }), true)).toBeNull();
		expect(shortcutCommand(key("0", { metaKey: true }), true)).toBeNull();
	});

	test("Alt with the arrows moves between chats, and with Shift goes to the next unread one", () => {
		expect(shortcutCommand(key("ArrowDown", { altKey: true }), true)).toEqual({ kind: "chat", step: 1 });
		expect(shortcutCommand(key("ArrowUp", { altKey: true }), false)).toEqual({ kind: "chat", step: -1 });
		expect(shortcutCommand(key("ArrowDown", { altKey: true, shiftKey: true }), true)).toEqual({ kind: "unread" });
		expect(shortcutCommand(key("ArrowUp", { altKey: true, shiftKey: true }), true)).toBeNull();
	});

	test("plain keys are left alone", () => {
		expect(shortcutCommand(key("j"), true)).toBeNull();
		expect(shortcutCommand(key("ArrowDown"), true)).toBeNull();
	});
});

describe("navigationCommand", () => {
	test("letters move between messages and chats, and act on the message", () => {
		expect(navigationCommand(key("j"))).toEqual({ kind: "message", step: 1 });
		expect(navigationCommand(key("ArrowUp"))).toEqual({ kind: "message", step: -1 });
		expect(navigationCommand(key("J", { shiftKey: true }))).toEqual({ kind: "chat", step: 1 });
		expect(navigationCommand(key("G", { shiftKey: true }))).toEqual({ kind: "newest" });
		expect(navigationCommand(key("r"))).toEqual({ kind: "reply" });
		expect(navigationCommand(key("e"))).toEqual({ kind: "edit" });
		expect(navigationCommand(key("Enter"))).toEqual({ kind: "write" });
		expect(navigationCommand(key("?", { shiftKey: true }))).toEqual({ kind: "help" });
		expect(navigationCommand(key("3"))).toEqual({ kind: "tab", index: 2 });
	});

	test("keys with a modifier and keys that aren't one of these go on to typing", () => {
		expect(navigationCommand(key("j", { ctrlKey: true }))).toBeNull();
		expect(navigationCommand(key("x"))).toBeNull();
		expect(navigationCommand(key("0"))).toBeNull();
	});
});

describe("stepIndex and tabAt", () => {
	test("steps go round at either end, and start at an end when nothing is current", () => {
		expect(stepIndex(3, 2, 1)).toBe(0);
		expect(stepIndex(3, 0, -1)).toBe(2);
		expect(stepIndex(3, -1, 1)).toBe(0);
		expect(stepIndex(3, -1, -1)).toBe(2);
		expect(stepIndex(0, -1, 1)).toBe(-1);
	});

	test("-1 is the last tab, and a tab past the end is none", () => {
		expect(tabAt(["a", "b", "c"], -1)).toBe("c");
		expect(tabAt(["a", "b"], 4)).toBeNull();
		expect(tabAt([], -1)).toBeNull();
	});
});

describe("nextUnread", () => {
	const order = ["a", "b", "c", "d"];

	test("the first unread chat after the one shown, going round", () => {
		expect(nextUnread(order, new Set(["a", "d"]), "b")).toBe("d");
		expect(nextUnread(order, new Set(["a"]), "c")).toBe("a");
		expect(nextUnread(order, new Set(["c"]), null)).toBe("c");
	});

	test("nothing when only the chat shown is unread, or none is", () => {
		expect(nextUnread(order, new Set(["b"]), "b")).toBeNull();
		expect(nextUnread(order, new Set(), "b")).toBeNull();
	});
});

describe("markLabels", () => {
	test("one letter each while they fit, from the home row", () => {
		expect(markLabels(3)).toEqual(["a", "s", "d"]);
		expect(markLabels(0)).toEqual([]);
	});

	test("two letters each past the alphabet, none starting another", () => {
		const labels = markLabels(30);
		expect(labels).toHaveLength(30);
		expect(new Set(labels).size).toBe(30);
		expect(labels.every((l) => l.length === 2)).toBe(true);
	});
});

describe("isTyping", () => {
	const el = (tagName: string, extra: { type?: string; isContentEditable?: boolean } = {}) => ({ tagName, ...extra });

	test("text fields, text areas and editable text are typing", () => {
		expect(isTyping(el("INPUT", { type: "text" }))).toBe(true);
		expect(isTyping(el("TEXTAREA"))).toBe(true);
		expect(isTyping(el("DIV", { isContentEditable: true }))).toBe(true);
	});

	test("buttons, checkboxes and the page are not", () => {
		expect(isTyping(el("BUTTON"))).toBe(false);
		expect(isTyping(el("INPUT", { type: "checkbox" }))).toBe(false);
		expect(isTyping(el("DIV", { isContentEditable: false }))).toBe(false);
		expect(isTyping(null)).toBe(false);
	});
});
