import { describe, expect, test } from "bun:test";
import { renderEmoji } from "$lib/emoji";

// markdown.ts reads the API's host as it loads, from constants Vite defines at build time.
Object.assign(globalThis, { VITE_API_URL: "https://api.test", VITE_WS_URL: "", VITE_DOMAIN_TARGET_ENV: "duvet" });
const { renderMarkdown } = await import("$lib/markdown");

// The value of the first href in html: what's between its quotes.
const hrefOf = (html: string) => /href="([^"]*)"/.exec(html)?.[1];

describe("text stays text", () => {
	test("a quote in a text is escaped", () => {
		expect(renderEmoji('say "hi"')).toBe("say &quot;hi&quot;");
	});

	test("a quote in a link's URL can't end its href", () => {
		const html = renderMarkdown('[x](https://a.example/"onmouseover="location=1)');
		expect(hrefOf(html)).toBe("https://a.example/&quot;onmouseover=&quot;location=1");
		expect(html).not.toContain('"onmouseover');
	});

	test("a URL with code, a mention or an emoji in it isn't a link: their HTML would end up in the href", () => {
		for (const text of [
			"[x](https://a.example/`code`)",
			"[x](https://a.example/<@0190a3b2-0000-7000-8000-000000000001>)",
			"[x](https://a.example/😀)",
		]) {
			expect(renderMarkdown(text)).not.toContain("href=");
		}
	});

	test("a plain link keeps its URL", () => {
		expect(hrefOf(renderMarkdown("[docs](https://duvet.chat/a?b=1&c=2)"))).toBe("https://duvet.chat/a?b=1&amp;c=2");
	});
});
