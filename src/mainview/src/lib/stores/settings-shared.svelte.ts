// The values the main window and the Settings windows share (#357), as lib/window-sync.ts takes them: each of the app's
// stores or rune states, with how a value that crossed the windows is read into it. Both ends use these, so a value
// means the same on each: the main window's end (settings-host-link.svelte.ts) and a window's
// (settings-guest-link.svelte.ts).
import { get, type Readable, type Writable } from "svelte/store";
import { spaceBans, type LoadedBans } from "$lib/bans";
import { layoutPrefs } from "$lib/layout-prefs.svelte";
import { parseLayoutPrefs } from "$lib/layout-prefs";
import { audioStore, type AudioSettings } from "$lib/stores/audio.svelte";
import { shareSpotify, voiceFaces, myBuckets, pendingTeamInvites } from "$lib/stores.svelte";
import { setThemePref, theme } from "$lib/theme.svelte";
import { parseThemePref } from "$lib/theme";
import type { Shared } from "$lib/window-sync";

/** A store only its owner changes: a write that crossed the windows is dropped. */
export function reading<Value>(store: Readable<Value>): Shared<Value> {
	return { get: () => get(store), set: () => {}, watch: (changed) => store.subscribe(() => changed()) };
}

/** A store either end may change, with what a value that crossed the windows is read as (undefined: not one). */
export function writing<Value>(store: Writable<Value>, parse: (value: unknown) => Value | undefined): Shared<Value> {
	return {
		get: () => get(store),
		set: (value) => {
			const parsed = parse(value);
			if (parsed !== undefined) store.set(parsed);
		},
		watch: (changed) => store.subscribe(() => changed()),
	};
}

/** A value kept in runes: read in an effect, which runs again as it changes. */
export function runes<Value>(read: () => Value, write: (value: unknown) => void): Shared<Value> {
	return {
		get: read,
		set: write,
		watch: (changed) =>
			$effect.root(() => {
				$effect(() => {
					// Read whole, so the effect depends on every field.
					JSON.stringify(read());
					changed();
				});
			}),
	};
}

// What the main window's own store held is what crosses: a list is taken as that store's.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an array from the app's other window, of the same store
const list = <Item>(value: unknown): Item[] | undefined => (Array.isArray(value) ? (value as Item[]) : undefined);
const flag = (value: unknown) => (typeof value === "boolean" ? value : undefined);

const SOUNDS = [
	"notification",
	"join_vc",
	"leave_vc",
	"voice_calling",
	"screen_sharing_on",
	"screen_sharing_off",
] as const;

function setVolumes(value: unknown) {
	if (typeof value !== "object" || value === null) return;
	const volumes: Partial<Record<keyof AudioSettings, unknown>> = { ...value };
	if (typeof volumes.master === "number" && volumes.master !== audioStore.settings.master) {
		audioStore.setMaster(volumes.master);
	}
	for (const sound of SOUNDS) {
		const volume = volumes[sound];
		if (typeof volume === "number" && volume !== audioStore.settings[sound]) audioStore.set(sound, volume);
	}
}

function setLayout(value: unknown) {
	const prefs = parseLayoutPrefs(JSON.stringify(value ?? null));
	layoutPrefs.spacesColumn = prefs.spacesColumn;
	layoutPrefs.openChats = prefs.openChats;
	layoutPrefs.keyboardNavigation = prefs.keyboardNavigation;
}

/** The preferences and lists either end may change, by the key each is shared under. */
export function sharedSettings(): Record<string, Shared> {
	return {
		teamInvites: writing(pendingTeamInvites, list),
		buckets: writing(myBuckets, list),
		voiceFaces: writing(voiceFaces, flag),
		shareSpotify: writing(shareSpotify, flag),
		theme: runes(
			() => theme.pref,
			(value) => setThemePref(parseThemePref(typeof value === "string" ? value : null)),
		),
		// Only what Settings shows: the sidebar's own visibility stays each window's.
		layout: runes(
			() => ({
				spacesColumn: layoutPrefs.spacesColumn,
				openChats: layoutPrefs.openChats,
				keyboardNavigation: layoutPrefs.keyboardNavigation,
			}),
			setLayout,
		),
		audio: runes(() => ({ ...audioStore.settings }), setVolumes),
	} as Record<string, Shared>;
}

/** A Space's loaded bans: its window loads their pages, and the main window's events keep the list current
 * (lib/bans.ts). None is a list not loaded. */
export function sharedBans(spaceId: string): Shared<LoadedBans | null> {
	return {
		get: () => get(spaceBans)[spaceId] ?? null,
		set: (value) =>
			spaceBans.update((all) => {
				if (value) return { ...all, [spaceId]: value };
				if (!(spaceId in all)) return all;
				const { [spaceId]: _gone, ...rest } = all;
				return rest;
			}),
		watch: (changed) => spaceBans.subscribe(() => changed()),
	};
}
