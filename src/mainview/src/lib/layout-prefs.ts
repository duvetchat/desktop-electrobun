/** The layout of the app's shell, saved on this device. The panels' visibility has been saved here since before the
 * spaces column; the column's, the open chats' and the members column's modes were added to the same value, which older
 * builds ignore. They still read showMembersSidebar, which is saved with the members column's mode for them. */
export const LAYOUT_PREFS_KEY = "duvet.layout.panels.v1";

/** Fixed: the spaces column is always there. Auto-hide: it folds to an edge, and shows over the chat on hover. */
export type SpacesColumnMode = "fixed" | "auto-hide";
/** Tabs: each pane has its tab bar on top. Vertical: the focused pane's tabs are listed in the spaces column. */
export type OpenChatsMode = "tabs" | "vertical";
/** Auto: the members column opens by itself in a busy room (see members.ts). Shown and hidden: the user's choice. */
export type MembersColumnMode = "auto" | "shown" | "hidden";

export type LayoutPrefs = {
	membersColumn: MembersColumnMode;
	showChannelsSidebar: boolean;
	spacesColumn: SpacesColumnMode;
	openChats: OpenChatsMode;
};

export const defaultLayoutPrefs: LayoutPrefs = {
	membersColumn: "auto",
	showChannelsSidebar: true,
	spacesColumn: "fixed",
	openChats: "tabs",
};

/** The prefs a saved value holds, each one it lacks (or holds something else in) at its default. The members column
 * was a showMembersSidebar boolean before its mode: shown, its old default, is auto now, and hidden stays hidden. */
export function parseLayoutPrefs(raw: string | null): LayoutPrefs {
	const prefs = { ...defaultLayoutPrefs };
	if (!raw) return prefs;
	let saved: unknown;
	try {
		saved = JSON.parse(raw);
	} catch {
		return prefs;
	}
	if (!isRecord(saved)) return prefs;
	if (saved.membersColumn === "auto" || saved.membersColumn === "shown" || saved.membersColumn === "hidden") {
		prefs.membersColumn = saved.membersColumn;
	} else if (saved.showMembersSidebar === false) {
		prefs.membersColumn = "hidden";
	}
	if (typeof saved.showChannelsSidebar === "boolean") prefs.showChannelsSidebar = saved.showChannelsSidebar;
	if (saved.spacesColumn === "fixed" || saved.spacesColumn === "auto-hide") prefs.spacesColumn = saved.spacesColumn;
	if (saved.openChats === "tabs" || saved.openChats === "vertical") prefs.openChats = saved.openChats;
	return prefs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
