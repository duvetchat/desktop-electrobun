import { afterAll, describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import {
	ActivityImages,
	fetchImageBytes,
	IpcActivities,
	MAX_SOURCE_BYTES,
	RETRY_FAILED_MS,
	within,
	type Images,
} from "./activity-images";

// A host to fetch images from, on loopback only.
// A 1×1 PNG.
const PNG = Uint8Array.from(
	atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
	(c) => c.charCodeAt(0),
);
// The headers of a PNG of 16000×16000: 31 KB of 1-bit pixels would decode to a GB.
const HUGE_PNG = new Uint8Array([...PNG.subarray(0, 16), 0, 0, 0x3e, 0x80, 0, 0, 0x3e, 0x80, ...PNG.subarray(24)]);
let requests = 0;
// What the last request asked to be compressed with.
let acceptedEncoding: string | null = null;
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(req) {
		requests++;
		acceptedEncoding = req.headers.get("accept-encoding");
		const url = new URL(req.url);
		const hops = /^\/hop\/(\d+)$/.exec(url.pathname);
		if (hops) {
			const left = Number(hops[1]);
			return left === 0 ? new Response(PNG) : Response.redirect(`/hop/${left - 1}`, 302);
		}
		switch (url.pathname) {
			case "/icon.png":
				return new Response(PNG, { headers: { "content-type": "image/png" } });
			case "/to-file":
				return new Response(null, { status: 302, headers: { location: "file:///C:/Windows/win.ini" } });
			case "/missing":
				return new Response("not found", { status: 404 });
			case "/gzipped.png":
				// Compressed whatever the request asked: a few KiB of it could stand for gigabytes.
				return new Response(new Uint8Array(gzipSync(PNG)), {
					headers: { "content-type": "image/png", "content-encoding": "gzip" },
				});
			case "/identity.png":
				return new Response(PNG, { headers: { "content-type": "image/png", "content-encoding": "identity" } });
			case "/too-big": {
				// Chunked, so only reading it shows its size.
				let sent = 0;
				return new Response(
					new ReadableStream({
						pull(controller) {
							if (sent > MAX_SOURCE_BYTES) return controller.close();
							controller.enqueue(new Uint8Array(1 << 20));
							sent += 1 << 20;
						},
					}),
				);
			}
			case "/just-fits":
				return new Response(new Uint8Array(MAX_SOURCE_BYTES));
			case "/hangs":
				return new Promise<Response>(() => {});
		}
		return new Response("?", { status: 400 });
	},
});
const at = (path: string) => `http://127.0.0.1:${server.port}${path}`;
// A host whose answer says it's bigger than 4 MiB, and then sends nothing of it, so that only its length can end the
// fetch before its timeout. Bun.serve would write the length its body has.
let bigAnswers = 0;
const liar = Bun.listen({
	hostname: "127.0.0.1",
	port: 0,
	socket: {
		data(socket) {
			bigAnswers++;
			socket.write(`HTTP/1.1 200 OK\r\ncontent-type: image/png\r\ncontent-length: ${MAX_SOURCE_BYTES + 1}\r\n\r\n`);
		},
	},
});
afterAll(() => {
	server.stop(true);
	liar.stop(true);
});

describe("fetchImageBytes", () => {
	test("gives an image's bytes, following a few redirects", async () => {
		expect(await fetchImageBytes(at("/icon.png"))).toEqual(PNG);
		expect(await fetchImageBytes(at("/hop/3"))).toEqual(PNG);
	});

	test("asks for the bytes as they are, and refuses an answer compressed all the same", async () => {
		expect(await fetchImageBytes(at("/gzipped.png"))).toBeNull();
		expect(acceptedEncoding).toBe("identity");
		expect(await fetchImageBytes(at("/identity.png"))).toEqual(PNG);
	});

	test("gives nothing past three redirects, or for one to a URL that isn't http(s)", async () => {
		expect(await fetchImageBytes(at("/hop/4"))).toBeNull();
		expect(await fetchImageBytes(at("/to-file"))).toBeNull();
	});

	test("asks for nothing but http(s) URLs", async () => {
		const before = requests;
		for (const url of ["file:///C:/Windows/win.ini", "data:image/png;base64,iVBORw0KGgo=", "ftp://127.0.0.1/x", "x"]) {
			expect(await fetchImageBytes(url)).toBeNull();
		}
		expect(requests).toBe(before);
	});

	test("gives nothing for an answer that isn't a 2xx, or that comes too late", async () => {
		expect(await fetchImageBytes(at("/missing"))).toBeNull();
		const started = Date.now();
		expect(await fetchImageBytes(at("/hangs"), undefined, 200)).toBeNull();
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	test("reads no more than 4 MiB, whatever the host says the size is", async () => {
		// Given up on as soon as the answer says its length, long before its 60 s.
		const said = fetchImageBytes(`http://127.0.0.1:${liar.port}/big.png`, undefined, 60_000);
		const waited = new Promise((resolve) => setTimeout(() => resolve("still waiting"), 3_000));
		expect(await Promise.race([said, waited])).toBeNull();
		expect(bigAnswers).toBe(1);
		expect(await fetchImageBytes(at("/too-big"))).toBeNull();
		expect((await fetchImageBytes(at("/just-fits")))?.length).toBe(MAX_SOURCE_BYTES);
	});
});

// An inline image as the webview makes one, and a fetch and a webview that count their calls. A held fetch waits until
// the test lets it go, or ends with nothing when its signal aborts, as fetchImageBytes does.
const INLINE = "data:image/jpeg;base64,/9j/4AAQ";
function images(
	options: {
		fetch?: (url: string) => Uint8Array | null;
		thumbnail?: () => string | null;
		held?: boolean;
		atOnce?: number;
	} = {},
) {
	const calls = { fetched: [] as string[], made: 0, aborted: [] as string[] };
	const holding = new Map<string, () => void>();
	let now = 1_000_000;
	const cache = new ActivityImages(
		async () => {
			calls.made++;
			return options.thumbnail ? options.thumbnail() : INLINE;
		},
		async (url, signal) => {
			calls.fetched.push(url);
			if (options.held) {
				if (signal?.aborted) return null;
				await new Promise<void>((release) => {
					holding.set(url, release);
					signal?.addEventListener("abort", () => (calls.aborted.push(url), release()), { once: true });
				});
				if (signal?.aborted) return null;
			}
			return options.fetch ? options.fetch(url) : PNG;
		},
		() => now,
		options.atOnce,
	);
	return { cache, calls, later: (ms: number) => (now += ms), release: (url: string) => holding.get(url)?.() };
}
const settle = () => Bun.sleep(0);

describe("ActivityImages", () => {
	test("fetches and makes a URL's image once: the activity's resends and a song that comes back fetch nothing", async () => {
		const { cache, calls } = images();
		expect(await cache.inline("https://i.scdn.co/image/a")).toBe(INLINE);
		expect(await cache.inline("https://i.scdn.co/image/b")).toBe(INLINE);
		expect(await cache.inline("https://i.scdn.co/image/a")).toBe(INLINE);
		expect(calls.fetched).toEqual(["https://i.scdn.co/image/a", "https://i.scdn.co/image/b"]);
		expect(calls.made).toBe(2);
	});

	test("makes two images at once, whatever the apps: the others wait for a place", async () => {
		const { cache, calls, release } = images({ held: true });
		const made = ["a", "b", "c"].map((name) => cache.inline(`https://x.test/${name}.png`));
		await settle();
		expect(calls.fetched).toEqual(["https://x.test/a.png", "https://x.test/b.png"]);
		release("https://x.test/a.png");
		await settle();
		expect(calls.fetched).toEqual(["https://x.test/a.png", "https://x.test/b.png", "https://x.test/c.png"]);
		release("https://x.test/b.png");
		release("https://x.test/c.png");
		expect(await Promise.all(made)).toEqual([INLINE, INLINE, INLINE]);
	});

	test("stops an image no activity needs any more, or never starts it, and counts no failure for it", async () => {
		const { cache, calls, release } = images({ held: true, atOnce: 1 });
		const [first, second] = [new AbortController(), new AbortController()];
		const a = cache.inline("https://x.test/a.png", first.signal);
		const b = cache.inline("https://x.test/b.png", second.signal);
		await settle();
		second.abort(); // still waiting for its place: never fetched
		first.abort(); // being fetched: stopped
		expect(await a).toBeUndefined();
		expect(await b).toBeUndefined();
		await settle();
		expect(calls.fetched).toEqual(["https://x.test/a.png"]);
		expect(calls.aborted).toEqual(["https://x.test/a.png"]);
		// Nothing failed: the next activity that names it has it made.
		const again = cache.inline("https://x.test/a.png");
		await settle();
		release("https://x.test/a.png");
		expect(await again).toBe(INLINE);
	});

	test("doesn't make again an image made while another asking for it waited for its place", async () => {
		const { cache, calls, release } = images({ held: true, atOnce: 1 });
		const both = [cache.inline("https://x.test/a.png"), cache.inline("https://x.test/a.png")];
		await settle();
		release("https://x.test/a.png");
		expect(await Promise.all(both)).toEqual([INLINE, INLINE]);
		expect(calls.fetched).toEqual(["https://x.test/a.png"]);
	});

	test("tries an image that couldn't be fetched or made only two minutes later", async () => {
		for (const failing of [{ fetch: () => null }, { thumbnail: () => null }]) {
			const { cache, calls, later } = images(failing);
			expect(await cache.inline("https://x.test/a.png")).toBeUndefined();
			later(RETRY_FAILED_MS - 1);
			expect(await cache.inline("https://x.test/a.png")).toBeUndefined();
			expect(calls.fetched.length).toBe(1);
			later(1);
			expect(await cache.inline("https://x.test/a.png")).toBeUndefined();
			expect(calls.fetched.length).toBe(2);
		}
	});

	test("tries again at once an image the webview didn't answer for", async () => {
		let answered = false;
		const cache = new ActivityImages(
			async () => {
				if (!answered) throw new Error("RPC request timed out.");
				return INLINE;
			},
			async () => PNG,
		);
		expect(await cache.inline("https://x.test/a.png")).toBeUndefined();
		answered = true;
		expect(await cache.inline("https://x.test/a.png")).toBe(INLINE);
	});

	test("hands the webview no image its headers don't say is small enough to decode, nor what isn't an image", async () => {
		for (const bytes of [HUGE_PNG, new TextEncoder().encode("<svg/>")]) {
			const { cache, calls } = images({ fetch: () => bytes });
			expect(await cache.inline("https://x.test/a.png")).toBeUndefined();
			expect(calls.made).toBe(0);
		}
	});

	test("takes as an image only a text from the webview, whatever else its page sends", async () => {
		for (const answer of [42, { image: INLINE }, [INLINE], true]) {
			const cache = new ActivityImages(
				async () => answer,
				async () => PNG,
			);
			expect(await cache.inline("https://x.test/a.png")).toBeUndefined();
			expect(cache.known("https://x.test/a.png")).toBeNull(); // counted as failed: tried again later
		}
	});

	test("keeps no image that isn't an inline one of 8 KiB at most", async () => {
		for (const answer of [`data:image/png;base64,${"A".repeat(8 << 10)}`, "https://x.test/a.png", "data:text/html,x"]) {
			const { cache } = images({ thumbnail: () => answer });
			expect(await cache.inline("https://x.test/a.png")).toBeUndefined();
		}
	});

	test("keeps the 64 most recent failures, so a URL that failed long ago is tried again", async () => {
		const { cache, calls } = images({ fetch: () => null });
		for (let i = 0; i <= 64; i++) await cache.inline(`https://x.test/${i}.png`); // 65 failures: 0 goes
		calls.fetched.length = 0;
		await cache.inline("https://x.test/1.png");
		expect(calls.fetched).toEqual([]);
		await cache.inline("https://x.test/0.png");
		expect(calls.fetched).toEqual(["https://x.test/0.png"]);
	});

	test("keeps the 64 most recently used images", async () => {
		const { cache, calls } = images();
		for (let i = 0; i < 64; i++) await cache.inline(`https://x.test/${i}.png`);
		await cache.inline("https://x.test/0.png"); // used again: the newest
		await cache.inline("https://x.test/64.png"); // so 1 goes
		calls.fetched.length = 0;
		await cache.inline("https://x.test/0.png");
		await cache.inline("https://x.test/64.png");
		expect(calls.fetched).toEqual([]);
		await cache.inline("https://x.test/1.png");
		expect(calls.fetched).toEqual(["https://x.test/1.png"]);
	});
});

describe("IpcActivities", () => {
	const lol = (details = "In game") => ({
		name: "League of Legends",
		details,
		assets: { large_image: "https://x.test/lol.png", large_text: "LoL" },
	});

	test("shows an activity at once without the images it names by URL, then with them once they're made", async () => {
		const { cache, release } = images({ held: true });
		let changes = 0;
		const activities = new IpcActivities(cache, () => changes++);
		activities.set({}, lol());
		expect(activities.activities()).toEqual([{ ...lol(), assets: { large_text: "LoL" } }]);
		await settle();
		release("https://x.test/lol.png");
		await settle();
		expect(activities.activities()).toEqual([{ ...lol(), assets: { large_image: INLINE, large_text: "LoL" } }]);
		expect(changes).toBe(2);
	});

	test("never shows an image's URL, even when it can't be made", async () => {
		const { cache } = images({ fetch: () => null });
		const activities = new IpcActivities(cache, () => {});
		activities.set({}, { ...lol(), assets: { ...lol().assets, small_image: "HTTPS://x.test/badge.png" } });
		await settle();
		expect(activities.activities()).toEqual([{ ...lol(), assets: { large_text: "LoL" } }]);
		expect(JSON.stringify(activities.activities())).not.toContain("x.test");
	});

	test("keeps an inline image as it is, and fetches nothing for it", async () => {
		const { cache, calls } = images();
		const activities = new IpcActivities(cache, () => {});
		const svg = "data:image/svg+xml;base64,PHN2Zy8+";
		const vscode = { name: "Visual Studio Code", assets: { large_image: svg, small_image: svg } };
		activities.set({}, vscode);
		activities.set({}, { name: "Spotify", type: 2 });
		await settle();
		expect(activities.activities()).toEqual([vscode, { name: "Spotify", type: 2 }]);
		expect(calls.fetched).toEqual([]);
	});

	test("shows a client that keeps changing its image each time, and makes only its newest image", async () => {
		const { cache, calls, release } = images({ held: true });
		const activities = new IpcActivities(cache, () => {});
		const client = {};
		const song = (n: number) => ({
			type: 2,
			name: "Aurora Music",
			details: `Song ${n}`,
			assets: { large_image: `https://x.test/${n}.jpg` },
		});
		for (const n of [1, 2, 3]) {
			activities.set(client, song(n));
			await settle();
			expect(activities.activities()).toEqual([{ ...song(n), assets: {} }]);
		}
		expect(calls.aborted).toEqual(["https://x.test/1.jpg", "https://x.test/2.jpg"]);
		release("https://x.test/3.jpg");
		await settle();
		expect(activities.activities()).toEqual([{ ...song(3), assets: { large_image: INLINE } }]);
	});

	test("keeps making the images an activity sent again names, and shows them with the newest one", async () => {
		const { cache, calls, release } = images({ held: true });
		const activities = new IpcActivities(cache, () => {});
		const client = {};
		activities.set(client, lol("Champ select"));
		activities.set(client, lol("In game"));
		await settle();
		expect(calls.fetched).toEqual(["https://x.test/lol.png"]);
		expect(calls.aborted).toEqual([]);
		release("https://x.test/lol.png");
		await settle();
		expect(activities.activities()).toEqual([
			{ ...lol("In game"), assets: { large_image: INLINE, large_text: "LoL" } },
		]);
	});

	test("never brings back an activity the app replaced or cleared while its image was fetched", async () => {
		const { cache, calls, release } = images({ held: true });
		const activities = new IpcActivities(cache, () => {});
		const replaced = {};
		activities.set(replaced, { name: "Song one", assets: { large_image: "https://x.test/one.jpg" } });
		const cleared = {};
		activities.set(cleared, { name: "Game", assets: { large_image: "https://x.test/game.png" } });
		await settle();
		activities.set(replaced, { name: "Song two" });
		activities.clear(cleared);
		release("https://x.test/one.jpg");
		release("https://x.test/game.png");
		await settle();
		expect(activities.activities()).toEqual([{ name: "Song two" }]);
		expect(calls.aborted).toEqual(["https://x.test/one.jpg", "https://x.test/game.png"]);
		activities.set(replaced, null); // nothing fitActivity can show
		expect(activities.activities()).toEqual([]);
	});

	test("keeps an activity shown when its images fail to be made", async () => {
		const failing: Images = {
			known: () => undefined,
			inline: () => Promise.reject(new Error("the webview went away")),
		};
		const activities = new IpcActivities(failing, () => {});
		activities.set({}, lol());
		await settle();
		expect(activities.activities()).toEqual([{ ...lol(), assets: { large_text: "LoL" } }]);
	});

	test("keeps each client's place, in the order their activities first came", async () => {
		const { cache } = images();
		const activities = new IpcActivities(cache, () => {});
		const [first, second] = [{}, {}];
		activities.set(first, { name: "A" });
		activities.set(second, { name: "B" });
		await settle();
		activities.set(first, { name: "A again" });
		await settle();
		expect(activities.activities().map((a) => a.name)).toEqual(["A again", "B"]);
	});
});

describe("within", () => {
	test("gives what comes in time, and gives up on what doesn't: a page that never loads holds no image's place", async () => {
		expect(await within(Promise.resolve("loaded"), 50)).toBe("loaded");
		const started = Date.now();
		expect(await within(new Promise(() => {}), 50).catch((err: Error) => err.message)).toBe("nothing came in 50 ms");
		expect(Date.now() - started).toBeLessThan(5_000);
	});
});
