import type { Embed, EmbedMedia } from "$lib/types";

/**
 * url when it's a string holding an absolute http(s) URL; nothing otherwise. An embed's URLs and a bot's
 * components' come from whoever sent the message, or from a page, as whatever JSON they sent: they go through
 * this before they become a link, an image or a frame, as another scheme, javascript: above all, would run in
 * the app with its origin. A message's text has its own rule for links (markdown.ts).
 */
export function webUrl(url: unknown): string | undefined {
	return typeof url === "string" && /^https?:\/\//i.test(url) ? url : undefined;
}

const webMedia = (media: EmbedMedia | null | undefined) => (media && webUrl(media.url) ? media : undefined);

/** embed with its http(s) URLs only (webUrl): a link without one loses its href, an image or a video goes. */
export function webEmbed(embed: Embed): Embed {
	return {
		...embed,
		url: webUrl(embed.url),
		image: webMedia(embed.image),
		thumbnail: webMedia(embed.thumbnail),
		video: webMedia(embed.video),
		author: embed.author && { ...embed.author, url: webUrl(embed.author.url), icon_url: webUrl(embed.author.icon_url) },
		footer: embed.footer && { ...embed.footer, icon_url: webUrl(embed.footer.icon_url) },
	};
}

// The players the API frames itself, YouTube's and TikTok's: they need their own origin to play.
const PLAYERS = ["youtube.com", "youtube-nocookie.com", "tiktok.com"];

const onDomain = (hostname: string, domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);

/**
 * The sandbox to frame url's page with, or nothing when it mustn't be framed: a page of duvet.chat or of
 * ownHosts (the app's host and the API's) would run with that origin, the app's own included. The players
 * keep their origin; any other page gets an opaque one.
 */
export function frameSandbox(url: string, ownHosts: string[]): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	// A trailing dot ("duvet.chat.") names the same host.
	const hostname = parsed.hostname.replace(/\.$/, "");
	if (!/^https?:$/.test(parsed.protocol) || onDomain(hostname, "duvet.chat") || ownHosts.includes(hostname)) {
		return undefined;
	}
	return PLAYERS.some((player) => onDomain(hostname, player))
		? "allow-scripts allow-same-origin allow-popups"
		: "allow-scripts allow-popups";
}

/**
 * The URL of redirect when it's a path of this app ("/…", as the app's own links to its sign-in page carry it),
 * resolved against base, the page's URL; nothing otherwise. Signing in goes there: another site would make the
 * page an open redirect, and javascript: would run in the app. It's the whole URL, as a path alone can name
 * another site once read again ("/.//evil.example" resolves to the path "//evil.example").
 */
export function localUrl(redirect: string | null, base: string): string | undefined {
	if (!redirect?.startsWith("/")) return undefined;
	try {
		const from = new URL(base);
		const to = new URL(redirect, from);
		if (to.protocol === from.protocol && to.host === from.host) return to.href;
	} catch {}
	return undefined;
}
