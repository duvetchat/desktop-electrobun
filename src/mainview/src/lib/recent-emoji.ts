// The emoji used lately on this device, ranked as the mobile app ranks them (its lib/data/recent_emoji.dart), as iOS ranks
// its Frequently Used: by how often, fading with time, with what was just used up front. Each is a Unicode emoji or a
// custom emoji's `<:id:>` code. Kept in localStorage, for every account signed in on the device.
//
// An emoji's rank, `age` after its last use, is `score × ½^(age / 7 days) + 10 × ½^(age / 1 hour)`, where each use adds 1
// to the faded score, up to 10.

/** An emoji's score as it stood at its last use, and when that was, in ms. */
export interface EmojiUse {
	score: number;
	at: number;
}

/** The emoji used lately, by Unicode emoji or custom emoji code. */
export type EmojiUses = ReadonlyMap<string, EmojiUse>;

export const RECENT_EMOJI_KEY = "duvet.emoji.recent.v1";

// A use counts half a week later: favourites change over weeks, not days.
const HALF_LIFE = 7 * 24 * 60 * 60 * 1000;
// Where one use a day settles (1 / (1 - ½^(1/7)) ≈ 10). Capped there, a favourite dropped for good sinks under a single
// use within a month.
const MAX_SCORE = 10;
// The last use adds a whole favourite's worth, halving each hour: the one just used shows first, then settles where its
// count puts it.
const FRESH_HALF_LIFE = 60 * 60 * 1000;
/** How many the picker's Recently used shows: three rows of its eight columns. */
export const RECENT_SHOWN = 24;
// Four times RECENT_SHOWN: a custom emoji the user can't use now stays tracked while hidden, and comes back with its Space.
const TRACKED = 96;

const fade = (age: number, halfLife: number) => 0.5 ** (age / halfLife);
// A clock set back leaves a use in the future: it counts as just made.
const ageOf = (use: EmojiUse, now: number) => Math.max(0, now - use.at);

/** Every emoji tracked, the best first; ties go by code, so the order holds from one call to the next. */
export function rankedEmoji(uses: EmojiUses, now: number): string[] {
	return [...uses]
		.map(([emoji, use]) => {
			const age = ageOf(use, now);
			return { emoji, rank: use.score * fade(age, HALF_LIFE) + MAX_SCORE * fade(age, FRESH_HALF_LIFE) };
		})
		.sort((a, b) => b.rank - a.rank || (a.emoji < b.emoji ? -1 : a.emoji > b.emoji ? 1 : 0))
		.map(({ emoji }) => emoji);
}

/** The uses with one more of emoji at now. Past the 96 tracked, the lowest ranked go, never the one just used. */
export function withUse(uses: EmojiUses, emoji: string, now: number): Map<string, EmojiUse> {
	const next = new Map(uses);
	const before = uses.get(emoji);
	const faded = before ? before.score * fade(ageOf(before, now), HALF_LIFE) : 0;
	next.set(emoji, { score: Math.min(MAX_SCORE, faded + 1), at: now });
	if (next.size > TRACKED) {
		// Even where it ties with the rest, or ranks under them.
		const others = rankedEmoji(next, now).filter((e) => e !== emoji);
		for (const lowest of others.slice(TRACKED - 1)) next.delete(lowest);
	}
	return next;
}

/** The uses as stored, as the mobile app stores them: {"😀": [score, last use in ms]}. Anything else reads as none,
 * and a bad entry is skipped. */
export function parseUses(raw: string | null): Map<string, EmojiUse> {
	const uses = new Map<string, EmojiUse>();
	let data: unknown;
	try {
		data = raw === null ? null : JSON.parse(raw);
	} catch {
		return uses;
	}
	if (typeof data !== "object" || data === null || Array.isArray(data)) return uses;
	for (const [emoji, value] of Object.entries(data)) {
		if (!Array.isArray(value) || value.length !== 2) continue;
		const [score, at]: unknown[] = value;
		if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) continue;
		if (typeof at !== "number" || !Number.isInteger(at)) continue;
		uses.set(emoji, { score: Math.min(MAX_SCORE, score), at });
	}
	return uses;
}

/** A custom emoji's ID, from its `<:id:>` code; null for a Unicode emoji. */
export function customEmojiId(code: string): string | null {
	return code.startsWith("<:") && code.endsWith(":>") ? code.slice(2, -2) : null;
}

/**
 * What the picker's Recently used shows: the first RECENT_SHOWN of the ranked it can draw. A custom emoji goes only while
 * the user has it (`has`: one of their Spaces' lists holds it), so one whose Space they left, or that was deleted, takes
 * no place.
 */
export function recentToShow(ranked: readonly string[], has: (id: string) => boolean): string[] {
	return ranked
		.filter((code) => {
			const id = customEmojiId(code);
			return id === null || has(id);
		})
		.slice(0, RECENT_SHOWN);
}

/** A row of quick reactions: the Unicode emoji used most lately, then the row's own, as many as the row has. Custom
 * emojis stay in the picker, as on the mobile app. */
export function quickReactions(row: readonly string[], ranked: readonly string[]): string[] {
	const recent = ranked.filter((code) => customEmojiId(code) === null);
	return [...new Set([...recent, ...row])].slice(0, row.length);
}

// The device's uses, read from localStorage as they're first asked for, then kept for the session: a storage that
// can't be read or written leaves them counted until the app closes.
let kept: Map<string, EmojiUse> | null = null;

function deviceUses(): Map<string, EmojiUse> {
	if (kept) return kept;
	try {
		kept = parseUses(localStorage.getItem(RECENT_EMOJI_KEY));
	} catch {
		// no storage (blocked site data, the prerender): nothing used yet
		kept = new Map();
	}
	return kept;
}

/** The emoji used lately on this device, the best first. */
export function recentEmoji(now = Date.now()): string[] {
	return rankedEmoji(deviceUses(), now);
}

/** Counts a use of a Unicode emoji, or of a custom emoji's `<:id:>` code, and keeps it on the device. */
export function emojiUsed(emoji: string, now = Date.now()) {
	kept = withUse(deviceUses(), emoji, now);
	const stored = JSON.stringify(Object.fromEntries([...kept].map(([code, use]) => [code, [use.score, use.at]])));
	try {
		localStorage.setItem(RECENT_EMOJI_KEY, stored);
	} catch {
		// no storage, or a full quota: the use counts until the app closes
	}
}
