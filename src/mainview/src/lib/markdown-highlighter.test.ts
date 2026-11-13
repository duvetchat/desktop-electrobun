import { expect, mock, test } from "bun:test";

// Shiki's highlighter compiles a WASM and parses 29 grammars: made as markdown.ts loaded, it ran on the main thread
// before the app page could open its socket (#285). Here a stand-in, made when the test lets it.
let made = 0;
let release = () => {};
void mock.module("shiki", () => ({
	createHighlighter: () => {
		made++;
		return new Promise((resolve) => {
			release = () =>
				resolve({
					getLoadedLanguages: () => ["javascript"],
					codeToHtml: () => '<pre class="shiki"><code>HIGHLIGHTED</code></pre>',
					loadTheme: async () => {},
				});
		});
	},
}));

const { renderMarkdown, startCodeHighlighting } = await import("$lib/markdown");
const block = "```javascript\nconst a = 1\n```";

test("loading markdown.ts makes no highlighter", () => {
	expect(made).toBe(0);
});

test("a code block drawn before the highlighter is made shows plain, and has it made, once", async () => {
	expect(renderMarkdown(block)).toContain("const a = 1");
	// Shiki loads as the highlighter is made (#292), so it's made once that import is in.
	await Bun.sleep(0);
	expect(made).toBe(1);
	startCodeHighlighting();
	expect(made).toBe(1);
	release();
	await Bun.sleep(0);
	expect(renderMarkdown(block)).toContain("HIGHLIGHTED");
});
