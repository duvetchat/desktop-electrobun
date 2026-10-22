import { DUVET_DOMAIN, isUuid, route } from "$lib/common/common";
import type { Component, ComponentMedia, Embed, EmbedMedia } from "$lib/types";

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

// Whether components is a list whose links and media are all http(s) URLs (webUrl), with media in every gallery item.
// The API leaves out what a component doesn't have, so a field it sent empty (null) counts as a bad one.
function webComponents(components: unknown): boolean {
	const media = (m: ComponentMedia | undefined, required = false) => (m === undefined ? !required : !!webUrl(m?.url));
	return (
		Array.isArray(components) &&
		components.every(
			(c: Component | null) =>
				!!c &&
				(c.url === undefined || !!webUrl(c.url)) &&
				media(c.media) &&
				media(c.file) &&
				(c.items === undefined || (Array.isArray(c.items) && c.items.every((item) => media(item?.media, true)))) &&
				(c.components === undefined || webComponents(c.components)) &&
				(c.accessory === undefined || webComponents([c.accessory])),
		)
	);
}

/**
 * embed with its http(s) URLs only (webUrl): a link without one loses its href, an image or a video goes, and so does
 * a card (the components of a link's page), whole, as it's drawn whole.
 */
export function webEmbed(embed: Embed): Embed {
	return {
		...embed,
		url: webUrl(embed.url),
		image: webMedia(embed.image),
		thumbnail: webMedia(embed.thumbnail),
		video: webMedia(embed.video),
		author: embed.author && { ...embed.author, url: webUrl(embed.author.url), icon_url: webUrl(embed.author.icon_url) },
		footer: embed.footer && { ...embed.footer, icon_url: webUrl(embed.footer.icon_url) },
		components: embed.components?.length && webComponents(embed.components) ? embed.components : undefined,
	};
}

// The players the API frames itself, YouTube's and TikTok's, as it writes their URLs (embeds/youtube.go and
// embeds/tiktok.go): they need their own origin to play. Only these exact URLs are players. Any other page of
// those sites, or of their subdomains, could be someone's own or redirect the frame anywhere, and would load at
// once with that origin.
const PLAYERS = [
	/^https:\/\/www\.youtube\.com\/embed\/[\w-]+$/,
	/^https:\/\/www\.tiktok\.com\/player\/v1\/\d+\?music_info=0&description=0&rel=0&autoplay=0$/,
];

const isPlayer = (url: string) => PLAYERS.some((player) => player.test(url));

const onDomain = (hostname: string, domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);

/**
 * The sandbox to frame url's page with, or nothing when it mustn't be framed: a page of duvet.chat or of
 * ownHosts (the app's host and the API's) would run with that origin, the app's own included. The players
 * (PLAYERS) keep their origin; any other page gets an opaque one. Neither gets allow-popups: in the packaged
 * app a framed page's window.open would otherwise reach the native new-window handler and open arbitrary URLs
 * in the system browser (src/bun/index.ts), so framed content may not open windows at all.
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
	return isPlayer(url) ? "allow-scripts allow-same-origin" : "allow-scripts";
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

/** The sign-in page, which goes on to redirect (a path of the app, as localUrl reads it there) once signed in. */
export function signInUrl(redirect: string): string {
	return route(`/sign-in.html?redirect=${encodeURIComponent(redirect)}`);
}

// isUuid lives in common.ts, whose getAvatarURL needs it too.
export { isUuid };

/**
 * value as one segment of an API path, for what isn't an ID (an invite's code, a reaction's emoji): encoded, so
 * a "/", "\", "?" or "#" in it stays in it. "." and ".." are refused: encoding leaves them as they are, and a URL
 * resolves them, "%2e" too, as the path's folder and the one above it. So is "", which drops the segment.
 */
export function pathSegment(value: string): string {
	const segment = encodeURIComponent(value);
	if (segment === "" || segment === "." || segment === "..") throw new Error(`Not a path segment: "${value}"`);
	return segment;
}

/** The message a link names: its space, room and message, or its conversation and message (space and room empty). */
export interface MessageLink {
	spaceId: string;
	roomId: string;
	messageId: string;
	conversationId?: string;
}

/**
 * The message a link to one in Duvet names (https://duvet.chat/channels/<space>/<room>/<message>, or
 * …/conversations/<conversation>/<message>), when each of its IDs is a UUID (isUuid); nothing otherwise. Its
 * preview fetches the message by them as soon as it's on screen.
 */
export function parseMessageLink(url: string): MessageLink | null {
	if (!url.startsWith(`${DUVET_DOMAIN}/`)) return null;
	const [kind, ...ids] = url.slice(DUVET_DOMAIN.length + 1).split("/");
	if (!ids.every(isUuid)) return null;
	if (kind === "channels" && ids.length === 3) {
		const [spaceId, roomId, messageId] = ids;
		return { spaceId, roomId, messageId };
	}
	if (kind === "conversations" && ids.length === 2) {
		const [conversationId, messageId] = ids;
		return { spaceId: "", roomId: "", messageId, conversationId };
	}
	return null;
}

/**
 * How an embed frames the player page at url, when frameSandbox lets it: at once for the players the API frames itself
 * (PLAYERS), and for any other page only once its play button is clicked (clickToPlay), so that the page itself loads
 * and runs only when someone asks for it. The poster the button shows, the embed's image, loads as any embed image.
 */
export function playerFrame(url: string, ownHosts: string[]): { sandbox: string; clickToPlay: boolean } | undefined {
	const sandbox = frameSandbox(url, ownHosts);
	if (!sandbox) return undefined;
	return { sandbox, clickToPlay: !isPlayer(url) };
}
