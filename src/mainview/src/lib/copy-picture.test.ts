import { describe, expect, test } from "bun:test";
import { copyPicture, isPng, type PictureCopier } from "./copy-picture";

// A PNG's signature with its header's first bytes, and a JPEG's start: enough for the copy to tell them apart.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const MADE = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: "image/png" });

// A clipboard item as the copy makes one: its parts, by type.
type Item = Record<string, Promise<Blob>>;

// What a copy did: the items it wrote, as the clipboard's write takes them (reading every promised blob, as a webview
// does), and what it asked the webview to make a PNG of.
function copier(fetched: Promise<Uint8Array | null>, made: Blob | null = MADE) {
	const done = { written: [] as Item[], madeOf: [] as Uint8Array[], blobs: [] as Blob[] };
	const deps: PictureCopier<Item> = {
		fetch: () => fetched,
		toPng: async (bytes) => {
			done.madeOf.push(bytes);
			return made;
		},
		item: (parts) => parts,
		write: async (items) => {
			for (const item of items) {
				done.written.push(item);
				for (const blob of Object.values(item)) done.blobs.push(await blob);
			}
		},
	};
	return { deps, done };
}

describe("Copy image (#450)", () => {
	test("writes the picture through the webview's clipboard as an image/png item, made before the picture comes", async () => {
		let arrive!: (bytes: Uint8Array) => void;
		const { deps, done } = copier(new Promise((resolve) => (arrive = resolve)));
		const copying = copyPicture("https://api.example/a.png", deps);
		// The item is written at once, in the user's gesture, with the picture still on its way (WebKit's rule).
		expect(done.written.map((item) => Object.keys(item))).toEqual([["image/png"]]);
		arrive(PNG);
		expect(await copying).toBe(true);
		expect(new Uint8Array(await done.blobs[0]!.arrayBuffer())).toEqual(PNG);
		expect(done.blobs[0]!.type).toBe("image/png");
		expect(done.madeOf).toEqual([]);
	});

	test("a picture that isn't a PNG goes as the PNG the webview makes of it", async () => {
		const { deps, done } = copier(Promise.resolve(JPEG));
		expect(await copyPicture("https://api.example/a.jpg", deps)).toBe(true);
		expect(done.madeOf).toEqual([JPEG]);
		expect(done.blobs).toEqual([MADE]);
	});

	test("nothing is copied for a picture Bun couldn't get, or one the webview can't make a PNG of", async () => {
		for (const { fetched, made } of [
			{ fetched: Promise.resolve(null), made: MADE },
			{ fetched: Promise.resolve(JPEG), made: null },
			{ fetched: Promise.reject(new Error("no answer")), made: MADE },
		]) {
			const { deps, done } = copier(fetched, made);
			expect(await copyPicture("https://api.example/x", deps)).toBe(false);
			expect(done.blobs).toEqual([]);
		}
	});

	test("a copy the clipboard refuses says so", async () => {
		const { deps } = copier(Promise.resolve(PNG));
		deps.write = async () => {
			throw new DOMException("Document is not focused.", "NotAllowedError");
		};
		expect(await copyPicture("https://api.example/a.png", deps)).toBe(false);
	});

	test("a PNG is told by its signature", () => {
		expect(isPng(PNG)).toBe(true);
		expect(isPng(JPEG)).toBe(false);
		expect(isPng(new Uint8Array())).toBe(false);
	});
});
