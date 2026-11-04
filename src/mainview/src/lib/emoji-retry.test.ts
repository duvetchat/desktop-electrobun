import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	CUSTOM_EMOJI_CLASS,
	EMOJI_RETRIES,
	EmojiRetries,
	GIVE_UP_MS,
	retryAfterMs,
	retryEmojis,
	retryWait,
	type EmojiImage,
} from "./emoji-retry";

Object.assign(globalThis, { VITE_API_URL: "https://api.test", VITE_WS_URL: "", VITE_DOMAIN_TARGET_ENV: "duvet" });

const URL_A = "https://api.test/attachments/0190a3b2-0000-7000-8000-000000000001";
const URL_B = "https://api.test/attachments/0190a3b2-0000-7000-8000-000000000002";

// A page whose requests answer from a list, in order, and that writes down what happened, the waits included. An
// answer can be made as it's asked for.
function page(answers: (Response | Error | (() => Response))[]) {
	const events: string[] = [];
	let now = 1_000_000;
	let blobs = 0;
	const revoked: string[] = [];
	const retries = new EmojiRetries({
		fetch: async (url, init) => {
			events.push(`${init.method} ${url}`);
			const answer = answers.shift();
			if (!answer) throw new Error(`no answer left for ${init.method} ${url}`);
			if (answer instanceof Error) throw answer;
			return typeof answer === "function" ? answer() : answer;
		},
		sleep: async (ms) => {
			events.push(`wait ${ms}`);
			now += ms;
		},
		now: () => now,
		random: () => 0,
		objectUrl: () => `blob:emoji-${++blobs}`,
		revokeUrl: (url) => revoked.push(url),
	});
	return { retries, events, revoked, later: (ms: number) => (now += ms) };
}

function image(src = URL_A) {
	const img = {
		src,
		isConnected: true as boolean,
		shown: [] as string[],
		named: false,
		// The image loaded what it was shown.
		loaded: () => {},
		show(next: string, settled?: () => void) {
			img.src = next;
			img.shown.push(next);
			img.loaded = settled ?? (() => {});
		},
		showName() {
			img.named = true;
		},
	} satisfies EmojiImage & Record<string, unknown>;
	return img;
}

const ok = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { "content-type": "image/png" } });
const status = (code: number, headers: Record<string, string> = {}) => new Response("", { status: code, headers });

describe("EmojiRetries", () => {
	test("asks a file that answers 503 again only after a wait, and as long as its Retry-After asks", async () => {
		const { retries, events } = page([
			ok(),
			status(503, { "Retry-After": "2" }),
			status(429, { "Retry-After": "30" }),
			ok(),
		]);
		const img = image();
		await retries.failed(img);
		expect(events).toEqual([
			`HEAD ${URL_A}`, // tells a gone file without asking for it
			"wait 2000",
			`GET ${URL_A}`,
			"wait 4000", // longer than the 2 s Retry-After asked
			`GET ${URL_A}`,
			"wait 30000", // as long as the 30 s Retry-After asked
			`GET ${URL_A}`,
		]);
		expect(img.shown).toEqual(["blob:emoji-1"]);
		expect(img.named).toBe(false);
	});

	test("never asks again for a file that's gone, a 404 above all", async () => {
		const { retries, events } = page([status(404)]);
		const img = image();
		await retries.failed(img);
		expect(events).toEqual([`HEAD ${URL_A}`]);
		expect(img.named).toBe(true);
		// Another image of that emoji shows its name at once.
		const again = image();
		await retries.failed(again);
		expect(events).toEqual([`HEAD ${URL_A}`]);
		expect(again.named).toBe(true);
	});

	test("stops at a 4xx but 429 that a try again gets", async () => {
		const { retries, events } = page([ok(), status(403)]);
		const img = image();
		await retries.failed(img);
		expect(events).toEqual([`HEAD ${URL_A}`, "wait 2000", `GET ${URL_A}`]);
		expect(img.named).toBe(true);
	});

	test("lets the image load a file the API sends on to Duvet's storage, and waits longer if that fails again", async () => {
		const { retries, events } = page([
			ok(),
			Response.redirect("https://storage.test/x?signed", 307),
			new TypeError("Failed to fetch"),
			ok(),
		]);
		const img = image();
		await retries.failed(img);
		expect(img.src.startsWith(`${URL_A}?r=`)).toBe(true);
		// Its load fails again: the next try waits longer, and asks no HEAD; an answer it can't read loads in the image.
		await retries.failed(img);
		expect(img.src.startsWith(`${URL_A}?r=`)).toBe(true);
		await retries.failed(img);
		expect(events).toEqual([
			`HEAD ${URL_A}`,
			"wait 2000",
			`GET ${URL_A}`,
			"wait 4000",
			`GET ${URL_A}`,
			"wait 8000",
			`GET ${URL_A}`,
		]);
		expect(img.shown.at(-1)).toBe("blob:emoji-1");
	});

	test(`gives up after ${EMOJI_RETRIES} tries again, and tries again only for an image that fails ${GIVE_UP_MS / 60_000} minutes later`, async () => {
		const failures = Array.from({ length: EMOJI_RETRIES }, () => status(502));
		const { retries, events, later } = page([ok(), ...failures, ok(), ok()]);
		const img = image();
		await retries.failed(img);
		expect(img.named).toBe(true);
		expect(events.filter((e) => e.startsWith("GET"))).toHaveLength(EMOJI_RETRIES);
		expect(events.filter((e) => e.startsWith("wait"))).toEqual([
			"wait 2000",
			"wait 4000",
			"wait 8000",
			"wait 16000",
			"wait 32000",
		]);
		const soon = image();
		events.length = 0;
		await retries.failed(soon);
		expect(events).toEqual([]);
		expect(soon.named).toBe(true);
		later(GIVE_UP_MS);
		const afterwards = image();
		await retries.failed(afterwards);
		expect(events).toEqual([`HEAD ${URL_A}`, "wait 2000", `GET ${URL_A}`]);
		expect(afterwards.shown).toEqual(["blob:emoji-1"]);
	});

	test("waits its 5 minutes from when it gave up, however many of its images fail meanwhile", async () => {
		const failures = Array.from({ length: EMOJI_RETRIES }, () => status(502));
		const { retries, events, later } = page([ok(), ...failures, ok(), ok()]);
		await retries.failed(image());
		events.length = 0;
		later(GIVE_UP_MS - 60_000);
		const meanwhile = image();
		await retries.failed(meanwhile);
		expect(meanwhile.named).toBe(true);
		expect(events).toEqual([]);
		later(60_000);
		const afterwards = image();
		await retries.failed(afterwards);
		expect(events).toEqual([`HEAD ${URL_A}`, "wait 2000", `GET ${URL_A}`]);
		expect(afterwards.shown).toEqual(["blob:emoji-1"]);
	});

	test("asks once for all the images of an emoji, and shows its bytes to those that fail later", async () => {
		const { retries, events, revoked } = page([ok(), ok()]);
		const [one, two] = [image(), image()];
		await Promise.all([retries.failed(one), retries.failed(two)]);
		expect(events).toEqual([`HEAD ${URL_A}`, "wait 2000", `GET ${URL_A}`]);
		// Each from a URL of its own, revoked once the image has loaded it.
		expect([one.shown, two.shown]).toEqual([["blob:emoji-1"], ["blob:emoji-2"]]);
		one.loaded();
		expect(revoked).toEqual(["blob:emoji-1"]);
		const three = image();
		await retries.failed(three);
		expect(three.shown).toEqual(["blob:emoji-3"]);
		expect(events).toHaveLength(3);
		three.loaded();
		two.loaded();
		expect(revoked).toEqual(["blob:emoji-1", "blob:emoji-3", "blob:emoji-2"]);
	});

	test("asks nothing more once no image of the emoji is left in the page", async () => {
		const { retries, events } = page([ok()]);
		const img = image();
		const failing = retries.failed(img);
		img.isConnected = false;
		await failing;
		expect(events).toEqual([`HEAD ${URL_A}`, "wait 2000"]);
		expect(img.shown).toEqual([]);
	});

	test("gives up at once on a Retry-After past five minutes", async () => {
		const { retries, events } = page([ok(), status(503, { "Retry-After": "3600" })]);
		const img = image();
		await retries.failed(img);
		expect(events).toEqual([`HEAD ${URL_A}`, "wait 2000", `GET ${URL_A}`]);
		expect(img.named).toBe(true);
		// The HEAD's own.
		const head = page([status(429, { "Retry-After": "3600" })]);
		const other = image();
		await head.retries.failed(other);
		expect(head.events).toEqual([`HEAD ${URL_A}`]);
		expect(other.named).toBe(true);
	});

	test("waits as long as a 429 to its HEAD asks before its first try again", async () => {
		const { retries, events } = page([status(429, { "Retry-After": "30" }), ok()]);
		const img = image();
		await retries.failed(img);
		expect(events).toEqual([`HEAD ${URL_A}`, "wait 30000", `GET ${URL_A}`]);
		expect(img.shown).toEqual(["blob:emoji-1"]);
	});

	test("asks again after a wait for a file whose body broke off", async () => {
		const broken = new Response(new ReadableStream({ start: (stream) => stream.error(new Error("connection reset")) }));
		const { retries, events } = page([ok(), broken, ok()]);
		const img = image();
		await retries.failed(img);
		expect(events).toEqual([`HEAD ${URL_A}`, "wait 2000", `GET ${URL_A}`, "wait 4000", `GET ${URL_A}`]);
		expect(img.shown).toEqual(["blob:emoji-1"]);
	});

	test("forgets an emoji's tries once no image of it is left: the next image of it that fails starts afresh", async () => {
		const img = image();
		const { retries, events } = page([ok(), () => ((img.isConnected = false), status(503)), ok(), ok()]);
		await retries.failed(img);
		const next = image();
		await retries.failed(next);
		expect(events).toEqual([
			`HEAD ${URL_A}`,
			"wait 2000",
			`GET ${URL_A}`, // a 503, as its image leaves the page
			"wait 4000",
			`HEAD ${URL_A}`,
			"wait 2000",
			`GET ${URL_A}`,
		]);
		expect(next.shown).toEqual(["blob:emoji-1"]);
	});

	test("shows the name of an emoji whose fetched bytes don't load, and keeps each emoji apart", async () => {
		const { retries, events } = page([status(404)]);
		const broken = image("blob:emoji-7");
		await retries.failed(broken);
		expect(broken.named).toBe(true);
		expect(events).toEqual([]);
		await retries.failed(image(URL_B));
		expect(events).toEqual([`HEAD ${URL_B}`]);
	});
});

describe("retryWait", () => {
	test("waits 2 s, twice as long each time up to a minute, or longer when Retry-After asks", () => {
		const none = () => 0;
		expect([1, 2, 3, 4, 5, 6, 7].map((n) => retryWait(n, undefined, none))).toEqual([
			2000, 4000, 8000, 16000, 32000, 60000, 60000,
		]);
		expect(retryWait(1, 30_000, none)).toBe(30_000);
		expect(retryWait(3, 2_000, none)).toBe(8_000);
		expect(retryWait(1, undefined, () => 0.999)).toBe(2499);
	});
});

describe("retryAfterMs", () => {
	test("reads a Retry-After's seconds or date", () => {
		const now = Date.parse("2026-11-03T12:00:00Z");
		expect(retryAfterMs("2", now)).toBe(2000);
		expect(retryAfterMs(" 120 ", now)).toBe(120_000);
		expect(retryAfterMs("Tue, 03 Nov 2026 12:00:30 GMT", now)).toBe(30_000);
		expect(retryAfterMs("Tue, 03 Nov 2026 11:00:00 GMT", now)).toBe(0);
		expect(retryAfterMs(null, now)).toBeUndefined();
		expect(retryAfterMs("soon", now)).toBeUndefined();
		expect(retryAfterMs("-1", now)).toBeUndefined();
	});
});

// The document as an image's error reaches it, in the capture phase alone: the event doesn't bubble.
function fakeDocument() {
	const listeners: { type: string; listener: EventListenerOrEventListenerObject; capture: boolean }[] = [];
	const inCapture = (options?: boolean | EventListenerOptions) =>
		typeof options === "boolean" ? options : !!options?.capture;
	return {
		listeners,
		addEventListener(
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | AddEventListenerOptions,
		) {
			if (listener) listeners.push({ type, listener, capture: inCapture(options) });
		},
		removeEventListener(
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | EventListenerOptions,
		) {
			const at = listeners.findIndex(
				(l) => l.type === type && l.listener === listener && l.capture === inCapture(options),
			);
			if (at >= 0) listeners.splice(at, 1);
		},
		/** target failed to load. */
		fail(target: object) {
			const event = new Event("error");
			Object.defineProperty(event, "target", { value: target });
			for (const { type, listener, capture } of [...listeners]) {
				if (type !== "error" || !capture) continue;
				if (typeof listener === "function") listener(event);
				else listener.handleEvent(event);
			}
		},
	};
}

// An <img> as retryEmojis reads it.
class FakeImage {
	readonly isConnected = true;
	readonly ownerDocument = { createElement: () => ({}) };
	readonly classList: { contains: (name: string) => boolean };
	readonly replaced = Promise.withResolvers<{ title?: string; textContent?: string }>();
	constructor(
		public src: string,
		public title: string,
		classes: string[],
	) {
		this.classList = { contains: (name) => classes.includes(name) };
	}
	replaceWith(node: { title?: string; textContent?: string }) {
		this.replaced.resolve(node);
	}
}

describe("retryEmojis", () => {
	let fetched: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
	beforeEach(() => {
		Object.assign(globalThis, { HTMLImageElement: FakeImage });
		// The file is gone: an emoji shows its name after its HEAD, and nothing waits.
		fetched = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
	});
	afterEach(() => {
		fetched.mockRestore();
		Reflect.deleteProperty(globalThis, "HTMLImageElement");
	});

	test("hears a custom emoji's image fail, in the capture phase, and tries it again", async () => {
		const doc = fakeDocument();
		retryEmojis(doc);
		const img = new FakeImage(URL_A, "party", [CUSTOM_EMOJI_CLASS]);
		doc.fail(img);
		expect(fetched.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([[URL_A, "HEAD"]]);
		expect(await img.replaced.promise).toEqual({ title: "Emoji failed to load", textContent: "party" });
	});

	test("leaves any other image alone", async () => {
		const doc = fakeDocument();
		retryEmojis(doc);
		const img = new FakeImage(URL_A, "an avatar", ["rounded-full"]);
		doc.fail(img);
		await Bun.sleep(0);
		expect(fetched).not.toHaveBeenCalled();
		expect(await Promise.race([img.replaced.promise, Bun.sleep(10).then(() => "kept")])).toBe("kept");
	});

	test("takes its listener away, as a hot update of markdown.ts does before it runs again", () => {
		const doc = fakeDocument();
		const stop = retryEmojis(doc);
		stop();
		expect(doc.listeners).toEqual([]);
		doc.fail(new FakeImage(URL_A, "party", [CUSTOM_EMOJI_CLASS]));
		expect(fetched).not.toHaveBeenCalled();
	});

	test("markdown.ts has the document listen as it loads in a page", async () => {
		const doc = fakeDocument();
		Object.assign(globalThis, { document: doc });
		try {
			// A module of its own: markdown.test.ts loads it with no document.
			const markdown = "./markdown.ts?in-a-page";
			await import(markdown);
		} finally {
			Reflect.deleteProperty(globalThis, "document");
		}
		expect(doc.listeners.map(({ type, capture }) => ({ type, capture }))).toEqual([{ type: "error", capture: true }]);
		doc.fail(new FakeImage(URL_A, "party", [CUSTOM_EMOJI_CLASS]));
		expect(fetched).toHaveBeenCalledTimes(1);
	});
});
