import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "$lib/i18n";

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
		// Its categories' names are messages, which the picker draws in the app's language.
		expect(first.emojiCategories[0]?.label).toBe("emoji_smileys");
		expect(t(first.emojiCategories[0]!.label)).toBe("Smileys & Emotion");
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

// #318: loaded once the first screen was up, it stayed in memory in every session, picker opened or not.
test("the app's start doesn't load the emoji dataset: the picker and the : suggestions do, at their first use", () => {
	expect(source("../routes/app/+page.svelte")).not.toContain("loadEmojiData");
	// The : suggestions shown before it came in show again with it.
	expect(source("components/ChatInput.svelte")).toMatch(
		/if \(!emojiData\)\s*void loadEmojiData\(\)\.then\(\(\) => \{\s*if \(!destroyed && emojiQueryStart !== -1\) checkAutocomplete\(getRaw\(inputEl\), getOffset\(\)\);\s*\}\);/,
	);
});
