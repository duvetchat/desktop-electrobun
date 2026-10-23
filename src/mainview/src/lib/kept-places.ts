/** Where a reader was in a message list: the message at the bottom of their view, and its offset from the list's top. */
export interface ReaderPlace {
	messageId: string;
	offset: number;
}

// How long a kept place waits for its list. A new gateway session unmounts the app until that session's friends and
// conversations are in, and the room shows again behind its newest page: seconds, even on a slow connection.
export const KEEP_PLACE_MS = 30_000;

const places = new Map<string, ReaderPlace & { at: number }>();

/** Keeps where the reader is in a room's or a conversation's list, for the list that shows it next. */
export function keepPlace(listId: string, place: ReaderPlace, now = Date.now()) {
	places.set(listId, { ...place, at: now });
}

/** The place kept for a list, which only its next list gets, and only while it's recent. */
export function takePlace(listId: string, now = Date.now()): ReaderPlace | null {
	const kept = places.get(listId);
	places.delete(listId);
	if (!kept || now - kept.at > KEEP_PLACE_MS) return null;
	return { messageId: kept.messageId, offset: kept.offset };
}
