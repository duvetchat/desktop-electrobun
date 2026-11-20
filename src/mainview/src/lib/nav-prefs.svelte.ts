import {
	NOW_PREFS_KEY,
	OLD_PINNED_SPACES_KEY,
	PINS_KEY,
	defaultNowPrefs,
	parseNowPrefs,
	parsePins,
	pinKeys,
	type NowPrefs,
} from "$lib/nav";

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

// The pins, or, until a pin is saved under their key, the Spaces pinned before chats could be (#416).
const pins = read(PINS_KEY, (saved) => parsePins(saved, localStorage.getItem(OLD_PINNED_SPACES_KEY)), {
	spaces: [],
	chats: [],
});

/** How the user arranged the sidebar, saved on this device: the Spaces they pinned (`pinned`) and the chats, direct
 * messages and groups (`pinnedChats`), and what its Now section has folded or opened. The column and its edge both
 * read them. */
export const navPrefs: { pinned: string[]; pinnedChats: string[]; now: NowPrefs } = $state({
	pinned: pins.spaces,
	pinnedChats: pins.chats,
	now: read(NOW_PREFS_KEY, parseNowPrefs, { ...defaultNowPrefs }),
});

const toggled = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]);

function savePins() {
	write(PINS_KEY, pinKeys({ spaces: navPrefs.pinned, chats: navPrefs.pinnedChats }));
}

/** Pins a Space to the top of the Spaces, or takes it back among them. */
export function togglePinned(spaceId: string) {
	navPrefs.pinned = toggled(navPrefs.pinned, spaceId);
	savePins();
}

/** Pins a direct message or a group to the top of the chats, or takes it back among them. */
export function togglePinnedChat(conversationId: string) {
	navPrefs.pinnedChats = toggled(navPrefs.pinnedChats, conversationId);
	savePins();
}

/** Folds or unfolds a part of the Now section, or lists all its voice rooms or only the busiest. */
export function toggleNow(key: keyof NowPrefs) {
	navPrefs.now = { ...navPrefs.now, [key]: !navPrefs.now[key] };
	write(NOW_PREFS_KEY, navPrefs.now);
}
