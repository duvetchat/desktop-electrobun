import { t } from "$lib/i18n";
import type { UserActivity } from "$lib/stores.svelte";

export const ActivityType = { Playing: 0, Listening: 2 } as const;

// A song this long past its end is one whose app stopped updating it (closed, asleep), not one still playing.
const STALE_AFTER_MS = 30_000;

/** Spotify's activity, as the desktop app shares it (src/bun/spotify.ts): the song in details, the artist in state,
 * the album in assets.large_text, and the song's start and end. It has no cover or track ID. */
export function isSpotify(activity: UserActivity): boolean {
	return activity.type === ActivityType.Listening && activity.name === "Spotify";
}

/** The activities worth showing: all but a Spotify song that ended a while ago. */
export function shownActivities(list: UserActivity[] | undefined, now = Date.now()): UserActivity[] {
	return (list ?? []).filter(
		(activity) =>
			!isSpotify(activity) || activity.timestamps?.end === undefined || now <= activity.timestamps.end + STALE_AFTER_MS,
	);
}

/** An activity in a line, for a friend's row beside its icon: the song and its artist, or what's played or listened to. */
export function activityLine(activity: UserActivity): { kind: "listening" | "playing"; text: string } {
	if (isSpotify(activity) && activity.details) {
		return {
			kind: "listening",
			text: activity.state
				? t("people_activity_song", { song: activity.details, artist: activity.state })
				: activity.details,
		};
	}
	return { kind: activity.type === ActivityType.Listening ? "listening" : "playing", text: activity.name };
}

/** A search for the song on Spotify's web player, as the activity has no track ID to link the song itself. */
export function spotifySearchUrl(activity: UserActivity): string {
	const query = [activity.details, activity.state].filter(Boolean).join(" ");
	return `https://open.spotify.com/search/${encodeURIComponent(query)}`;
}

/** A playback time as m:ss, or h:mm:ss from an hour on. */
export function formatPlaybackTime(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
