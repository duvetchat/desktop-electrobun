import type { GatewaySpace, SpaceEmoji } from "$lib/types";

// The custom emojis and stickers of the user's Spaces, which they may use anywhere: the API lists those of every Space
// they're in at once (GET /api/users/@me/emojis and /stickers), and the app keeps them by Space.

/** A list of a Space's emojis or stickers, or of several Spaces', kept by Space, each Space's in their order. */
export function bySpace<T extends { space_id: string }>(items: readonly T[]): Record<string, T[]> {
	const kept: Record<string, T[]> = {};
	for (const item of items) (kept[item.space_id] ??= []).push(item);
	return kept;
}

/** One Space's emojis or stickers, as a picker shows them, under the Space's name and icon. */
export type PickerGroup<T> = { space: GatewaySpace; items: T[] };

/**
 * The groups a picker shows: the current Space's first (none in a conversation), then the Spaces pinned to the column, in
 * the order they were pinned, then the rest in the gateway's order. The column's With news section is left out of that
 * order, so a message coming in doesn't move a Space in a picker that's open. Only Spaces the user is in, with
 * something to show; each one's items by name, then ID, as two can share a name.
 */
export function pickerGroups<T extends { id: string; space_id: string; name: string }>(
	kept: Record<string, readonly T[]>,
	spaces: readonly GatewaySpace[],
	pinned: readonly string[],
	current: string | null | undefined,
): PickerGroup<T>[] {
	const ids = [...new Set([...(current ? [current] : []), ...pinned, ...spaces.map((s) => s.id)])];
	return ids.flatMap((id) => {
		const space = spaces.find((s) => s.id === id);
		const items = kept[id];
		if (!space || !items?.length) return [];
		const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
		return [{ space, items: sorted }];
	});
}

// How well a name matches what follows the `:`: whole, from its start, or anywhere in it.
function matchScore(name: string, query: string): number {
	if (name === query) return 100;
	if (name.startsWith(query)) return 80;
	if (name.includes(query)) return 50;
	return 0;
}

/**
 * What `:` suggests for a query: every emoji of the user's Spaces whose name holds it, in any case, the current Space's
 * first (none in a conversation), then by how well they match, then the shorter name.
 */
export function emojiSuggestions(
	query: string,
	emojis: readonly SpaceEmoji[],
	current: string | null | undefined,
): SpaceEmoji[] {
	const q = query.toLowerCase();
	return emojis
		.map((emoji) => ({ emoji, score: matchScore(emoji.name.toLowerCase(), q), here: emoji.space_id === current }))
		.filter((s) => s.score > 0)
		.sort((a, b) => Number(b.here) - Number(a.here) || b.score - a.score || a.emoji.name.length - b.emoji.name.length)
		.map((s) => s.emoji);
}
