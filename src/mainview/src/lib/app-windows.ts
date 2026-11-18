import type { WindowKind } from "$lib/platform";

// The app's windows other than the main one (#357, docs/redesign/PLATFORM.md §3 to §5): the media controls' pop-out,
// Settings and a Space's settings. Each is a BrowserWindow of the desktop app that loads a prerendered page of its
// own, views://mainview/<page>.html. This is the one list of those pages. A page named here gets, from the list:
//   - its `copy` rule in electrobun.config.ts. Without one the dev build serves the page and the packaged app answers
//     404, which the platform spike proved the hard way;
//   - the module-graph guard (module-graph.test.ts): its page must never reach lib/api/ws/connection.ts. Only the main
//     window opens the gateway's socket, renews the session (lib/session.ts) and listens to the gateway; the others
//     mirror its state and send it commands (lib/window-link.ts).
// The media controls' pop-out is routes/voice-controls; each other window's phase adds its own here, with its route.

/** A window that isn't the main one. */
export type SecondWindow = Exclude<WindowKind, "main">;

/** Each window's page, by its route's name: the folder under src/routes, and <name>.html in the build. */
export const SECOND_WINDOW_PAGES: Partial<Record<SecondWindow, string>> = {
	// The media controls' pop-out (routes/voice-controls, #357).
	media: "voice-controls",
	// Settings' own window (routes/settings, #357).
	settings: "settings",
};

/** Electrobun's `copy` rules for pages: each prerendered page, from the UI's build into the app's views. */
export function pageCopyRules(pages: readonly string[]): Record<string, string> {
	return Object.fromEntries(pages.map((page) => [`src/mainview/build/${page}.html`, `views/mainview/${page}.html`]));
}

/** The `copy` rules of the app's other windows' pages. */
export function secondWindowCopyRules(): Record<string, string> {
	return pageCopyRules(Object.values(SECOND_WINDOW_PAGES));
}

/** The address a window's page loads from in the desktop app, or null for a window that has no page yet. */
export function secondWindowUrl(window: SecondWindow): string | null {
	const page = SECOND_WINDOW_PAGES[window];
	return page ? `views://mainview/${page}.html` : null;
}
