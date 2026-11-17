import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Shiki's highlighter compiles a WASM and parses grammars on the main thread. Made as markdown.ts loaded, it ran before
// the app page could open its socket (#285); made once the first screen was up, it loaded all 29 grammars and the WASM
// in every session, with code to show or not (#317). Now the first block in a language it knows makes it, with no
// grammar, and each language loads as a block first needs it. Here a stand-in, made when the test lets it.
const made: { langs: string[] }[] = [];
const loads: string[] = [];
let release = () => {};
void mock.module("shiki", () => ({
	createHighlighter: (options: { langs: string[] }) => {
		made.push(options);
		const loaded = new Set(options.langs);
		return new Promise((resolve) => {
			release = () =>
				resolve({
					getLoadedLanguages: () => [...loaded],
					loadLanguage: async (...langs: string[]) => {
						loads.push(...langs);
						for (const lang of langs) loaded.add(lang);
					},
					codeToHtml: (_code: string, options: { lang: string }) =>
						`<pre class="shiki"><code>HIGHLIGHTED ${options.lang}</code></pre>`,
					loadTheme: async () => {},
				});
		});
	},
}));

const { renderMarkdown } = await import("$lib/markdown");
const block = (lang: string) => "```" + lang + "\nconst a = 1\n```";

test("loading markdown.ts makes no highlighter", () => {
	expect(made).toEqual([]);
});

test("a block without a language, or in one it doesn't know, makes no highlighter", async () => {
	expect(renderMarkdown(block(""))).toContain("const a = 1");
	expect(renderMarkdown(block("brainfuck"))).toContain("const a = 1");
	await Bun.sleep(0);
	expect(made).toEqual([]);
});

test("the first block in a language it knows shows plain, and makes the highlighter with no grammar, then its language", async () => {
	expect(renderMarkdown(block("js"))).toContain("const a = 1");
	expect(renderMarkdown(block("js"))).toContain("const a = 1");
	await Bun.sleep(0);
	expect(made).toEqual([expect.objectContaining({ langs: [] })]);
	release();
	await Bun.sleep(0);
	expect(loads).toEqual(["javascript"]);
	expect(renderMarkdown(block("js"))).toContain("HIGHLIGHTED javascript");
	// Another language loads as a block first needs it, in the same highlighter.
	expect(renderMarkdown(block("python"))).toContain("const a = 1");
	await Bun.sleep(0);
	expect(loads).toEqual(["javascript", "python"]);
	expect(renderMarkdown(block("python"))).toContain("HIGHLIGHTED python");
	expect(made).toHaveLength(1);
});

test("the app's start makes no highlighter", () => {
	const page = readFileSync(join(import.meta.dir, "../routes/app/+page.svelte"), "utf8");
	expect(page).not.toContain("startCodeHighlighting");
});
