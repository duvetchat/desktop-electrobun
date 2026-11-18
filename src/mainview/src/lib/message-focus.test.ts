import { describe, expect, test } from "bun:test";
import { rowKey, rowToward, staysWithRow, tabStop } from "./message-focus";

const key = (name: string, held: Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey", boolean>> = {}) => ({
	key: name,
	shiftKey: false,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	...held,
});

describe("a focused message's keys", () => {
	test("the arrows, Home and End move between messages", () => {
		expect(rowKey(key("ArrowUp"))).toBe("older");
		expect(rowKey(key("ArrowDown"))).toBe("newer");
		expect(rowKey(key("Home"))).toBe("oldest");
		expect(rowKey(key("End"))).toBe("newest");
	});

	test("Enter, the menu key and Shift+F10 open its menu", () => {
		expect(rowKey(key("Enter"))).toBe("menu");
		expect(rowKey(key("ContextMenu"))).toBe("menu");
		expect(rowKey(key("F10", { shiftKey: true }))).toBe("menu");
	});

	test("held with a modifier, they are someone else's shortcut", () => {
		expect(rowKey(key("ArrowUp", { altKey: true }))).toBeNull();
		expect(rowKey(key("ArrowDown", { shiftKey: true }))).toBeNull();
		expect(rowKey(key("Enter", { metaKey: true }))).toBeNull();
		expect(rowKey(key("F10"))).toBeNull();
		expect(rowKey(key("F10", { shiftKey: true, ctrlKey: true }))).toBeNull();
	});

	test("every other key is left alone, so that typing still reaches the message box", () => {
		for (const name of ["a", " ", "Tab", "Escape", "PageUp", "r", "e"]) expect(rowKey(key(name))).toBeNull();
	});
});

describe("moving between messages", () => {
	// As the list holds them: newest first.
	const ids = ["newest", "middle", "oldest"];

	test("up is the older message, down the newer", () => {
		expect(rowToward(ids, "middle", "older")).toBe("oldest");
		expect(rowToward(ids, "middle", "newer")).toBe("newest");
	});

	test("stops at both ends", () => {
		expect(rowToward(ids, "oldest", "older")).toBeNull();
		expect(rowToward(ids, "newest", "newer")).toBeNull();
		expect(rowToward(ids, "oldest", "oldest")).toBeNull();
		expect(rowToward(ids, "newest", "newest")).toBeNull();
	});

	test("Home and End go to the ends", () => {
		expect(rowToward(ids, "newest", "oldest")).toBe("oldest");
		expect(rowToward(ids, "middle", "newest")).toBe("newest");
	});

	test("goes nowhere from a message the list doesn't hold", () => {
		expect(rowToward(ids, "gone", "older")).toBeNull();
		expect(rowToward([], "gone", "newest")).toBeNull();
	});
});

describe("the list's tab stop", () => {
	test("is the newest message until one has had the focus", () => {
		expect(tabStop(["c", "b", "a"], null)).toBe("c");
	});

	test("is the message that had the focus last", () => {
		expect(tabStop(["c", "b", "a"], "b")).toBe("b");
	});

	test("goes back to the newest when that message is gone", () => {
		expect(tabStop(["c", "b", "a"], "deleted")).toBe("c");
	});

	test("is none in an empty list", () => {
		expect(tabStop([], null)).toBeNull();
	});
});

describe("a message keeps its bar", () => {
	const element = (inLayer: boolean) => ({ closest: () => (inLayer ? {} : null) });

	test("while the focus is in its menu or its picker, drawn outside the list", () => {
		expect(staysWithRow(element(true), false, true)).toBe(true);
	});

	test("while the focus is nowhere for a moment, as its menu opens or closes", () => {
		expect(staysWithRow(null, false, true)).toBe(true);
	});

	test("not when the focus is dropped with no layer open: a click on nothing", () => {
		expect(staysWithRow(null, false, false)).toBe(false);
	});

	test("not once the focus is on another message, or anywhere else in the app", () => {
		expect(staysWithRow(element(false), true, false)).toBe(false);
		expect(staysWithRow(element(false), false, false)).toBe(false);
	});
});
