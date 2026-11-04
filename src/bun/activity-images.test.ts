import { afterAll, describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import {
	ActivityImages,
	fetchImageBytes,
	IpcActivities,
	MAX_SOURCE_BYTES,
	RETRY_FAILED_MS,
	withInlineImages,
} from "./activity-images";

// A host to fetch images from, on loopback only.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
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
				return new Response(gzipSync(PNG), { headers: { "content-type": "image/png", "content-encoding": "gzip" } });
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
		expect(await fetchImageBytes(at("/hangs"), 200)).toBeNull();
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	test("reads no more than 4 MiB, whatever the host says the size is", async () => {
		// Given up on as soon as the answer says its length, long before its 60 s.
		const said = fetchImageBytes(`http://127.0.0.1:${liar.port}/big.png`, 60_000);
		const waited = new Promise((resolve) => setTimeout(() => resolve("still waiting"), 3_000));
		expect(await Promise.race([said, waited])).toBeNull();
		expect(bigAnswers).toBe(1);
		expect(await fetchImageBytes(at("/too-big"))).toBeNull();
		expect((await fetchImageBytes(at("/just-fits")))?.length).toBe(MAX_SOURCE_BYTES);
	});
});

// An inline image as the webview makes one, and a fetch and a webview that count their calls.
const INLINE = "data:image/jpeg;base64,/9j/4AAQ";
function images(options: { fetch?: (url: string) => Uint8Array | null; thumbnail?: () => string | null } = {}) {
	const calls = { fetched: [] as string[], made: 0 };
	let now = 1_000_000;
	const cache = new ActivityImages(
		async () => {
			calls.made++;
			return options.thumbnail ? options.thumbnail() : INLINE;
		},
		async (url) => {
			calls.fetched.push(url);
			return options.fetch ? options.fetch(url) : PNG;
		},
		() => now,
	);
	return { cache, calls, later: (ms: number) => (now += ms) };
}

describe("ActivityImages", () => {
	test("fetches and makes a URL's image once: the activity's resends and a song that comes back fetch nothing", async () => {
		const { cache, calls } = images();
		expect(await cache.inline("https://i.scdn.co/image/a")).toBe(INLINE);
		expect(await cache.inline("https://i.scdn.co/image/b")).toBe(INLINE);
		expect(await cache.inline("https://i.scdn.co/image/a")).toBe(INLINE);
		expect(calls.fetched).toEqual(["https://i.scdn.co/image/a", "https://i.scdn.co/image/b"]);
		expect(calls.made).toBe(2);
	});

	test("shares an image being made with the activities that name it meanwhile", async () => {
		const { cache, calls } = images();
		const both = await Promise.all([cache.inline("https://x.test/a.png"), cache.inline("https://x.test/a.png")]);
		expect(both).toEqual([INLINE, INLINE]);
		expect(calls.fetched.length).toBe(1);
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

	test("keeps no image that isn't an inline one of 8 KiB at most", async () => {
		for (const answer of [`data:image/png;base64,${"A".repeat(8 << 10)}`, "https://x.test/a.png", "data:text/html,x"]) {
			const { cache } = images({ thumbnail: () => answer });
			expect(await cache.inline("https://x.test/a.png")).toBeUndefined();
		}
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

describe("withInlineImages", () => {
	const activity = {
		type: 2,
		name: "Aurora Music",
		details: "Song",
		state: "Artist",
		timestamps: { start: 1 },
		assets: { large_image: "https://i.ytimg.com/vi/x/hqdefault.jpg", large_text: "Album" },
	};

	test("sends an image by URL inline, and the rest of the activity as it was", async () => {
		const { cache } = images();
		expect(await withInlineImages(activity, cache)).toEqual({
			...activity,
			assets: { large_image: INLINE, large_text: "Album" },
		});
	});

	test("leaves out an image that can't be made inline, never sending its URL", async () => {
		const { cache } = images({ fetch: () => null });
		const sent = await withInlineImages(
			{ ...activity, assets: { ...activity.assets, small_image: "HTTPS://x.test/badge.png" } },
			cache,
		);
		expect(sent.assets).toEqual({ large_text: "Album" });
		expect(JSON.stringify(sent)).not.toContain("http");
	});

	test("keeps an inline image as it is, and fetches nothing for it", async () => {
		const { cache, calls } = images();
		const svg = "data:image/svg+xml;base64,PHN2Zy8+";
		const vscode = { name: "Visual Studio Code", assets: { large_image: svg, small_image: svg } };
		expect(await withInlineImages(vscode, cache)).toEqual(vscode);
		expect(await withInlineImages({ name: "Spotify", type: 2 }, cache)).toEqual({ name: "Spotify", type: 2 });
		expect(calls.fetched).toEqual([]);
	});
});

describe("IpcActivities", () => {
	// Images that come when a test lets them, by URL.
	function slowImages() {
		const waiting = new Map<string, (image: string | undefined) => void>();
		const later = {
			inline: (url: string) => new Promise<string | undefined>((resolve) => waiting.set(url, resolve)),
		};
		return { later, deliver: (url: string, image = INLINE) => waiting.get(url)?.(image) };
	}
	const settle = () => Bun.sleep(0);

	test("shows an activity once its images are inline", async () => {
		const { later, deliver } = slowImages();
		let changes = 0;
		const activities = new IpcActivities(later, () => changes++);
		const client = {};
		activities.set(client, { name: "League of Legends", assets: { large_image: "https://x.test/lol.png" } });
		await settle();
		expect(activities.activities()).toEqual([]);
		deliver("https://x.test/lol.png");
		await settle();
		expect(activities.activities()).toEqual([{ name: "League of Legends", assets: { large_image: INLINE } }]);
		expect(changes).toBe(1);
	});

	test("never brings back an activity the app replaced or cleared while its image was fetched", async () => {
		const { later, deliver } = slowImages();
		const activities = new IpcActivities(later, () => {});
		const replaced = {};
		activities.set(replaced, { name: "Song one", assets: { large_image: "https://x.test/one.jpg" } });
		activities.set(replaced, { name: "Song two" });
		const cleared = {};
		activities.set(cleared, { name: "Game", assets: { large_image: "https://x.test/game.png" } });
		activities.clear(cleared);
		deliver("https://x.test/one.jpg");
		deliver("https://x.test/game.png");
		await settle();
		expect(activities.activities()).toEqual([{ name: "Song two" }]);
		activities.set(replaced, null); // nothing fitActivity can show
		expect(activities.activities()).toEqual([]);
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
