import { SIDEBAR_PREFS_KEY, defaultSidebarPrefs, parseSidebarPrefs, type SidebarPrefs } from "$lib/shell-layout";

function readSaved(): SidebarPrefs {
	if (typeof localStorage === "undefined") return { ...defaultSidebarPrefs };
	try {
		return parseSidebarPrefs(localStorage.getItem(SIDEBAR_PREFS_KEY));
	} catch {
		return { ...defaultSidebarPrefs };
	}
}

/** The sidebar as the user left it, saved on this device as it changes (#357, S-07, S-09): its width, and whether it
 * lists Chats and Spaces, or one of them alone. Whether it is docked or hidden stays with the layout prefs
 * (lib/layout-prefs.svelte.ts: showChannelsSidebar, spacesColumn), where it was before the redesign. */
export const sidebar: SidebarPrefs = $state(readSaved());

$effect.root(() => {
	$effect(() => {
		const value = JSON.stringify({ width: sidebar.width, filter: sidebar.filter });
		try {
			localStorage.setItem(SIDEBAR_PREFS_KEY, value);
		} catch {
			// no storage (private mode, or a full quota): the choice lasts until the app closes
		}
	});
});
