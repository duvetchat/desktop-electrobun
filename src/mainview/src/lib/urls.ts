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
// those sites, or of their subdomains, could be someone's own or redirect the frame anywhere, and would run with
// that origin. src/bun/navigation.ts lets these pages load on macOS and Linux, whose rules also see frames.
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

/**
 * A link in a message's text as the mobile app reads it before it draws a card (duvetLinksIn, its
 * lib/widgets/link_embeds.dart), and the API before it leaves out the preview of one of Duvet's own links, as the
 * clients draw a card instead (mobileLink, api#216): up to a space or one of <>()[]"', and without the .,;:!? at its
 * end. So a link that ends a sentence, or sits in brackets, gets its card: "(https://duvet.chat/invite/abc)" and
 * "https://duvet.chat/invite?bot=<id>.". It's always the start of raw.
 */
export function cardLink(raw: string): string {
	return (/^[^\s<>()[\]"']*/u.exec(raw)?.[0] ?? "").replace(/[.,;:!?]+$/u, "");
}

/** The message a link names: its space, room and message, or its conversation and message (space and room empty). */
export interface MessageLink {
	spaceId: string;
	roomId: string;
	messageId: string;
	conversationId?: string;
}

/** What one of Duvet's own links names, which a message shows as a card: a space's invite, a bot's, or a message. */
export type DuvetLink = { code: string } | { bot: string } | { message: MessageLink };

const DUVET_HOST = new URL(DUVET_DOMAIN).hostname;

/**
 * What a link (read as cardLink reads it) names when it's one of Duvet's own, which the API leaves without a preview
 * as the clients draw a card instead (isClientSideEmbed, in duvet-api's internal/adapters/embeds/opengraph.go). It's
 * read as the API reads it: http or https; on duvet.chat or ownOrigin's host (the app's own, when it's a web page),
 * in any case and with any port; its path decoded, without the slashes at its ends; its query and fragment ignored
 * but an invite's code and bot. Nothing otherwise.
 * - A space's invite: /invite?code=<code> or /invite/<code>. A code holds no / ? # or \, as the mobile app has it,
 *   and reaches the API only through pathSegment (api/invites.ts).
 * - A bot's: /invite?bot=<id> or /invite.html?bot=<id>. A link that names both a bot and a code is the bot's, as the
 *   app's invite page and the mobile app take it, so its card shows what the link opens.
 * - A message: /channels/<space>/<room>/<message> or /conversations/<conversation>/<message>.
 * IDs go into API paths, so they're UUIDs (isUuid).
 */
export function parseDuvetLink(url: string, ownOrigin: string): DuvetLink | null {
	// The API takes a link from its "http://" or "https://", as written (mobileLink).
	if (!/^https?:\/\//.test(url)) return null;
	let parsed: URL;
	let path: string;
	try {
		parsed = new URL(url);
		path = decodeURIComponent(parsed.pathname);
	} catch {
		return null; // not a URL, or a path with a bad escape, which the API's url.Parse refuses too
	}
	if (parsed.hostname !== DUVET_HOST && parsed.hostname !== webHost(ownOrigin)) return null;
	const [page, ...rest] = path.replace(/^\/+|\/+$/g, "").split("/");
	if (rest.length === 0 && (page === "invite" || page === "invite.html")) {
		const bot = parsed.searchParams.get("bot");
		if (isUuid(bot)) return { bot };
		// No client draws a card for invite.html?code=.
		return page === "invite" ? inviteCode(parsed.searchParams.get("code")) : null;
	}
	if (page === "invite") return rest.length === 1 ? inviteCode(rest[0]) : null;
	if (!rest.every(isUuid)) return null;
	if (page === "channels" && rest.length === 3) {
		const [spaceId, roomId, messageId] = rest;
		return { message: { spaceId, roomId, messageId } };
	}
	if (page === "conversations" && rest.length === 2) {
		const [conversationId, messageId] = rest;
		return { message: { spaceId: "", roomId: "", messageId, conversationId } };
	}
	return null;
}

// A space's invite by its code, unless it's empty or holds a / ? # or \ (the mobile app's rule).
const inviteCode = (code: string | null): DuvetLink | null => (code && !/[/?#\\]/.test(code) ? { code } : null);

// The host of origin when it's a web page's: the packaged app's views:// has none.
function webHost(origin: string): string | undefined {
	try {
		const parsed = new URL(origin);
		return /^https?:$/.test(parsed.protocol) ? parsed.hostname : undefined;
	} catch {
		return undefined;
	}
}

/**
 * How an embed frames the player page at url, when frameSandbox lets it: only once its play button is clicked, so that
 * the page loads, and its host sees a view, only when someone asks for it (desktop#147). The poster the button shows,
 * the embed's image, is a copy the API serves. player says whether it's one of the players the API frames itself
 * (PLAYERS), with their origin: in the packaged app any other page opens in the browser instead, as Electrobun's
 * preload runs in frames too, and a player is framed at src, where it starts at once, as the click asked.
 */
export function playerFrame(
	url: string,
	ownHosts: string[],
): { sandbox: string; player: boolean; src: string } | undefined {
	const sandbox = frameSandbox(url, ownHosts);
	if (!sandbox) return undefined;
	if (!isPlayer(url)) return { sandbox, player: false, src: url };
	// YouTube's embed starts with autoplay=1; TikTok's player, as the API writes it, says autoplay=0 last.
	const src = url.includes("?") ? url.replace(/&autoplay=0$/, "&autoplay=1") : `${url}?autoplay=1`;
	return { sandbox, player: true, src };
}
