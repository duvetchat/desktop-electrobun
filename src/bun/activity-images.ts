// The images an IPC app names by URL, sent inline instead (desktop#148). Since gateway#134 the gateway keeps an
// activity's images only as small data URIs, and leaves out any other value: by URL, every member who opened the
// user's card loaded the image from a host the app picked, which learned their IP. So an image an app names by URL
// is fetched here, on the user's own computer, where only the host the user's own app picked learns the user's IP,
// as when that app loads it, then made small by the webview (Bun has no image decoder; a canvas has) and sent as a
// data URI. One that can't be is left out of the activity, never sent as its URL.
import { MAX_IMAGE_BYTES, type ActivityPayload } from "./activities";
import { decodable } from "./image-size";

/** The most bytes an image may have to be made inline: counted as it's read, before anything decodes it. */
export const MAX_SOURCE_BYTES = 4 << 20;
// How long the image's fetch may take, its redirects and its bytes included, and how many redirects it follows.
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
// How many URLs' inline images are kept, the most recently used: an activity is sent again every 45 seconds and an
// app sends its own again, and a song comes back, without fetching anything.
const KEPT_IMAGES = 64;
/** How long an image that couldn't be fetched or made inline waits before an activity naming it tries it again. */
export const RETRY_FAILED_MS = 2 * 60_000;

/** Makes an image's bytes a small inline image (the webview's activityThumbnail), or null when it can't. */
export type Thumbnailer = (bytes: Uint8Array) => Promise<string | null>;

/**
 * The bytes at url, an http(s) URL, or null when it isn't one, or its answer isn't a 2xx within FETCH_TIMEOUT_MS
 * and MAX_REDIRECTS redirects (each to an http(s) URL too), or it has more than MAX_SOURCE_BYTES, or it's compressed,
 * or stop aborts first (no activity needs it any more).
 */
export async function fetchImageBytes(
	url: string,
	stop?: AbortSignal,
	timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Uint8Array | null> {
	const timeout = AbortSignal.timeout(timeoutMs);
	const signal = stop ? AbortSignal.any([stop, timeout]) : timeout;
	try {
		let target = new URL(url);
		for (let redirects = 0; ; redirects++) {
			if (target.protocol !== "http:" && target.protocol !== "https:") return null;
			// The bytes as they're sent: Bun's fetch would otherwise inflate a compressed answer, the one the app ships
			// (1.3.9) whole before a byte of it is read here, so a few KiB of it could take gigabytes. So the host is
			// asked for no compression, and an answer compressed all the same is refused.
			const res = await fetch(target, {
				redirect: "manual",
				signal,
				decompress: false,
				headers: { "accept-encoding": "identity" },
			});
			const location = res.headers.get("location");
			if (res.status >= 300 && res.status < 400 && location) {
				await res.body?.cancel();
				if (redirects === MAX_REDIRECTS) return null;
				target = new URL(location, target);
				continue;
			}
			const encoding = res.headers.get("content-encoding")?.trim().toLowerCase();
			if (
				!res.ok ||
				!res.body ||
				(encoding && encoding !== "identity") ||
				Number(res.headers.get("content-length")) > MAX_SOURCE_BYTES
			) {
				await res.body?.cancel();
				return null;
			}
			return await readAtMost(res.body, MAX_SOURCE_BYTES);
		}
	} catch {
		return null; // not a URL, no answer in time, or the connection failed
	}
}

// What body holds, or null past max bytes, where the rest isn't read.
async function readAtMost(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
	const chunks: Uint8Array[] = [];
	let length = 0;
	for await (const chunk of body) {
		length += chunk.length;
		if (length > max) return null; // leaving the loop cancels the stream
		chunks.push(chunk);
	}
	const bytes = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.length;
	}
	return bytes;
}

/** How many images are fetched and made inline at once, whatever the apps: the others wait for a place. */
export const MAKING_AT_ONCE = 2;

/** An activity's images as ActivityImages has them. */
export interface Images {
	/** url's inline image once made; null while one that couldn't be waits to be tried again; undefined to make. */
	known(url: string): string | null | undefined;
	/** Makes url's inline image, unless signal aborts first: undefined when it isn't made. */
	inline(url: string, signal?: AbortSignal): Promise<string | undefined>;
}

/**
 * The inline images of the URLs activities name, each fetched and made once and kept for the next activity that names
 * it. MAKING_AT_ONCE are made at a time, and one an activity no longer needs (signal aborted) stops, or never starts.
 * One that couldn't be is tried again only RETRY_FAILED_MS later, as an app sends its activity again every few
 * seconds, but one the webview didn't answer for (a page that was loading) is tried again with the next activity.
 */
export class ActivityImages implements Images {
	private readonly kept = new Map<string, string>();
	private readonly failed = new Map<string, number>();
	private running = 0;
	private readonly queue: (() => void)[] = [];

	constructor(
		private readonly thumbnail: Thumbnailer,
		private readonly fetchBytes: (url: string, signal?: AbortSignal) => Promise<Uint8Array | null> = fetchImageBytes,
		private readonly now: () => number = Date.now,
		private readonly atOnce = MAKING_AT_ONCE,
	) {}

	known(url: string): string | null | undefined {
		const kept = this.kept.get(url);
		if (kept !== undefined) {
			// The most recently used goes last, so it's the last to go.
			this.kept.delete(url);
			this.kept.set(url, kept);
			return kept;
		}
		const failedAt = this.failed.get(url);
		return failedAt !== undefined && this.now() - failedAt < RETRY_FAILED_MS ? null : undefined;
	}

	async inline(url: string, signal?: AbortSignal): Promise<string | undefined> {
		const known = this.known(url);
		if (known !== undefined) return known ?? undefined;
		if (!(await this.place(signal))) return undefined;
		try {
			if (signal?.aborted) return undefined;
			// Made while this one waited for its place.
			const meanwhile = this.known(url);
			if (meanwhile !== undefined) return meanwhile ?? undefined;
			return await this.make(url, signal);
		} finally {
			this.leave();
		}
	}

	// A place among those making images, once one is free; false when signal aborts first.
	private place(signal?: AbortSignal): Promise<boolean> {
		if (signal?.aborted) return Promise.resolve(false);
		if (this.running < this.atOnce) {
			this.running++;
			return Promise.resolve(true);
		}
		return new Promise((resolve) => {
			const start = () => {
				signal?.removeEventListener("abort", stop);
				this.running++;
				resolve(true);
			};
			const stop = () => {
				this.queue.splice(this.queue.indexOf(start), 1);
				resolve(false);
			};
			this.queue.push(start);
			signal?.addEventListener("abort", stop, { once: true });
		});
	}

	private leave() {
		this.running--;
		this.queue.shift()?.();
	}

	private async make(url: string, signal?: AbortSignal): Promise<string | undefined> {
		const bytes = await this.fetchBytes(url, signal);
		// No activity needs it any more: nothing failed.
		if (signal?.aborted) return undefined;
		let image: string | null = null;
		// The webview decodes what it's given whole: an image its headers don't say is small enough never reaches it.
		const fits = !!bytes && decodable(bytes);
		if (fits) {
			try {
				image = await this.thumbnail(bytes);
			} catch (err) {
				console.error(`[activity images] the webview made no image from ${hostOf(url)}:`, err);
				return undefined;
			}
		}
		if (image?.startsWith("data:image/") && new TextEncoder().encode(image).length <= MAX_IMAGE_BYTES) {
			this.failed.delete(url);
			this.kept.set(url, image);
			if (this.kept.size > KEPT_IMAGES) this.kept.delete(this.kept.keys().next().value!);
			return image;
		}
		const why = !bytes ? "not fetched" : !fits ? "not an image this size or kind" : "the webview made none";
		console.error(`[activity images] no inline image from ${hostOf(url)}: ${why}`);
		this.failed.set(url, this.now());
		if (this.failed.size > KEPT_IMAGES) this.failed.delete(this.failed.keys().next().value!);
		return undefined;
	}
}

// Only the host goes into the log: an image's URL can carry what signs it.
function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "a URL that doesn't parse";
	}
}

const isUrl = (image: string | undefined): image is string => image !== undefined && /^https?:\/\//i.test(image);

/** The images activity names by URL. */
export function imageUrls(activity: ActivityPayload): string[] {
	return [activity.assets?.large_image, activity.assets?.small_image].filter(isUrl);
}

/**
 * activity with each image it names by URL as images knows it: inline once made, left out until then or when it
 * can't be, never as its URL. Any other value is as the app sent it (a data URI, which the gateway checks).
 */
export function withKnownImages(activity: ActivityPayload, images: Pick<Images, "known">): ActivityPayload {
	const assets = activity.assets;
	if (!assets) return activity;
	const known = (image: string | undefined) => (isUrl(image) ? (images.known(image) ?? undefined) : image);
	return {
		...activity,
		assets: { ...assets, large_image: known(assets.large_image), small_image: known(assets.small_image) },
	};
}

/**
 * The IPC apps' activities, each client's last, with their images inline (withKnownImages). An activity shows at once,
 * with the images made so far, and again once the others are made, so that an app that keeps changing them still
 * shows. A client has its images made one activity at a time: a new one stops what its last one was making, unless it
 * names the same images, and a cleared one or a client that left stops it too. onChange runs each time what's shown
 * changes.
 */
export class IpcActivities {
	private readonly shown = new Map<object, ActivityPayload>();
	private readonly making = new Map<object, { urls: string; activity: ActivityPayload; stop: AbortController }>();

	constructor(
		private readonly images: Images,
		private readonly onChange: () => void,
	) {}

	/** The activities shown, each client's in the order its first one came. */
	activities(): ActivityPayload[] {
		return [...this.shown.values()];
	}

	/** client's new activity, or null for none (fitActivity found nothing to show). */
	set(client: object, activity: ActivityPayload | null) {
		if (!activity) return this.clear(client);
		const urls = imageUrls(activity);
		const making = this.making.get(client);
		if (making && making.urls === urls.join(" ")) {
			// The same images, still being made: they show with this activity.
			making.activity = activity;
		} else {
			making?.stop.abort();
			this.making.delete(client);
			const toMake = urls.filter((url) => this.images.known(url) === undefined);
			if (toMake.length) this.make(client, activity, urls, toMake);
		}
		this.show(client, activity);
	}

	/** client has no activity any more: it cleared it, or left. */
	clear(client: object) {
		this.making.get(client)?.stop.abort();
		this.making.delete(client);
		this.shown.delete(client);
		this.onChange();
	}

	private make(client: object, activity: ActivityPayload, urls: string[], toMake: string[]) {
		const job = { urls: urls.join(" "), activity, stop: new AbortController() };
		this.making.set(client, job);
		Promise.all(toMake.map((url) => this.images.inline(url, job.stop.signal))).then(
			() => {
				if (this.making.get(client) !== job) return;
				this.making.delete(client);
				this.show(client, job.activity);
			},
			(err) => {
				// The activity stays shown, without the images that weren't made.
				console.error("[activity images] making an activity's images failed:", err);
				if (this.making.get(client) === job) this.making.delete(client);
			},
		);
	}

	private show(client: object, activity: ActivityPayload) {
		this.shown.set(client, withKnownImages(activity, this.images));
		this.onChange();
	}
}
