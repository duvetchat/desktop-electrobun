import { webUrl } from "$lib/urls";

// The GIF picker asks KLIPY with the app's key, as duvetchat/mobile#28 does, so both apps offer and send the same
// GIFs. It's a client's key, shipped in the app as Tenor's was before Tenor ended its API.
const KLIPY_KEY = "wrQpsWVVgJF6SQwLGINJ4D8uEJsya3rB0gmmwKF3SgN5SdkGZH3z6r2L0z2JJqUF";
const PER_PAGE = 20;

/** One of a GIF's files: its URL, and its size when KLIPY gives it. */
export interface GifFile {
	url: string;
	width?: number;
	height?: number;
}

/** A GIF the picker offers: the one a pick sends (its URL is the message), the smaller one the grid shows, and its
 * title. */
export interface Gif {
	url: string;
	preview: GifFile;
	description: string;
}

/** The request for the picker's GIFs: KLIPY's trending ones while query is blank, else its search for query. */
export function gifsUrl(query: string): string {
	const q = query.trim();
	const params = new URLSearchParams(q ? { q, per_page: `${PER_PAGE}` } : { per_page: `${PER_PAGE}` });
	return `https://api.klipy.com/api/v1/${KLIPY_KEY}/gifs/${q ? "search" : "trending"}?${params}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

// value[key] when value is an object, which any level of KLIPY's JSON may not be.
const field = (value: unknown, key: string) => (isObject(value) ? value[key] : undefined);

const dimension = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

// The GIF of one of an item's sizes (file.md, file.sm…), when it has an http(s) URL without whitespace: a pick sends
// the URL as the message's text, word for word, and a link there ends at whitespace.
function gifOf(file: unknown, size: string): GifFile | undefined {
	const gif = field(field(file, size), "gif");
	const url = webUrl(field(gif, "url"));
	return url && !/\s/.test(url)
		? { url, width: dimension(field(gif, "width")), height: dimension(field(gif, "height")) }
		: undefined;
}

/**
 * The GIFs of KLIPY's answer (its data.data): each one's medium GIF to send, or its large one without a medium one,
 * and its small one for the grid, else its extra-small or medium one. Ads (any type but "gif") are left out, and so
 * is an item without a GIF to send or one to show (gifOf).
 */
export function parseGifs(json: unknown): Gif[] {
	const items = field(field(json, "data"), "data");
	if (!Array.isArray(items)) return [];
	const gifs: Gif[] = [];
	for (const item of items) {
		if (field(item, "type") !== "gif") continue;
		const file = field(item, "file");
		const sent = gifOf(file, "md") ?? gifOf(file, "hd");
		const preview = gifOf(file, "sm") ?? gifOf(file, "xs") ?? gifOf(file, "md");
		if (!sent || !preview) continue;
		const title = field(item, "title");
		gifs.push({ url: sent.url, preview, description: typeof title === "string" ? title : "" });
	}
	return gifs;
}
