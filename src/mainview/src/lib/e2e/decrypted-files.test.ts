import { describe, expect, test } from "bun:test";
import { bytesBase64 } from "$lib/staged-images";
import { DecryptedFiles, downloadable, MAX_DECRYPTED, type FileState, type Opener } from "./decrypted-files.svelte";
import { sealedSize, type SealedFile, type ShownFile } from "./engine/files";

// The files of conversations this device opened (PLAN-E2E-CLIENTES.md, «Adjuntos»): in memory alone, 256 MiB of them
// at most, each URL revoked as its file goes, past the cap or with its message's deletion; a video whole before it
// plays. The core and the API stand aside here: the opener hands back what a file opens to.

const sha256 = async (bytes: Uint8Array) =>
	bytesBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));

/** A cache whose URLs are names it counts, and what it revoked; and the plain bytes its opener gives by file. */
function cache(limit?: number) {
	const made: string[] = [];
	const revoked: string[] = [];
	const files = new DecryptedFiles(
		limit,
		() => {
			const url = `blob:test/${made.length}`;
			made.push(url);
			return url;
		},
		(url) => revoked.push(url),
	);
	const plain = new Map<string, Uint8Array>();
	const opener: Opener = {
		download: async (_url, most) => new Uint8Array(most),
		open: async (_key, id) => new Blob([new Uint8Array(plain.get(id)!)]),
	};
	files.useOpener(opener);
	/** A file of `size` bytes, its first ones a PNG's. */
	const fileOf = async (id: string, size: number, head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) => {
		const bytes = new Uint8Array(size);
		bytes.set(head);
		plain.set(id, bytes);
		const file: ShownFile = {
			id,
			key: "a2V5",
			sha256: await sha256(bytes),
			name: `${id}.png`,
			said: "image/png",
			size,
		};
		const sealed: SealedFile = { ...file, url: `/attachments/${id}?sig=test` };
		return sealed;
	};
	return { files, made, revoked, fileOf, opener };
}

describe("decrypted files in memory", () => {
	test("decrypted files leave memory past the cap, and with their message's deletion", async () => {
		expect(MAX_DECRYPTED).toBe(256 << 20);
		const { files, made, revoked, fileOf } = cache(1000);
		const [one, two, three] = [await fileOf("1", 400), await fileOf("2", 400), await fileOf("3", 400)];
		await files.open(one, "m1");
		await files.open(two, "m1");
		expect(files.used).toBe(800);
		// A third past the cap: the file drawn longest ago goes, its URL revoked.
		await files.open(three, "m2");
		expect(files.used).toBe(800);
		expect(revoked).toEqual([made[0]!]);
		expect(files.state("1")).toEqual({ status: "gone" });
		expect(files.state("2")).toMatchObject({ status: "ready", url: made[1] });
		// It isn't fetched again by itself, as the view that asked for it may still show it: a click does.
		await files.open(one, "m1", { auto: true });
		expect(files.state("1")).toEqual({ status: "gone" });
		// Its message deleted, a file goes at once, its URL with it.
		files.forgetMessage("m1");
		expect(revoked).toEqual([made[0]!, made[1]!]);
		expect(files.state("2")).toBeUndefined();
		expect(files.state("1")).toBeUndefined();
		expect(files.used).toBe(400);
		expect(files.blobOf(made[2]!)?.size).toBe(400);
		expect(files.blobOf(made[1]!)).toBeNull();
		// Every one goes as the engine stops: nothing decrypted stays.
		files.useOpener(null);
		expect(revoked).toEqual([made[0]!, made[1]!, made[2]!]);
		expect(files.used).toBe(0);
	});

	test("a video is downloaded whole, with its progress, before it plays", async () => {
		const { files, fileOf } = cache();
		const mp4 = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];
		const video = await fileOf("v", 300_000, mp4);
		const seen: (FileState | undefined)[] = [];
		const opener: Opener = {
			download: async (_url, most, progress) => {
				for (const share of [0.25, 0.5, 0.75, 1]) {
					progress?.(Math.floor(most * share));
					seen.push(files.state("v"));
				}
				return new Uint8Array(most);
			},
			open: async (_key, _id, sealed, progress) => {
				expect(sealed.size).toBe(sealedSize(300_000));
				progress?.(300_000);
				seen.push(files.state("v"));
				return new Blob([new Uint8Array(300_000).fill(0).map((_, i) => (i < mp4.length ? mp4[i]! : 0))]);
			},
		};
		files.useOpener(opener);
		const done = await files.open(video, "m", { auto: false });
		// While it came, and while the core opened it, it was loading, and further along each time; playable only after.
		expect(seen.every((state) => state?.status === "loading")).toBe(true);
		const shares = seen.map((state) => (state?.status === "loading" ? state.progress : -1));
		expect(shares).toEqual([...shares].sort((a, b) => a - b));
		expect(shares.every((share) => share > 0 && share <= 1)).toBe(true);
		expect(done).toMatchObject({ status: "ready", type: "video/mp4" });
		expect(done.status === "ready" && done.blob.size).toBe(300_000);
	});

	test("a file that doesn't open, or whose bytes differ, is a failure kept with its reason", async () => {
		const { files, fileOf } = cache();
		const file = await fileOf("x", 100);
		const lied = { ...file, sha256: await sha256(new Uint8Array(100).fill(7)) };
		expect(await files.open(lied, "m")).toEqual({ status: "failed", reason: "hash" });
		expect(files.blobOf("blob:test/0")).toBeNull();
		const nowhere = { ...file, id: "y", url: null };
		expect(await files.open(nowhere, "m")).toEqual({ status: "failed", reason: "unavailable" });
	});

	test("a file saved from here downloads, typed as bytes to save and never as what they are", () => {
		const page = new Blob(["<script>1</script>"], { type: "text/html" });
		expect(downloadable(page).type).toBe("application/octet-stream");
		expect(downloadable(page).size).toBe(page.size);
	});
});
