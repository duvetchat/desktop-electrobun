// The app's windows other than the main one (#357, docs/redesign/PLATFORM.md §3 to §5): the media controls' pop-out,
// Settings and a Space's settings. Each is a BrowserWindow of the desktop app that loads a prerendered page of its
// own, views://mainview/<page>.html. This is the one list of those pages. A page named here gets, from the list:
//   - its `copy` rule in electrobun.config.ts. Without one the dev build serves the page and the packaged app answers
//     404, which the platform spike proved the hard way;
//   - the module-graph guard (module-graph.test.ts): its page must never reach lib/api/ws/connection.ts. Only the main
//     window opens the gateway's socket, renews the session (lib/session.ts) and listens to the gateway; the others
//     mirror its state and send it commands (lib/window-link.ts).
// The media controls' pop-out is routes/voice-controls; each other window's phase adds its own here, with its route.

// Nothing is imported here: the Bun process reads this list too (src/bun/index.ts), and its type check (src/bun's
// tsconfig) would follow an import into the whole UI.

/** Which of the app's windows a page is in (src/bun/shell.ts has Bun's own copy). */
export type WindowKind = "main" | "media" | "settings" | "space-settings";

/** A window that isn't the main one. */
export type SecondWindow = Exclude<WindowKind, "main">;

/** Each window's page, by its route's name: the folder under src/routes, and <name>.html in the build. */
export const SECOND_WINDOW_PAGES: Partial<Record<SecondWindow, string>> = {
	// The media controls' pop-out (routes/voice-controls, #357).
	media: "voice-controls",
	// Settings' own window (routes/settings, #357).
	settings: "settings",
	// A Space's settings, one window per Space (routes/space-settings, #357).
	"space-settings": "space-settings",
};

const SECOND_WINDOWS: readonly SecondWindow[] = ["media", "settings", "space-settings"];

/**
 * The window a page belongs to by its address alone, or null for a page of the main window: /settings and
 * settings.html are Settings' own window's, wherever the build is served from. What Bun's preload says about a window
 * (lib/platform.ts) can fail to arrive; a page's own address can't, so a page of one of these windows never takes
 * itself for the main one, which alone opens the gateway, renews the session and answers the other windows.
 */
export function secondWindowOfPath(pathname: string): SecondWindow | null {
	const page = /(?:^|\/)([^/]+?)(?:\.html)?\/?$/.exec(pathname)?.[1];
	return SECOND_WINDOWS.find((window) => SECOND_WINDOW_PAGES[window] === page) ?? null;
}

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
