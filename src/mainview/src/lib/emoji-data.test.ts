import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The emoji dataset (emoji-datasource's 1.3 MB, built and sorted as it loads) and Shiki rode every start in the layout
// chunk, though only the picker, the : suggestions and code blocks use them (#292).
const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");

describe("the emoji dataset", () => {
	test("is a module of its own, which drawing emojis doesn't import", () => {
		expect(source("emoji.ts")).not.toMatch(/from "emoji-datasource/);
		expect(source("emoji-data.ts")).toContain('from "emoji-datasource/emoji.json"');
	});

	test("loads when asked for, once, and is there to read afterwards", async () => {
		const { emojiDataNow, loadEmojiData } = await import("$lib/emoji");
		expect(emojiDataNow()).toBeNull();
		const [first, second] = await Promise.all([loadEmojiData(), loadEmojiData()]);
		expect(first).toBe(second);
		expect(emojiDataNow()).toBe(first);
		expect(first.searchEmojis("grinning")[0]?.emoji).toBe("😀");
		expect(first.emojiCategories[0]?.label).toBe("Smileys & Emotion");
	});

	test("the picker and the : suggestions read it once loaded, and ask for it", () => {
		for (const file of ["components/EmojiPicker.svelte", "components/ChatInput.svelte"]) {
			const component = source(file);
			expect(component).not.toMatch(/import \{[^}]*\b(searchEmojis|emojiCategories)\b[^}]*\} from "\$lib\/emoji"/);
			expect(component).toContain("loadEmojiData()");
		}
	});
});

test("markdown.ts imports Shiki only as it makes the highlighter", () => {
	const markdown = source("markdown.ts");
	expect(markdown).not.toMatch(/^import \{[^}]*\bcreateHighlighter\b[^}]*\} from "shiki";/m);
	expect(markdown).toContain('import("shiki")');
});

test("the app page loads Shiki and the emoji dataset once the first screen is up, not as the socket opens", () => {
	const page = source("../routes/app/+page.svelte");
	expect(page).toMatch(
		/reportStartup\([^\n]*\n(\s*\/\/[^\n]*\n)*\s*startCodeHighlighting\(\);\s*void loadEmojiData\(\);/,
	);
	expect(page).not.toMatch(/conn = createWebSocketConnection\(\);\s*(\/\/[^\n]*\n\s*)*startCodeHighlighting\(\);/);
});
