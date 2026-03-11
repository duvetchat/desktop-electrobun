// ── Twemoji helpers ────────────────────────────────────────────────────────
// Discord uses Twemoji (Twitter's open-source emoji set) for consistent
// cross-platform rendering. We mirror that by swapping every Unicode emoji
// for an <img> tag pointing to the Twemoji CDN.

const TWEMOJI_BASE =
	"https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg";

/** Convert a Unicode emoji to its Twemoji CDN URL. */
function toTwemojiUrl(emoji: string): string {
	// Twemoji SVG filenames = lowercase hex codepoints joined by "-".
	// FE0F (variation selector-16) rules:
	//  • ZWJ sequences (contain 200d): keep FE0F — e.g. ❤️‍🔥 = 2764-fe0f-200d-1f525
	//  • Simple emojis: strip FE0F — e.g. 🗣️ = 1f5e3 (NOT 1f5e3-fe0f)
	const raw = [...emoji].map((c) => c.codePointAt(0)!.toString(16));
	const hasZwj = raw.includes("200d");
	const codepoints = hasZwj ? raw : raw.filter((cp) => cp !== "fe0f");
	return `${TWEMOJI_BASE}/${codepoints.join("-")}.svg`;
}

// Regex that matches one "grapheme cluster" worth of emoji — covers most
// common emoji including ZWJ sequences, flags, skin-tone modifiers, keycaps.
// Key: both \p{Emoji_Presentation} AND \p{Emoji}\uFE0F are valid emoji starts
// (the latter covers text-default emojis like ❤ U+2764 and 🗣 U+1F5E3).
const EMOJI_REGEX =
	/\p{Regional_Indicator}{2}|(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)|\uD83C[\uDFFB-\uDFFF])*|[\d#*]\uFE0F?\u20E3/gu;

/** Replace Unicode emoji in a plain string with Twemoji <img> tags. */
export function renderEmoji(text: string, large = false): string {
	const cls = large ? "emoji-img emoji-large" : "emoji-img";
	// Escape HTML first to avoid XSS, then replace emoji
	const escaped = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

	return escaped.replace(EMOJI_REGEX, (emoji) => {
		const url = toTwemojiUrl(emoji);
		return `<img class="${cls}" src="${url}" alt="${emoji}" draggable="false" aria-label="${emoji}" loading="lazy">`;
	});
}

/** Returns true if the string contains ONLY emoji (+ optional whitespace). */
export function isOnlyEmojis(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	const stripped = trimmed.replace(EMOJI_REGEX, "").replace(/\s/g, "");
	return stripped.length === 0;
}

/** Count the number of emoji in a string. */
export function countEmojis(text: string): number {
	return [...text.matchAll(EMOJI_REGEX)].length;
}

// ── Emoji data ────────────────────────────────────────────────────────────
// Sourced from emoji-datasource (iamcal) — complete dataset, maintained.
// We derive every emoji at build/import time from the raw JSON so no emoji
// is ever "missing". Only Twemoji-supported entries are included.

// @ts-ignore — no typedefs shipped, we type it ourselves
import rawData from "emoji-datasource/emoji.json";

export interface EmojiEntry {
	emoji: string;
	name: string;
	keywords: string[];
}

export interface EmojiCategory {
	label: string;
	icon: string;
	emojis: EmojiEntry[];
}

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

// Category mapping: emoji-datasource labels → our picker labels (with icons)
const CATEGORY_MAP: Record<string, { label: string; icon: string }> = {
	"Smileys & Emotion": { label: "Smileys & Emotion", icon: "😀" },
	"People & Body": { label: "People & Body", icon: "👋" },
	"Animals & Nature": { label: "Animals & Nature", icon: "🐶" },
	"Food & Drink": { label: "Food & Drink", icon: "🍕" },
	"Travel & Places": { label: "Travel & Places", icon: "✈️" },
	"Activities": { label: "Activities", icon: "⚽" },
	"Objects": { label: "Objects", icon: "💡" },
	"Symbols": { label: "Symbols", icon: "❤️" },
	"Flags": { label: "Flags", icon: "🏳️" },
};

// Build the categorized emoji dataset, sorted by sort_order
const categoryMap = new Map<string, EmojiEntry[]>();

for (const cat of Object.keys(CATEGORY_MAP)) {
	categoryMap.set(cat, []);
}

for (const raw of (rawData as RawEmoji[]).sort(
	(a, b) => a.sort_order - b.sort_order,
)) {
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

/** Search emoji by name/keyword, case-insensitive. */
export function searchEmojis(query: string): EmojiEntry[] {
	const q = query.toLowerCase().trim();
	if (!q) return [];
	return allEmojis.filter(
		(e) =>
			e.name.includes(q) || e.keywords.some((k) => k.includes(q)),
	);
}