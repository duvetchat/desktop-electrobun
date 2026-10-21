import type { Embed, EmbedMedia } from "$lib/types";

/**
 * url when it's an absolute http(s) URL; nothing otherwise. Every URL that comes from outside the app (a bot's
 * components, a link's embed) goes through this before it becomes a link, an image or a frame: another scheme,
 * javascript: above all, would run in the app with its origin.
 */
export function webUrl(url: string | null | undefined): string | undefined {
	return url && /^https?:\/\//i.test(url) ? url : undefined;
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
