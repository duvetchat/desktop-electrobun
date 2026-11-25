import { expect, mock, test } from "bun:test";
import { createRawSnippet } from "svelte";
import { render } from "svelte/server";
import { tags } from "./server-render";
import type { RichPart } from "$lib/i18n/rich";

// Rich (#464) draws a message's pieces: its words as they are, each tag's words through the caller's snippet of that
// name, or plainly when the caller gave none. The pieces themselves are lib/i18n/rich.ts's (rich.test.ts).
let parts: RichPart[] = [];
mock.module("$lib/i18n", () => ({ richParts: () => parts }));
const { default: Rich } = await import("./Rich.svelte");

const bold = createRawSnippet((text: () => string) => ({ render: () => `<strong>${text()}</strong>` }));
const drawn = (props: Record<string, unknown>) =>
	render(Rich, { props: { key: "settings_language_title", ...props } }).body.replace(/<!--[^>]*-->/g, "");

test("draws each tag's words with the caller's snippet, and the words between as they are", async () => {
	parts = [{ tag: "b", text: "Ana" }, " pinned a message."];
	expect(drawn({ tags: { b: bold } })).toBe("<strong>Ana</strong> pinned a message.");
	expect((await tags(Rich, { key: "settings_language_title", tags: { b: bold } })).map((tag) => tag.name)).toEqual([
		"strong",
	]);
});

test("shows a tag's words plainly when the caller has no snippet for it", () => {
	parts = ["See ", { tag: "link", text: "pinned messages" }, "."];
	expect(drawn({})).toBe("See pinned messages.");
});

test("escapes words that look like markup: a name is never HTML", () => {
	parts = ["Hi <b>Eve</b>"];
	expect(drawn({})).toBe("Hi &lt;b>Eve&lt;/b>");
});
