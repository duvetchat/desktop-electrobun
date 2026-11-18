import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// The keyboard's focus shows on every control (#357). app.css draws a 2 px accent outline on whatever has the focus
// (:focus-visible); these guard what takes that outline away, and what a screen reader would pass over in silence.
const src = join(import.meta.dir, "..");
const css = readFileSync(join(src, "app.css"), "utf8");
const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
	});
const sources = sourceFiles(src)
	.map((file) => ({ file: relative(src, file).split(sep).join("/"), source: readFileSync(file, "utf8") }))
	.filter(({ file }) => !file.startsWith("lib/stickers/"));
const lines = sources.flatMap(({ file, source }) =>
	source.split("\n").map((text, i) => ({ file, at: `${file}:${i + 1}`, text })),
);
const isCode = (text: string) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(text);

describe("the focus outline", () => {
	test("is on everything that takes the focus, unless it opts out", () => {
		expect(css).toMatch(
			/\*:not\(body\):not\(\.focus-override\) \{\s*&:focus-visible \{\s*outline: 2px solid var\(--duvet-accent\);\s*outline-offset: 2px;/,
		);
	});

	// outline-none takes the app's outline off an element. On the same line it must draw its own mark: a ring or a
	// shadow on focus, or the highlight of a menu's current item. The rest are counted here, each with why it needs
	// none: a new one fails until it has a mark or a reason.
	test("is taken off only where another mark is drawn", () => {
		const mark = /(?:focus|focus-visible|focus-within|data-highlighted|data-\[state=open\]):(?:shadow|ring|outline|bg)/;
		const bare = new Map<string, number>();
		for (const { file, text } of lines)
			if (isCode(text) && /(?<![\w:-])outline-none(?![\w-])/.test(text) && !mark.test(text))
				bare.set(file, (bare.get(file) ?? 0) + 1);
		expect(Object.fromEntries(bare)).toEqual({
			// The message box, whose wrapper draws the ring (focus-within); the pickers' popover, a panel.
			"lib/components/ChatInput.svelte": 2,
			// A command's card, which takes the focus only to hold its keys (tabindex -1).
			"lib/components/CommandOptions.svelte": 1,
			// The panels of popovers, menus, dialogs and sheets: they take the focus as they open, to hand it to what
			// they hold, and a ring around a whole panel marks nothing.
			"lib/components/ComponentSelect.svelte": 1,
			"lib/components/ConversationView.svelte": 1,
			"lib/components/MemberProfilePopover.svelte": 1,
			"lib/components/MembersButton.svelte": 1,
			"lib/components/MessageSearch.svelte": 1,
			"lib/components/PinnedMessages.svelte": 1,
			"lib/components/ui/Dialog.svelte": 1,
			"lib/components/ui/Popover.svelte": 1,
			"lib/components/ui/Sheet.svelte": 1,
			"lib/components/ui/recipes.ts": 1,
			// A panel, and a field whose wrapper draws the ring.
			"lib/components/FriendsView.svelte": 2,
			"lib/components/settings/SettingsFrame.svelte": 2,
			// Fields whose wrapper draws the ring (focus-within).
			"lib/components/InviteModal.svelte": 1,
			"lib/components/PickerSearch.svelte": 1,
			// The palette's panel and its box: the only field of a palette that is all about it, with the chosen row
			// highlighted under it.
			"lib/components/QuickSwitcher.svelte": 2,
			// Recipes written over two lines: the ring is on the next.
			"lib/components/settings/recipes.ts": 1,
			"lib/overlay-forms.ts": 1,
		});
	});

	// A halo of the accent's tint alone (10 to 14 % of it) is under 3:1 against any surface: every ring that has the
	// halo has the accent's own line too.
	test("a ring is the accent's line, not only its tint", () => {
		const rings = lines.flatMap(({ at, text }) =>
			[...text.matchAll(/(?:focus|focus-visible|focus-within):shadow-\[([^\]\s]+)\]/g)].map((m) => ({
				at,
				ring: m[1]!,
			})),
		);
		expect(rings.length).toBeGreaterThan(5);
		expect(
			rings
				.filter(({ ring }) => ring.includes("--duvet-accent-tint") && !ring.includes("var(--duvet-accent)"))
				.map(({ at }) => at),
		).toEqual([]);
	});

	test("a field whose wrapper draws its ring has a wrapper that does", () => {
		for (const file of [
			"lib/components/ChatInput.svelte",
			"lib/components/PickerSearch.svelte",
			"lib/components/InviteModal.svelte",
		]) {
			const source = sources.find((s) => s.file === file)!.source;
			expect(source, file).toMatch(/focus-within:shadow-\[[^\]\s]*var\(--duvet-accent\)/);
		}
	});
});

describe("what a screen reader is told", () => {
	// An aria-label on a span or a div with no role is passed over by VoiceOver and NVDA: a mark with a label (an
	// unread dot, a count, a muted glyph) is an image.
	test("a label on a plain element comes with a role", () => {
		const tag =
			/<(span|div|p|i|b|em|strong)\b((?:[^<>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*)>/g;
		const bare = sources
			.filter(({ file }) => file.endsWith(".svelte"))
			.flatMap(({ file, source }) => {
				const markup = source.slice(source.indexOf("</script>") + 1);
				return [...markup.matchAll(tag)]
					.filter((m) => /\baria-label=/.test(m[2]!) && !/\brole=/.test(m[2]!))
					.map((m) => `${file}: <${m[1]}${m[2]!.replace(/\s+/g, " ").slice(0, 60)}`);
			});
		expect(bare).toEqual([]);
	});

	// A button whose name changes with its state says the state already: aria-pressed on it says it twice.
	test("a media button whose name changes with its state isn't also pressed", () => {
		const button = /<MediaButton\b((?:[^<>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*)>/g;
		const doubled = sources
			.filter(({ file }) => file.endsWith(".svelte"))
			.flatMap(({ file, source }) =>
				[...source.matchAll(button)]
					.filter((m) => /\blabel=\{[^}]*\?/.test(m[1]!) && /\bpressed\b/.test(m[1]!) && !/\bstateInName\b/.test(m[1]!))
					.map(() => file),
			);
		expect(doubled).toEqual([]);
	});
});
