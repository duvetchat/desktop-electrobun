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
 *   - the players the app frames, the pages of PLAYERS in lib/urls.ts;
 *   - about:, for the blank frames YouTube's player makes and the blank page macOS loads as a window closes;
 *   - devtools:, as Linux's Inspect Element goes through the same check.
 */
export function navigationRules(platform: NodeJS.Platform, devServer: string | null): string[] {
	return [
		"^*",
		"views://*",
		...(devServer ? [`${devServer}/*`] : []),
		...(platform === "win32"
			? []
			: ["about:*", "devtools://*", "https://www.youtube.com/embed/*", "https://www.tiktok.com/player/v1/*"]),
	];
}
