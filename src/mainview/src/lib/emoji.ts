// ── Twemoji helpers ────────────────────────────────────────────────────────
// Discord uses Twemoji (Twitter's open-source emoji set) for consistent
// cross-platform rendering. We mirror that by swapping every Unicode emoji
// for an <img> tag pointing to the Twemoji CDN.

const TWEMOJI_BASE = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets/svg";

// Some non-standard ZWJ sequences (not in the Unicode RGI list) are stored
// by Twemoji using their non-qualified form (FE0F stripped entirely).
// 👁️‍🗨️ is the known case: jdecked/twemoji uses 1f441-200d-1f5e8.svg,
// NOT 1f441-fe0f-200d-1f5e8-fe0f.svg.
const TWEMOJI_OVERRIDES: Record<string, string> = {
	"\u{1F441}\uFE0F\u200D\u{1F5E8}\uFE0F": "1f441-200d-1f5e8", // 👁️‍🗨️
};

/** Convert a Unicode emoji to its Twemoji CDN URL. */
export function toTwemojiUrl(emoji: string): string {
	if (TWEMOJI_OVERRIDES[emoji]) {
		return `${TWEMOJI_BASE}/${TWEMOJI_OVERRIDES[emoji]}.svg`;
	}
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
// (the latter covers text-default emojis like ❤ U+2764 and 🗣 U+1F5E3), and so is
// a modifier base with its skin tone (✌🏽). In a /u regex a skin tone is the code
// point \p{Emoji_Modifier}, not a surrogate pair. Keycaps go first: a digit with
// \uFE0F alone is an emoji too, and would leave the keycap's mark behind. The chat input shares it.
export const EMOJI_REGEX =
	/[\d#*]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\uFE0F?(?:\p{Emoji_Modifier}|\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Emoji})\uFE0F?)*/gu;

/** Replace Unicode emoji in a plain string with Twemoji <img> tags. */
export function renderEmoji(text: string, large = false): string {
	const cls = large ? "emoji-img emoji-large" : "emoji-img";
	// Escape HTML first to avoid XSS, then replace emoji. Quotes too: markdown puts parts of this text in
	// attributes (a link's URL in its href), where an unescaped " would end the value and start an attribute.
	const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

	return escaped.replace(EMOJI_REGEX, (emoji) => {
		const url = toTwemojiUrl(emoji);
		return `<img class="${cls}" src="${url}" alt="${emoji}" draggable="false" loading="lazy">`;
	});
}

const CUSTOM_EMOJI_REGEX = /<:[a-f0-9-]+:>/g;

/** Returns true if the string contains ONLY emoji (+ optional whitespace). */
export function isOnlyEmojis(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	const stripped = trimmed.replace(EMOJI_REGEX, "").replace(CUSTOM_EMOJI_REGEX, "").replace(/\s/g, "");
	return stripped.length === 0;
}

/** Count the number of emoji in a string. */
export function countEmojis(text: string): number {
	return [...text.matchAll(EMOJI_REGEX)].length + [...text.matchAll(CUSTOM_EMOJI_REGEX)].length;
}

/** Whether a message's text shows its emojis large, in the chat and the previews: it's only emojis, five at most. */
export function largeEmojis(text: string): boolean {
	return isOnlyEmojis(text) && countEmojis(text) <= 5;
}

// ── Emoji data ────────────────────────────────────────────────────────────
// The dataset (emoji-data.ts: emoji-datasource, 1.3 MB, built and sorted as it loads) is a chunk of its own, loaded the
// first time it is asked for: only the picker and the : suggestions use it, and in this module it rode every start (#292).

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

type EmojiData = typeof import("./emoji-data");
let dataLoad: Promise<EmojiData> | null = null;
let loaded: EmojiData | null = null;

/** Loads the emoji dataset, once. */
export function loadEmojiData(): Promise<EmojiData> {
	dataLoad ??= import("./emoji-data").then((data) => (loaded = data));
	return dataLoad;
}

/** The emoji dataset if it is loaded already, else null. */
export function emojiDataNow(): EmojiData | null {
	return loaded;
}
