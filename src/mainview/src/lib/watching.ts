import { get } from "svelte/store";
import { activeVoiceRoomId, watchedStreams } from "$lib/stores.svelte";
import { sendVoiceSync } from "$lib/voice";
import { currentVoicePlace } from "$lib/voice-place";

/**
 * How long a sharer who stopped sharing, or left, stays among the streams this client watches. A reconnect looks the
 * same: after a gateway deploy everyone joins again, and a sharer comes back without their screen until their next
 * VOICE_SYNC. If their screen comes back within it, the user goes on watching without pressing Watch again.
 */
export const WATCH_GRACE_MS = 60_000;

/** Watches a stream in the voice room or call this client is in: once, at the end of the list, which VOICE_SYNC says. */
export function startWatching(roomId: string, userId: string): void {
	if (roomId !== get(activeVoiceRoomId)) return;
	const watched = get(watchedStreams);
	if (watched.includes(userId)) return;
	watchedStreams.set([...watched, userId]);
	sendVoiceSync(roomId);
}

/** Stops watching a stream at once, which VOICE_SYNC says. */
export function stopWatching(userId: string): void {
	const watched = get(watchedStreams);
	if (!watched.includes(userId)) return;
	watchedStreams.set(watched.filter((id) => id !== userId));
	sendVoiceSync();
}

/** Since when each watched sharer has been away: not sharing, or not there. */
export type Absences = Record<string, number>;

/**
 * The watched streams after a look at who shares now: one away for WATCH_GRACE_MS leaves, one back is no longer away.
 * nextCheck is when the first grace still running ends.
 */
export function nextWatched(
	watched: readonly string[],
	absentSince: Absences,
	sharing: ReadonlySet<string>,
	now: number,
): { watched: string[]; absentSince: Absences; nextCheck: number | null } {
	const kept: string[] = [];
	const away: Absences = {};
	let nextCheck: number | null = null;
	for (const id of watched) {
		if (sharing.has(id)) {
			kept.push(id);
			continue;
		}
		const since = absentSince[id] ?? now;
		if (now - since >= WATCH_GRACE_MS) continue;
		kept.push(id);
		away[id] = since;
		const ends = since + WATCH_GRACE_MS;
		if (nextCheck === null || ends < nextCheck) nextCheck = ends;
	}
	return { watched: kept, absentSince: away, nextCheck };
}

export type ShownStream = { own: true } | { own: false; userId: string };

/** The stream the floating window shows: the user's own share first, else the last watched one that's here. */
export function streamToShow(
	ownSharing: boolean,
	watched: readonly string[],
	available: ReadonlySet<string>,
): ShownStream | null {
	if (ownSharing) return { own: true };
	const userId = watched.findLast((id) => available.has(id));
	return userId ? { own: false, userId } : null;
}

/**
 * Who watches a sharer's stream, as the voice states say (their watching), in their order; never the sharer. The
 * user's own entry follows what they watch here (me), before the gateway's echo of it comes back.
 */
export function viewersOf(
	sharerId: string,
	states: readonly { user_id: string; watching?: readonly string[] }[],
	me: { id: string; watching: readonly string[] } | null,
): string[] {
	const viewers = states
		.filter(
			(s) => s.user_id !== sharerId && (s.user_id === me?.id ? me.watching : (s.watching ?? [])).includes(sharerId),
		)
		.map((s) => s.user_id);
	if (me && me.id !== sharerId && me.watching.includes(sharerId) && !viewers.includes(me.id)) viewers.push(me.id);
	return viewers;
}

/**
 * Keeps the watched streams: empties them when the user leaves voice or goes to another room or call, and otherwise
 * drops a sharer away for WATCH_GRACE_MS, telling the gateway. Starting it again, as the app page's remount on every
 * READY does, keeps the list. Returns its stop.
 */
export function keepWatchedStreams(now: () => number = Date.now): () => void {
	let room = get(activeVoiceRoomId);
	let absentSince: Absences = {};
	let timer: ReturnType<typeof setTimeout> | null = null;
	const look = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		const id = get(activeVoiceRoomId);
		if (id !== room) {
			room = id;
			absentSince = {};
			if (get(watchedStreams).length) watchedStreams.set([]);
			return;
		}
		const sharing = new Set(
			(get(currentVoicePlace)?.states ?? []).filter((s) => s.screen_sharing).map((s) => s.user_id),
		);
		const watched = get(watchedStreams);
		const next = nextWatched(watched, absentSince, sharing, now());
		absentSince = next.absentSince;
		if (next.watched.length !== watched.length) {
			watchedStreams.set(next.watched);
			sendVoiceSync();
		}
		if (next.nextCheck !== null) timer = setTimeout(look, Math.max(0, next.nextCheck - now()));
	};
	const stops = [activeVoiceRoomId.subscribe(look), currentVoicePlace.subscribe(look)];
	return () => {
		for (const stop of stops) stop();
		if (timer) clearTimeout(timer);
	};
}
