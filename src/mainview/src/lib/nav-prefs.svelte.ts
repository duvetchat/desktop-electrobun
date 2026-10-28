import { PINNED_SPACES_KEY, SPACE_FOLDERS_KEY, parseFolders, parsePinned, type SpaceFolder } from "$lib/nav";

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

/** How the user arranged the spaces column, saved on this device: the spaces they pinned, and the folders of the old
 * server rail. The column and its edge both read them. */
export const navPrefs: { pinned: string[]; folders: SpaceFolder[] } = $state({
	pinned: read(PINNED_SPACES_KEY, parsePinned, []),
	folders: read(SPACE_FOLDERS_KEY, parseFolders, []),
});

export function togglePinned(spaceId: string) {
	navPrefs.pinned = navPrefs.pinned.includes(spaceId)
		? navPrefs.pinned.filter((id) => id !== spaceId)
		: [...navPrefs.pinned, spaceId];
	write(PINNED_SPACES_KEY, navPrefs.pinned);
}

/** Puts a space in a folder, out of any other one; with no folder, out of all of them. */
export function moveSpaceToFolder(spaceId: string, folderId: string | null) {
	navPrefs.folders = navPrefs.folders.map((f) => {
		const guildIds = f.guildIds.filter((id) => id !== spaceId);
		return { ...f, guildIds: f.id === folderId ? [...guildIds, spaceId] : guildIds };
	});
	write(SPACE_FOLDERS_KEY, navPrefs.folders);
}

/** A new folder, holding this space. */
export function createFolderWith(name: string, spaceId: string) {
	navPrefs.folders = [
		...navPrefs.folders.map((f) => ({ ...f, guildIds: f.guildIds.filter((id) => id !== spaceId) })),
		{ id: crypto.randomUUID(), name, guildIds: [spaceId], collapsed: false },
	];
	write(SPACE_FOLDERS_KEY, navPrefs.folders);
}

export function toggleFolder(folderId: string) {
	navPrefs.folders = navPrefs.folders.map((f) => (f.id === folderId ? { ...f, collapsed: !f.collapsed } : f));
	write(SPACE_FOLDERS_KEY, navPrefs.folders);
}
