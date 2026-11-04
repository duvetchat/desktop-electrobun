// The images an IPC app names by URL, sent inline instead (desktop#148). Since gateway#134 the gateway keeps an
// activity's images only as small data URIs, and leaves out any other value: by URL, every member who opened the
// user's card loaded the image from a host the app picked, which learned their IP. So an image an app names by URL
// is fetched here, on the user's own computer, where only the host the user's own app picked learns the user's IP,
// as when that app loads it, then made small by the webview (Bun has no image decoder; a canvas has) and sent as a
// data URI. One that can't be is left out of the activity, never sent as its URL.
import { MAX_IMAGE_BYTES, type ActivityPayload } from "./activities";

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
 * and MAX_REDIRECTS redirects (each to an http(s) URL too), or it has more than MAX_SOURCE_BYTES, or it's compressed.
 */
export async function fetchImageBytes(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Uint8Array | null> {
	const signal = AbortSignal.timeout(timeoutMs);
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

/**
 * The inline images of the URLs activities name, each fetched and made once: kept for the next activity that names
 * it, and while it's being made, shared with any that names it meanwhile. One that couldn't be is tried again only
 * RETRY_FAILED_MS later, as an app sends its activity again every few seconds, but one the webview didn't answer for
 * (a page that was loading) is tried again with the next activity.
 */
export class ActivityImages {
	private readonly kept = new Map<string, string>();
	private readonly failed = new Map<string, number>();
	private readonly making = new Map<string, Promise<string | undefined>>();

	constructor(
		private readonly thumbnail: Thumbnailer,
		private readonly fetchBytes: (url: string) => Promise<Uint8Array | null> = fetchImageBytes,
		private readonly now: () => number = Date.now,
	) {}

	/** url's image inline, or undefined when it can't be. */
	inline(url: string): Promise<string | undefined> {
		const kept = this.kept.get(url);
		if (kept !== undefined) {
			// The most recently used goes last, so it's the last to go.
			this.kept.delete(url);
			this.kept.set(url, kept);
			return Promise.resolve(kept);
		}
		const failedAt = this.failed.get(url);
		if (failedAt !== undefined && this.now() - failedAt < RETRY_FAILED_MS) return Promise.resolve(undefined);
		let making = this.making.get(url);
		if (!making) {
			making = this.make(url).finally(() => this.making.delete(url));
			this.making.set(url, making);
		}
		return making;
	}

	private async make(url: string): Promise<string | undefined> {
		const bytes = await this.fetchBytes(url);
		let image: string | null = null;
		if (bytes) {
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
		console.error(`[activity images] no inline image from ${hostOf(url)}: ${bytes ? "not one" : "not fetched"}`);
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

/**
 * The IPC apps' activities, each client's last, with their images inline (withInlineImages). An activity takes its
 * client's place once its images are, unless the client sent another, cleared it or left meanwhile: an image being
 * fetched never brings back an activity the app has replaced. onChange runs each time what's shown changes.
 */
export class IpcActivities {
	private readonly shown = new Map<object, ActivityPayload>();
	private readonly pending = new Map<object, Promise<ActivityPayload>>();

	constructor(
		private readonly images: Pick<ActivityImages, "inline">,
		private readonly onChange: () => void,
	) {}

	/** The activities shown, each client's in the order its first one came. */
	activities(): ActivityPayload[] {
		return [...this.shown.values()];
	}

	/** client's new activity, or null for none (fitActivity found nothing to show). */
	set(client: object, activity: ActivityPayload | null) {
		if (!activity) return this.clear(client);
		const ready = withInlineImages(activity, this.images);
		this.pending.set(client, ready);
		void ready.then((inline) => {
			if (this.pending.get(client) !== ready) return;
			this.pending.delete(client);
			this.shown.set(client, inline);
			this.onChange();
		});
	}

	/** client has no activity any more: it cleared it, or left. */
	clear(client: object) {
		this.pending.delete(client);
		this.shown.delete(client);
		this.onChange();
	}
}

/**
 * activity with its images inline: each http(s) one as images makes it, or left out when it can't be, never as its
 * URL. Any other value is as the app sent it (a data URI, which the gateway checks).
 */
export async function withInlineImages(
	activity: ActivityPayload,
	images: Pick<ActivityImages, "inline">,
): Promise<ActivityPayload> {
	const assets = activity.assets;
	if (!assets) return activity;
	const inline = (image: string | undefined) =>
		image !== undefined && /^https?:\/\//i.test(image) ? images.inline(image) : Promise.resolve(image);
	const [large, small] = await Promise.all([inline(assets.large_image), inline(assets.small_image)]);
	return { ...activity, assets: { ...assets, large_image: large, small_image: small } };
}
