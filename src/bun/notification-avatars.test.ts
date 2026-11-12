import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityImages } from "./activity-images";
import { avatarFile, avatarForToast } from "./notification-avatars";

const dir = await mkdtemp(join(tmpdir(), "duvet-avatars-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

// What the webview's canvas hands back for a photo (activityImage): a small PNG or JPEG as a data URI.
const PNG = `data:image/png;base64,${Buffer.from("small png").toString("base64")}`;

// A PNG's header, which says its size whatever its bytes: a file of a few KB can say 16000 px a side.
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const png = (side: number) =>
	new Uint8Array([
		...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
		...be32(13),
		...ascii("IHDR"),
		...be32(side),
		...be32(side),
		...[8, 6, 0, 0, 0],
	]);

// The photos made small as the IPC apps' images are (activity-images.ts), with the fetch and the webview given.
function madeBy(fetch: (url: string) => Promise<Uint8Array | null>, thumbnail: (bytes: Uint8Array) => Promise<string>) {
	const images = new ActivityImages(thumbnail, fetch);
	return { dir, inline: (url: string) => images.inline(url) };
}

describe("an author's photo for a toast", () => {
	test("is fetched once per URL, then read from its file", async () => {
		const fetched: string[] = [];
		const fetch = async (url: string) => {
			fetched.push(url);
			return png(64);
		};
		const first = await avatarFile(
			"https://api.test/attachments/a",
			madeBy(fetch, async () => PNG),
		);
		// Another start of the app: nothing made in memory, the file on disk.
		const second = await avatarFile(
			"https://api.test/attachments/a",
			madeBy(fetch, async () => PNG),
		);
		expect(second).toBe(first);
		expect(first?.endsWith(".png")).toBe(true);
		expect(await Bun.file(first ?? "").text()).toBe("small png");
		expect(fetched).toEqual(["https://api.test/attachments/a"]);
	});

	test("is none when the photo can't be made, or isn't a PNG or JPEG", async () => {
		expect(await avatarFile("https://api.test/attachments/b", { dir, inline: async () => undefined })).toBeNull();
		const webp = async () => "data:image/webp;base64,AAAA";
		expect(await avatarFile("https://api.test/attachments/c", { dir, inline: webp })).toBeNull();
	});

	// The webview decodes what it's given whole: 16000 px a side is about a gigabyte, per toast.
	test("a photo too big to decode never reaches the webview", async () => {
		const made: Uint8Array[] = [];
		const sources = madeBy(
			async () => png(16_000),
			async (photo) => {
				made.push(photo);
				return PNG;
			},
		);
		expect(await avatarFile("https://api.test/attachments/huge", sources)).toBeNull();
		expect(made).toEqual([]);
	});

	test("one that couldn't be had isn't fetched again for a while", async () => {
		let fetches = 0;
		const sources = madeBy(
			async () => {
				fetches++;
				return null;
			},
			async () => PNG,
		);
		expect(await avatarFile("https://api.test/attachments/gone", sources)).toBeNull();
		expect(await avatarFile("https://api.test/attachments/gone", sources)).toBeNull();
		expect(fetches).toBe(1);
	});

	test("a burst of toasts makes two photos at a time", async () => {
		let making = 0;
		let most = 0;
		const sources = madeBy(
			async () => png(64),
			async () => {
				most = Math.max(most, ++making);
				await Bun.sleep(5);
				making--;
				return PNG;
			},
		);
		const urls = Array.from({ length: 10 }, (_, i) => `https://api.test/attachments/burst-${i}`);
		await Promise.all(urls.map((url) => avatarFile(url, sources)));
		expect(most).toBe(2);
	});

	// The sound plays as the message comes: a toast that waited 10 s for a slow photo came long after it.
	test("a toast waits for a photo a moment at most, and the next one has it", async () => {
		let arrive!: () => void;
		const arrived = new Promise<void>((resolve) => (arrive = resolve));
		const sources = {
			dir,
			inline: async () => {
				await arrived;
				return PNG;
			},
		};
		expect(await avatarForToast("https://api.test/attachments/slow", sources, 20)).toBeNull();
		arrive();
		expect(await avatarForToast("https://api.test/attachments/slow", sources, 1000)).toEndWith(".png");
	});

	test("keeps the newest 200 files", async () => {
		const own = await mkdtemp(join(tmpdir(), "duvet-avatars-"));
		for (let i = 0; i < 200; i++) {
			const path = join(own, `old-${i}.png`);
			await writeFile(path, "x");
			await utimes(path, 1000 + i, 1000 + i);
		}
		await avatarFile("https://api.test/attachments/new", { dir: own, inline: async () => PNG });
		const names = await readdir(own);
		expect(names).toHaveLength(200);
		expect(names).not.toContain("old-0.png");
		expect(names).toContain("old-1.png");
		await rm(own, { recursive: true, force: true });
	});
});
