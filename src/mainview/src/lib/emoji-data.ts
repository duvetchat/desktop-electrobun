// The emoji dataset, which lib/emoji.ts loads when it is first asked for (loadEmojiData, #292).
import type { MessageKey } from "$lib/i18n";
import type { EmojiCategory, EmojiEntry } from "./emoji";

// ── Emoji data ────────────────────────────────────────────────────────────
// Sourced from emoji-datasource (iamcal) — complete dataset, maintained.
// We derive every emoji at build/import time from the raw JSON so no emoji
// is ever "missing". Only Twemoji-supported entries are included.

// @ts-ignore — no typedefs shipped, we type it ourselves
import rawData from "emoji-datasource/emoji.json";

/** Convert a unified hex string ("1F600" or "1F468-200D-1F469") to an emoji char. */
function unifiedToEmoji(unified: string): string {
	return unified
		.split("-")
		.map((cp) => String.fromCodePoint(parseInt(cp, 16)))
		.join("");
}

interface RawEmoji {
	unified: string;
	short_name: string;
	short_names: string[];
	category: string;
	sort_order: number;
	has_img_twitter: boolean;
	skin_variations?: Record<string, unknown>;
	added_in: string;
}

// Category mapping: emoji-datasource's categories (its data, in English) → the picker's, each with its name's message
// (the picker draws it with t()) and its icon.
const CATEGORY_MAP: Record<string, { label: MessageKey; icon: string }> = {
	"Smileys & Emotion": { label: "emoji_smileys", icon: "😀" },
	"People & Body": { label: "emoji_people", icon: "👋" },
	"Animals & Nature": { label: "emoji_animals", icon: "🐶" },
	"Food & Drink": { label: "emoji_food", icon: "🍕" },
	"Travel & Places": { label: "emoji_travel", icon: "✈️" },
	Activities: { label: "emoji_activities", icon: "⚽" },
	Objects: { label: "emoji_objects", icon: "💡" },
	Symbols: { label: "emoji_symbols", icon: "❤️" },
	Flags: { label: "emoji_flags", icon: "🏳️" },
};

// Build the categorized emoji dataset, sorted by sort_order
const categoryMap = new Map<string, EmojiEntry[]>();

for (const cat of Object.keys(CATEGORY_MAP)) {
	categoryMap.set(cat, []);
}

for (const raw of (rawData as RawEmoji[]).sort((a, b) => a.sort_order - b.sort_order)) {
	// Skip emojis not in Twemoji, and skip base skin-tone modifier entries
	if (!raw.has_img_twitter) continue;

	const catLabel = raw.category;
	if (!categoryMap.has(catLabel)) continue; // skip unknown future categories

	// Use the primary (non-skin-tone) unified string
	const emoji = unifiedToEmoji(raw.unified);
	const name = raw.short_name.replace(/_/g, " ");
	// short_names includes all aliases — great as search keywords
	const keywords = raw.short_names.map((s) => s.replace(/_/g, " "));

	categoryMap.get(catLabel)!.push({ emoji, name, keywords });
}

export const emojiCategories: EmojiCategory[] = Object.entries(CATEGORY_MAP)
	.map(([key, meta]) => ({
		label: meta.label,
		icon: meta.icon,
		emojis: categoryMap.get(key) ?? [],
	}))
	.filter((c) => c.emojis.length > 0);

/** Flat list of all emoji for quick lookup. */
export const allEmojis: EmojiEntry[] = emojiCategories.flatMap((c) => c.emojis);

/** Search emoji by name/keyword, case-insensitive, ranked by relevance. */
export function searchEmojis(query: string): EmojiEntry[] {
	const q = query.toLowerCase().trim();
	if (!q) return [];

	const scored: { entry: EmojiEntry; score: number }[] = [];

	for (const e of allEmojis) {
		let score = 0;

		if (e.name === q) {
			score = 100;
		} else if (e.name.startsWith(q)) {
			score = 80;
		} else if (e.name.includes(q)) {
			score = 50;
		} else {
			for (const k of e.keywords) {
				if (k === q) {
					score = 70;
					break;
				} else if (k.startsWith(q)) {
					score = Math.max(score, 40);
				} else if (k.includes(q)) {
					score = Math.max(score, 20);
				}
			}
		}

		if (score > 0) scored.push({ entry: e, score });
	}

	scored.sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length);
	return scored.map((s) => s.entry);
}
