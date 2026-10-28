/** The layout of the app's shell, saved on this device. The panels' visibility has been saved here since before the
 * spaces column; the column's and the open chats' modes were added to the same value, which older builds ignore. */
export const LAYOUT_PREFS_KEY = "duvet.layout.panels.v1";

/** Fixed: the spaces column is always there. Auto-hide: it folds to an edge, and shows over the chat on hover. */
export type SpacesColumnMode = "fixed" | "auto-hide";
/** Tabs: each pane has its tab bar on top. Vertical: the focused pane's tabs are listed in the spaces column. */
export type OpenChatsMode = "tabs" | "vertical";

export type LayoutPrefs = {
	showMembersSidebar: boolean;
	showChannelsSidebar: boolean;
	spacesColumn: SpacesColumnMode;
	openChats: OpenChatsMode;
};

export const defaultLayoutPrefs: LayoutPrefs = {
	showMembersSidebar: true,
	showChannelsSidebar: true,
	spacesColumn: "fixed",
	openChats: "tabs",
};

/** The prefs a saved value holds, each one it lacks (or holds something else in) at its default. */
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
	if (typeof saved.showMembersSidebar === "boolean") prefs.showMembersSidebar = saved.showMembersSidebar;
	if (typeof saved.showChannelsSidebar === "boolean") prefs.showChannelsSidebar = saved.showChannelsSidebar;
	if (saved.spacesColumn === "fixed" || saved.spacesColumn === "auto-hide") prefs.spacesColumn = saved.spacesColumn;
	if (saved.openChats === "tabs" || saved.openChats === "vertical") prefs.openChats = saved.openChats;
	return prefs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
