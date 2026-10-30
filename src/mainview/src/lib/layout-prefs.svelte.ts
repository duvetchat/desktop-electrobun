import { LAYOUT_PREFS_KEY, defaultLayoutPrefs, parseLayoutPrefs, type LayoutPrefs } from "$lib/layout-prefs";

function readSaved(): LayoutPrefs {
	if (typeof localStorage === "undefined") return { ...defaultLayoutPrefs };
	try {
		return parseLayoutPrefs(localStorage.getItem(LAYOUT_PREFS_KEY));
	} catch {
		return { ...defaultLayoutPrefs };
	}
}

/** The shell's layout prefs: the app page reads them, and it and the appearance settings change them. Every change is
 * saved at once. */
export const layoutPrefs: LayoutPrefs = $state(readSaved());

$effect.root(() => {
	$effect(() => {
		const value = JSON.stringify({
			membersColumn: layoutPrefs.membersColumn,
			showMembersSidebar: layoutPrefs.membersColumn !== "hidden",
			showChannelsSidebar: layoutPrefs.showChannelsSidebar,
			spacesColumn: layoutPrefs.spacesColumn,
			openChats: layoutPrefs.openChats,
			keyboardNavigation: layoutPrefs.keyboardNavigation,
		});
		try {
			localStorage.setItem(LAYOUT_PREFS_KEY, value);
		} catch {
			// no storage (private mode, or a full quota): the prefs last until the app closes
		}
	});
});
