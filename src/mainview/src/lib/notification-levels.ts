import { writable } from "svelte/store";
import type { NotificationLevel, NotificationSettingsUpdateEvent } from "$lib/types";

/**
 * The user's own notification levels, by the ID of the Space, room or conversation they chose one for: what READY's
 * fetch of them gave, kept current by NOTIFICATION_SETTINGS_UPDATE. A place without one follows its default.
 */
export const notificationLevels = writable<Record<string, NotificationLevel>>({});

/** A Space's level: the user's own, else the default its owner set, else only mentions (an older gateway sends none). */
export function spaceLevel(
	levels: Record<string, NotificationLevel>,
	spaceId: string,
	spaceDefault: NotificationLevel | undefined,
): NotificationLevel {
	return levels[spaceId] ?? spaceDefault ?? 1;
}

/** A room's level: the user's own for it, else its Space's. */
export function roomLevel(
	levels: Record<string, NotificationLevel>,
	roomId: string,
	spaceId: string,
	spaceDefault: NotificationLevel | undefined,
): NotificationLevel {
	return levels[roomId] ?? spaceLevel(levels, spaceId, spaceDefault);
}

/** A conversation's level: the user's own, else every message. */
export function conversationLevel(
	levels: Record<string, NotificationLevel>,
	conversationId: string,
): NotificationLevel {
	return levels[conversationId] ?? 0;
}

/** The levels after a NOTIFICATION_SETTINGS_UPDATE: its place's set, or back on its default when the level is null. */
export function applyNotificationUpdate(
	levels: Record<string, NotificationLevel>,
	update: NotificationSettingsUpdateEvent,
): Record<string, NotificationLevel> {
	const next = { ...levels };
	if (update.level === null) delete next[update.target_id];
	else next[update.target_id] = update.level;
	return next;
}
