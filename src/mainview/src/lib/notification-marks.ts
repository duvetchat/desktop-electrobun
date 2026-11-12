import { derived, readable, type Readable } from "svelte/store";
import { notificationLevels, roomLevel } from "$lib/notification-levels";
import { gatewaySpaces, mentionCounts, unreadChannels, unreadConversations } from "$lib/stores.svelte";
import type { NotificationLevel } from "$lib/types";

type RoomPlace = { spaceId: string; spaceDefault: NotificationLevel | undefined };

/** Each room's Space and that Space's default, set again only when one of them changes. */
// ponytail: gatewaySpaces changes with every presence, and the signature walks every room each time; a store of the
// rooms alone would skip that if it ever shows up in a profile.
const roomPlaces: Readable<Map<string, RoomPlace>> = readable(new Map<string, RoomPlace>(), (set) => {
	let signature = "";
	return gatewaySpaces.subscribe((spaces) => {
		const next = spaces
			.map((s) => `${s.id}:${s.default_notifications ?? ""}:${s.rooms.map((r) => r.id).join(",")}`)
			.join("|");
		if (next === signature) return;
		signature = next;
		set(
			new Map(
				spaces.flatMap((s) =>
					s.rooms.map((r): [string, RoomPlace] => [r.id, { spaceId: s.id, spaceDefault: s.default_notifications }]),
				),
			),
		);
	});
});

/**
 * The rooms and conversations whose level is nothing: they show no unread mark and no mention count, and give no
 * mention notice or sound. A room on its own level stays out of it even when its Space is in nothing.
 */
export const quietPlaces: Readable<Set<string>> = derived([notificationLevels, roomPlaces], ([levels, places]) => {
	const quiet = new Set<string>();
	for (const [roomId, place] of places) {
		if (roomLevel(levels, roomId, place.spaceId, place.spaceDefault) === 2) quiet.add(roomId);
	}
	// A conversation's own level, and a room's not loaded yet. A Space's is harmless here: no mark is keyed by one.
	for (const [id, level] of Object.entries(levels)) if (level === 2 && !places.has(id)) quiet.add(id);
	return quiet;
});

function without(ids: Set<string>, quiet: Set<string>): Set<string> {
	if (quiet.size === 0) return ids;
	return new Set([...ids].filter((id) => !quiet.has(id)));
}

/** The unread rooms to mark: the raw set, which acks and the divider still read, without the quiet ones. */
export const shownUnreadRooms = derived([unreadChannels, quietPlaces], ([unread, quiet]) => without(unread, quiet));

/** The unread conversations to mark, without the quiet ones. */
export const shownUnreadConversations = derived([unreadConversations, quietPlaces], ([unread, quiet]) =>
	without(unread, quiet),
);

/** The mention counts to draw, without the quiet places': they come back as they were once the level changes. */
export const shownMentionCounts = derived([mentionCounts, quietPlaces], ([counts, quiet]) =>
	quiet.size === 0 ? counts : Object.fromEntries(Object.entries(counts).filter(([id]) => !quiet.has(id))),
);
