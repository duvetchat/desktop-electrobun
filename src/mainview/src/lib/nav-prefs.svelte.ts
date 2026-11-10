import { NOW_PREFS_KEY, PINNED_SPACES_KEY, defaultNowPrefs, parseNowPrefs, parsePinned, type NowPrefs } from "$lib/nav";

function read<T>(key: string, parse: (raw: string | null) => T, fallback: T): T {
	if (typeof localStorage === "undefined") return fallback;
	try {
		return parse(localStorage.getItem(key));
	} catch {
		return fallback;
	}
}

function write(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// no storage: the change lasts until the app closes
	}
}

/** How the user arranged the spaces column, saved on this device: the spaces they pinned, and what its Now section has
 * folded or opened. The column and its edge both read them. */
export const navPrefs: { pinned: string[]; now: NowPrefs } = $state({
	pinned: read(PINNED_SPACES_KEY, parsePinned, []),
	now: read(NOW_PREFS_KEY, parseNowPrefs, { ...defaultNowPrefs }),
});

export function togglePinned(spaceId: string) {
	navPrefs.pinned = navPrefs.pinned.includes(spaceId)
		? navPrefs.pinned.filter((id) => id !== spaceId)
		: [...navPrefs.pinned, spaceId];
	write(PINNED_SPACES_KEY, navPrefs.pinned);
}

/** Folds or unfolds a part of the Now section, or lists all its voice rooms or only the busiest. */
export function toggleNow(key: keyof NowPrefs) {
	navPrefs.now = { ...navPrefs.now, [key]: !navPrefs.now[key] };
	write(NOW_PREFS_KEY, navPrefs.now);
}
