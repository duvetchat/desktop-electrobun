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
 * In the packaged app only, routes plain clicks on external links to the system browser over RPC. Modified
 * clicks (ctrl/cmd/shift/alt, middle button) and scripted window.open are left to Electrobun's native
 * new-window handling (src/bun/index.ts), so a link is never opened twice. No-op in the web build, where
 * target="_blank" already opens a normal browser tab.
 */
export function setupExternalLinks(): void {
	if (typeof window === "undefined" || !isElectrobunWindow()) return;

	window.addEventListener(
		"click",
		(event) => {
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			if (event.defaultPrevented) return;
			const el = event.target;
			if (!(el instanceof Element)) return;
			const anchor = el.closest("a");
			if (!anchor) return;
			const target = resolveExternalHref(anchor, location.origin);
			if (!target) return;
			event.preventDefault();
			void getElectrobunRpc().then((rpc) => rpc?.send.openExternal({ url: target }));
		},
		true,
	);
}
