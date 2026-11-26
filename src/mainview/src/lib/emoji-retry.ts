// What happens when a custom emoji's image fails to load (desktop#146). Its file can be one the API serves from a
// space's bucket, which answers a broken bucket or a full pool with a 502 or a 503 and a Retry-After, and a 429 past
// the IP's budget (api#197): asking again at once, as the emoji did ten times, only adds to what that IP is counted.
// So it's asked again only after a wait, longer each time and as long as Retry-After asks, and never once its file
// is gone. An <img>'s error tells nothing of its answer, so the tries again are fetches, which do: the API lets this
// app read their status and Retry-After (CORS). A working emoji loads as any image, at once and from the cache.
import { t } from "$lib/i18n";

/** How many times an emoji's file is asked for again, at most, after its image failed. */
export const EMOJI_RETRIES = 5;
// The first wait, which doubles each time up to the longest, and the longest Retry-After waited for: past it, the
// emoji shows its name.
const FIRST_WAIT_MS = 2_000;
const LONGEST_WAIT_MS = 60_000;
const LONGEST_RETRY_AFTER_MS = 5 * 60_000;
/** How long an emoji whose tries again all failed shows its name before an image of it that fails tries again. */
export const GIVE_UP_MS = 5 * 60_000;

/**
 * The wait before the attempt-th try again (1, 2, …): 2 s, twice as long each time up to a minute, or what the last
 * answer's Retry-After asked when it's longer; up to half a second more at random, so that the emojis of a page that
 * failed together don't all ask again at the same moment.
 */
export function retryWait(attempt: number, askedMs: number | undefined, random: () => number): number {
	const backoff = Math.min(FIRST_WAIT_MS * 2 ** (attempt - 1), LONGEST_WAIT_MS);
	return Math.max(backoff, askedMs ?? 0) + Math.floor(random() * 500);
}

/**
 * A Retry-After header's wait, in milliseconds: its seconds, or until its date, as HTTP writes one ("Tue, 03 Nov 2026
 * 12:00:30 GMT"); undefined when it has neither.
 */
export function retryAfterMs(header: string | null, now: number): number | undefined {
	const value = header?.trim() ?? "";
	if (/^\d+$/.test(value)) return Number(value) * 1000;
	if (!/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return undefined;
	const date = Date.parse(value);
	return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** An emoji's image, as a try again sees it: where it loads from, whether it's still in the page, and its fallback. */
export interface EmojiImage {
	readonly src: string;
	readonly isConnected: boolean;
	/** Loads the image from src; settled, when given, runs once the image has loaded it or failed to. */
	show(src: string, settled?: () => void): void;
	/** Shows the emoji's name instead of its image. */
	showName(): void;
}

/** What a try again needs from the page: a fetch, a timer, a clock, chance, and URLs for bytes it fetched. */
export interface RetryDeps {
	fetch: (url: string, init: RequestInit) => Promise<Response>;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	random: () => number;
	objectUrl: (blob: Blob) => string;
	revokeUrl: (url: string) => void;
}

// A 4xx but 429: the file is gone, or never was, and asking again won't change that.
const isGone = (status: number) => status >= 400 && status < 500 && status !== 429;

// A request about an emoji's file, which no cache answers, and that follows no redirect: the API sends Duvet's own
// files on to their storage, whose answer this page may not read. Null when no answer came that this page may read.
async function request(deps: RetryDeps, url: string, method: "GET" | "HEAD"): Promise<Response | null> {
	try {
		return await deps.fetch(url, { method, redirect: "manual", cache: "no-store", credentials: "omit" });
	} catch {
		return null; // offline, or an answer this page may not read
	}
}

// What a try again got: the file's bytes; a file elsewhere (the API sent it on to its storage) or an answer this page
// may not read, either way one the image itself can load; a file that's gone; or a wait, as long as it asked.
type Answer = { kind: "bytes"; blob: Blob } | { kind: "elsewhere" } | { kind: "gone" } | { kind: "wait"; ms?: number };

async function askAgain(deps: RetryDeps, url: string): Promise<Answer> {
	const res = await request(deps, url, "GET");
	if (!res || res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) return { kind: "elsewhere" };
	if (res.ok) {
		try {
			return { kind: "bytes", blob: await res.blob() };
		} catch {
			return { kind: "wait" }; // its body broke off
		}
	}
	if (isGone(res.status)) return { kind: "gone" };
	return { kind: "wait", ms: retryAfterMs(res.headers.get("Retry-After"), deps.now()) };
}

// An emoji's file, by its URL, as every image of it shares it: how many times it was asked for again, the try again
// under way and the images waiting for it, and how it ended.
interface EmojiFile {
	attempts: number;
	recovery?: Promise<Blob | string | null>;
	waiting: Set<EmojiImage>;
	/** Its bytes, fetched by a try again: an image of it shows them without asking again. */
	loaded?: Blob;
	gone?: boolean;
	gaveUpAt?: number;
}

/**
 * The tries again of the emojis' files, each once for all the images of an emoji: an emoji that shows twenty times
 * asks as one. A file found gone (a 404 above all) is never asked for again.
 */
export class EmojiRetries {
	private readonly files = new Map<string, EmojiFile>();

	constructor(private readonly deps: RetryDeps) {}

	/** img failed to load: it shows the emoji once a try again gets it, or the emoji's name when none does. */
	async failed(img: EmojiImage): Promise<void> {
		// Bytes a try again fetched, that aren't an image after all.
		if (img.src.startsWith("blob:")) return img.showName();
		const url = img.src.split("?")[0]!;
		let file = this.files.get(url);
		if (file?.gone) return img.showName();
		if (file?.loaded) return this.showBytes(img, file.loaded);
		// Its tries again all failed: its images show its name until GIVE_UP_MS after that, then try afresh.
		if (file?.gaveUpAt !== undefined && this.deps.now() - file.gaveUpAt < GIVE_UP_MS) return img.showName();
		if (!file || file.gaveUpAt !== undefined) {
			file = { attempts: 0, waiting: new Set() };
			this.files.set(url, file);
		}
		file.waiting.add(img);
		const current = file;
		current.recovery ??= this.recover(url, current).finally(() => (current.recovery = undefined));
		const next = await current.recovery;
		current.waiting.delete(img);
		if (!img.isConnected) return;
		if (next === null) img.showName();
		else if (next instanceof Blob) this.showBytes(img, next);
		else img.show(next);
	}

	// img shows the bytes from a URL of its own, revoked once it has loaded them or failed to, so that no URL outlives
	// its image's load; the bytes stay with the emoji, for its next image that fails.
	private showBytes(img: EmojiImage, bytes: Blob) {
		const url = this.deps.objectUrl(bytes);
		img.show(url, () => this.deps.revokeUrl(url));
	}

	// What the images of url load next: its bytes, url itself (asked again, so no cache answers it) for the image to
	// load, or null when they show the emoji's name.
	private async recover(url: string, file: EmojiFile): Promise<Blob | string | null> {
		let retryAfter: number | undefined;
		// Its first failure: a HEAD answers from the attachment's row, never asking the bucket, so it tells a file that
		// is gone without asking for it again. It can't tell the bucket's 502 or 503: the tries again can. A 429 says
		// how long the first waits.
		if (file.attempts === 0) {
			const head = await request(this.deps, url, "HEAD");
			if (head && isGone(head.status)) {
				file.gone = true;
				return null;
			}
			if (head && !head.ok) retryAfter = retryAfterMs(head.headers.get("Retry-After"), this.deps.now());
		}
		while (file.attempts < EMOJI_RETRIES) {
			if (retryAfter !== undefined && retryAfter > LONGEST_RETRY_AFTER_MS) break;
			file.attempts++;
			await this.deps.sleep(retryWait(file.attempts, retryAfter, this.deps.random));
			// No image of it left in the page: it asks nothing more, and the next image of it that fails starts afresh.
			if (![...file.waiting].some((img) => img.isConnected)) {
				this.files.delete(url);
				return null;
			}
			const answer = await askAgain(this.deps, url);
			if (answer.kind === "bytes") {
				file.loaded = answer.blob;
				return file.loaded;
			}
			if (answer.kind === "elsewhere") return `${url}?r=${this.deps.now()}`;
			if (answer.kind === "gone") {
				file.gone = true;
				return null;
			}
			retryAfter = answer.ms;
		}
		file.gaveUpAt = this.deps.now();
		return null;
	}
}

/** The class a custom emoji's image has (markdown.ts): the images whose errors try again. */
export const CUSTOM_EMOJI_CLASS = "custom-emoji";

/**
 * Tries again every custom emoji's image of doc that fails to load. An image's error doesn't bubble, but a listener
 * on the document in the capture phase hears it: no image needs a handler of its own, and the page no inline one.
 * Returns what takes the listener away.
 */
export function retryEmojis(doc: Pick<EventTarget, "addEventListener" | "removeEventListener">): () => void {
	const retries = new EmojiRetries({
		fetch: (url, init) => fetch(url, init),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		now: Date.now,
		random: Math.random,
		objectUrl: (blob) => URL.createObjectURL(blob),
		revokeUrl: (url) => URL.revokeObjectURL(url),
	});
	const onError = (e: Event) => {
		const img = e.target;
		if (!(img instanceof HTMLImageElement) || !img.classList.contains(CUSTOM_EMOJI_CLASS)) return;
		void retries.failed({
			get src() {
				return img.src;
			},
			get isConnected() {
				return img.isConnected;
			},
			show: (src, settled) => {
				if (settled) {
					img.addEventListener("load", settled, { once: true });
					img.addEventListener("error", settled, { once: true });
				}
				img.src = src;
			},
			showName: () => {
				const span = Object.assign(img.ownerDocument.createElement("span"), {
					title: t("media_emoji_load_failed"),
					textContent: img.title,
				});
				span.dataset.emojiFailed = "";
				// One without a name shows the words for an emoji, which a language change writes again.
				if (img.dataset.emojiUnnamed !== undefined) span.dataset.emojiUnnamed = "";
				img.replaceWith(span);
			},
		});
	};
	doc.addEventListener("error", onError, true);
	return () => doc.removeEventListener("error", onError, true);
}

/** The custom emojis of doc that gave up: each one's name, in its place (retryEmojis). */
export const failedEmojis = (doc: ParentNode) => doc.querySelectorAll<HTMLElement>("span[data-emoji-failed]");

/** Puts the tooltips of custom emojis that gave up (failedEmojis) in the app's language of the moment, and the words
 * shown in place of one without a name (a component's emoji of a Space the user isn't in): each was written once, as its
 * emoji gave up. The root layout calls it when the language changes. */
export function retitleFailedEmojis(
	spans: Iterable<{ title?: string; textContent?: string | null; dataset?: DOMStringMap }>,
): void {
	for (const span of spans) {
		span.title = t("media_emoji_load_failed");
		if (span.dataset?.emojiUnnamed !== undefined) span.textContent = `:${t("chat_emoji_unknown")}:`;
	}
}
