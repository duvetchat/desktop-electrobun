/**
 * The pages the main window may load, so that a dropped link or file, a script or a redirect can't replace the app, and
 * the session it holds, with anything else. What a person opens goes to the system browser before it gets here
 * (lib/external-links.ts, and the new-window handler in index.ts).
 *
 * These are Electrobun's navigation rules, which its native side checks on every navigation: a rule that starts with "^"
 * refuses what it matches and any other lets it through, the last one that matches decides, and a URL none matches goes
 * through, whatever its scheme, so the first rule refuses everything. A "*" matches anything, a "/" too, so a pattern
 * only knows a URL's host up to its first "*": "https://*.duvet.chat/*" takes https://example.com/.duvet.chat/, and
 * "http://localhost:*" takes http://localhost:x@example.com/. So what's let through writes out its whole host.
 *
 * - views://: the app's own pages.
 * - devServer (the dev channel with Vite up; null otherwise): the same pages, from Vite.
 * - Everywhere but on Windows, what its frames need. WebView2's check only sees the top frame (NavigationStarting), so on
 *   Windows frames answer to their sandbox alone (lib/urls.ts). macOS's and Linux's see every frame
 *   (decidePolicyForNavigationAction, OnBeforeBrowse), so there the rules name:
 *   - the players the app frames, the pages of PLAYERS in lib/urls.ts, and the relay on loopback that frames
 *     YouTube's with a Referer (player-relay.ts; relay is its origin, written out as the rules above ask);
 *   - about:, for the blank frames YouTube's player makes;
 *   - devtools:, as Linux's Inspect Element goes through the same check.
 *
 * On macOS and Linux they don't hold against a script in a frame. Every frame gets Electrobun's internal bridge there,
 * whose webviewTagSetNavigationRules and webviewTagUpdateSrc take any webview's ID, so a script in a player's page could
 * clear the rules and load any URL in the window. That bridge is older than the rules: it's the risk those frames
 * already carry (PLAYERS in lib/urls.ts). On Windows it only reaches the top frame.
 */
export function navigationRules(
	platform: NodeJS.Platform,
	devServer: string | null,
	relay: string | null = null,
): string[] {
	return [
		"^*",
		"views://*",
		...(devServer ? [`${devServer}/*`] : []),
		...(platform === "win32"
			? []
			: [
					"about:*",
					"devtools://*",
					"https://www.youtube.com/embed/*",
					"https://www.tiktok.com/player/v1/*",
					...(relay ? [`${relay}/youtube?v=*`] : []),
				]),
	];
}

/** The address a webview's navigation event names (did-navigate, dom-ready: Electrobun puts it in the event's
 * data.detail), or null for an event that names none. */
export function navigatedTo(event: unknown): string | null {
	if (typeof event !== "object" || event === null || !("data" in event)) return null;
	const { data } = event;
	if (typeof data !== "object" || data === null || !("detail" in data)) return null;
	return typeof data.detail === "string" ? data.detail : null;
}

/** Whether an address is the app's own page: app.html in the app, /app under the dev server. Any other page of the
 * main window (sign-in and its neighbours) is the app signed out, where no other window of the app stays open
 * (lib/media-window.ts has the page's twin). */
export function isAppPage(url: string): boolean {
	try {
		return /(^|\/)app(\.html)?\/?$/.test(new URL(url).pathname);
	} catch {
		return false;
	}
}

/** Whether an address is one of the app's own pages: its views, or the dev server's. A navigation event that names
 * anything else is not the window's page moving: where a system reports a frame's navigations with its page's (an
 * embedded player's), they must not read as the app signing out. */
export function isOwnPage(url: string, devServer: string | null): boolean {
	try {
		const { protocol, origin } = new URL(url);
		return protocol === "views:" || (devServer !== null && origin === new URL(devServer).origin);
	} catch {
		return false;
	}
}
