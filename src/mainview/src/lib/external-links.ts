import { getElectrobunRpc, isElectrobunWindow } from "$lib/electrobun-rpc";

/**
 * The URL a clicked anchor should open in the system browser, or null to let the click proceed normally.
 * An external http(s) link (a message link, an embed, an author url) must leave the packaged app for the
 * system browser instead of navigating the window or spawning an in-app popup. A same-origin link (the
 * app's own pages) is left to the app's router, and a blob or data `download` the app made to the webview. A
 * `download` link to another origin goes to the browser too: Chromium ignores `download` across origins, and the
 * click would load the file in place of the app. A `mailto:` opens in the mail client; any other scheme is
 * ignored, never launched.
 */
export function resolveExternalHref(
	anchor: Pick<HTMLAnchorElement, "getAttribute" | "hasAttribute">,
	appOrigin: string,
): string | null {
	const href = anchor.getAttribute("href");
	if (!href) return null;
	let url: URL;
	try {
		url = new URL(href, appOrigin);
	} catch {
		return null;
	}
	if (url.protocol === "mailto:") return url.href;
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (url.origin === appOrigin) return null;
	return url.href;
}

/**
 * In the packaged app only, sends clicks on external links to the system browser over RPC: plain ones, and Shift, Alt
 * (Option) and middle clicks. Left alone those would open a second window on Windows and Linux, with the app's profile
 * and outside the navigation rules (src/bun/navigation.ts), as Electrobun has no hook for a new window there, and on
 * macOS the rules would refuse them with nothing else happening. Ctrl and Cmd clicks don't get here: Electrobun's
 * preload takes them first, for the new-window handler in src/bun/index.ts. The same clicks on the app's own links open
 * nothing, for the same second window; a download link is left to the webview, which only downloads it. No-op in the
 * web build, where target="_blank" already opens a normal browser tab.
 */
export function setupExternalLinks(open: (url: string) => void = openInBrowser): void {
	if (typeof window === "undefined" || !isElectrobunWindow()) return;

	const onClick = (event: MouseEvent) => {
		if (event.defaultPrevented) return;
		const el = event.target;
		if (!(el instanceof Element)) return;
		const anchor = el.closest("a");
		if (!anchor) return;
		const target = resolveExternalHref(anchor, location.origin);
		if (target) {
			event.preventDefault();
			open(target);
		} else if ((event.button === 1 || event.shiftKey || event.altKey) && !anchor.hasAttribute("download")) {
			event.preventDefault();
		}
	};
	window.addEventListener("click", onClick, true);
	// A middle click is no click, and the right button's auxclick is the context menu's.
	window.addEventListener(
		"auxclick",
		(event) => {
			if (event.button === 1) onClick(event);
		},
		true,
	);
}

/** Opens an http(s) or mailto address in the system browser or mail client, through Bun (it refuses any other). */
export function openInBrowser(url: string): void {
	void getElectrobunRpc().then((rpc) => rpc?.send.openExternal({ url }));
}
