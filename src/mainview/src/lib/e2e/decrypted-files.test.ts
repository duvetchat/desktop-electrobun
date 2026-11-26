import { describe, expect, test } from "bun:test";
import { bytesBase64 } from "$lib/staged-images";
import {
	DecryptedFiles,
	downloadable,
	MAX_DECRYPTED,
	OPENING_BYTES_MOST,
	OPENING_MOST,
	type FileState,
	type Opener,
} from "./decrypted-files.svelte";
import { sealedSize, type SealedFile, type ShownFile } from "./engine/files";
import { CoreError } from "./errors";

// The files of conversations this device opened (PLAN-E2E-CLIENTES.md, «Adjuntos»): in memory alone, 256 MiB of them
// at most, each URL revoked as its file goes, past the cap or with its message's deletion; a video whole before it
// plays. The core and the API stand aside here: the opener hands back what a file opens to.

const until = async (holds: () => boolean) => {
	for (let i = 0; i < 200 && !holds(); i++) await Bun.sleep(5);
	expect(holds()).toBe(true);
};
const sha256 = async (bytes: Uint8Array) =>
	bytesBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));

/** A cache whose URLs are names it counts, and what it revoked; and the plain bytes its opener gives by file. */
function cache(limit?: number, inFlight?: number) {
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
		inFlight,
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
		expect(files.state(one)).toEqual({ status: "gone" });
		expect(files.state(two)).toMatchObject({ status: "ready", url: made[1] });
		// It isn't fetched again by itself, as the view that asked for it may still show it: a click does.
		await files.open(one, "m1", { auto: true });
		expect(files.state(one)).toEqual({ status: "gone" });
		// Its message deleted, a file goes at once, its URL with it.
		files.forgetMessage("m1");
		expect(revoked).toEqual([made[0]!, made[1]!]);
		expect(files.state(two)).toBeUndefined();
		expect(files.state(one)).toBeUndefined();
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
					seen.push(files.state(video));
				}
				return new Uint8Array(most);
			},
			open: async (_key, _id, sealed, progress) => {
				expect(sealed.size).toBe(sealedSize(300_000));
				progress?.(300_000);
				seen.push(files.state(video));
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

	// Task 18's review, I1: any member can write another's file ID in an envelope.
	test("two messages naming one ID never show or block each other's file", async () => {
		const { files, fileOf, revoked } = cache();
		const real = await fileOf("x", 100);
		// Another message names its ID with other bytes: the API lists the file on its own message alone, so for this one
		// it's unavailable, and that says nothing of the first's.
		const named = { ...real, key: "b3RoZXI=", sha256: await sha256(new Uint8Array(100).fill(1)), url: null };
		expect(await files.open(named, "m2")).toEqual({ status: "failed", reason: "unavailable" });
		expect(await files.open(real, "m1", { auto: true })).toMatchObject({ status: "ready" });
		// Even with a URL, other bytes fail on their own, and the real file stays as it is.
		const forged = { ...named, url: real.url };
		expect(await files.open(forged, "m2")).toEqual({ status: "failed", reason: "hash" });
		expect(files.state(real)).toMatchObject({ status: "ready" });
		expect(files.state(forged)).toEqual({ status: "failed", reason: "hash" });
		expect(files.state(named)).toEqual({ status: "failed", reason: "unavailable" });
		// The other message's deletion takes nothing of the first's.
		files.forgetMessage("m2");
		expect(revoked).toEqual([]);
		expect(files.state(real)).toMatchObject({ status: "ready" });
	});

	// Task 18's review, I4: only a hash, size or open failure is final.
	test("a download that fails is asked again on a click, and only what its bytes are is final", async () => {
		const { files, fileOf } = cache();
		const file = await fileOf("d", 100);
		let downloads = 0;
		let lost = true;
		const working: Opener = {
			download: async (_url, most) => {
				downloads++;
				if (lost) throw new TypeError("fetch failed");
				return new Uint8Array(most);
			},
			open: async () =>
				new Blob([
					new Uint8Array(100).map((_, i) => (i < 8 ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][i]! : 0)),
				]),
		};
		files.useOpener(working);
		expect(await files.open(file, "m", { auto: true })).toEqual({ status: "failed", reason: "download" });
		// A view's own ask doesn't fetch it again; a click does.
		expect(await files.open(file, "m", { auto: true })).toEqual({ status: "failed", reason: "download" });
		expect(downloads).toBe(1);
		lost = false;
		expect(await files.open(file, "m")).toMatchObject({ status: "ready" });
		expect(downloads).toBe(2);
		// Other bytes than its message says: final, a click changes nothing.
		const lied = { ...file, id: "e", sha256: await sha256(new Uint8Array(100).fill(7)) };
		expect(await files.open(lied, "m")).toEqual({ status: "failed", reason: "hash" });
		expect(await files.open(lied, "m")).toEqual({ status: "failed", reason: "hash" });
		expect(downloads).toBe(3);
		// The core's refusal is final; an open that didn't reach it (no engine now) isn't.
		const refused = { ...file, id: "f" };
		files.useOpener({ ...working, open: async () => Promise.reject(new CoreError("decrypt_failed")) });
		expect(await files.open(refused, "m")).toEqual({ status: "failed", reason: "open" });
		expect(await files.open(refused, "m")).toEqual({ status: "failed", reason: "open" });
		const unready = { ...file, id: "g" };
		files.useOpener({ ...working, open: async () => Promise.reject(new CoreError("not_ready")) });
		expect(await files.open(unready, "m")).toEqual({ status: "failed", reason: "download" });
		files.useOpener({ ...working, open: async () => Promise.reject(new Error("the tab that leads closed")) });
		expect(await files.open(unready, "m")).toEqual({ status: "failed", reason: "download" });
		files.useOpener(working);
		expect(await files.open(unready, "m")).toMatchObject({ status: "ready" });
	});

	// Task 18's review, I5: each file holds its sealed bytes about three times over while it comes down.
	test("four files come down at once, a click's first", async () => {
		const { files, fileOf, opener } = cache();
		const started: string[] = [];
		const gates = new Map<string, () => void>();
		files.useOpener({
			...opener,
			download: (url, most) => {
				started.push(url);
				return new Promise((done) => gates.set(url, () => done(new Uint8Array(most))));
			},
		});
		const all = await Promise.all(["1", "2", "3", "4", "5", "6"].map((id) => fileOf(id, 100)));
		const opening = all.map((file) => files.open(file, "m", { auto: true }));
		expect(OPENING_MOST).toBe(4);
		expect(started).toEqual(all.slice(0, 4).map((file) => file.url ?? ""));
		// A click on the last: it goes before the fifth, a view's own ask.
		const clicked = files.open(all[5]!, "m");
		gates.get(all[0]!.url!)!();
		await until(() => started.length === 5);
		expect(started[4]).toBe(all[5]!.url ?? "");
		for (const file of all) gates.get(file.url!)?.();
		await until(() => started.length === 6);
		gates.get(all[4]!.url!)!();
		expect((await Promise.all([...opening, clicked])).every((state) => state.status === "ready")).toBe(true);
	});

	// Step 5's review, M5 (desktop-electrobun#544): four of a bucket's large files came down and opened at once, each
	// held several times over meanwhile. The Android app holds them to 64 MiB of sealed bytes.
	test("files in flight are held to a budget of sealed bytes, and one past it comes down alone", async () => {
		expect(OPENING_BYTES_MOST).toBe(64 << 20);
		const { files, fileOf, opener } = cache(undefined, 1000);
		const started: string[] = [];
		const gates = new Map<string, () => void>();
		files.useOpener({
			...opener,
			download: (url, most) => {
				started.push(url);
				return new Promise((done) => gates.set(url, () => done(new Uint8Array(most))));
			},
		});
		// Three files of 416 sealed bytes, and one past the budget, though places are free for all four.
		const small = await Promise.all(["1", "2", "3"].map((id) => fileOf(id, 400)));
		const large = await fileOf("4", 5000);
		const all = [...small, large];
		const opening = all.map((file) => files.open(file, "m", { auto: true }));
		const urlOf = (at: number) => all[at]!.url ?? "";
		expect(sealedSize(400)).toBe(416);
		expect(started).toEqual([urlOf(0), urlOf(1)]);
		// One done, the third fits; the large one waits its turn, behind it, until nothing else is in flight.
		gates.get(urlOf(0))!();
		await until(() => started.length === 3);
		expect(started[2]).toBe(urlOf(2));
		gates.get(urlOf(1))!();
		await Bun.sleep(20);
		expect(started).toHaveLength(3);
		gates.get(urlOf(2))!();
		await until(() => started.length === 4);
		expect(started[3]).toBe(urlOf(3));
		gates.get(urlOf(3))!();
		expect((await Promise.all(opening)).every((state) => state.status === "ready")).toBe(true);
	});

	// Task 18's review, Missing 2: decision 40 counts them, under the kind attachment.
	test("a file that doesn't open, or opens to other bytes, is counted; one that doesn't come down isn't", async () => {
		const { files, fileOf, opener } = cache();
		let counted = 0;
		files.useOpener({ ...opener, failed: () => counted++ });
		const file = await fileOf("c", 100);
		await files.open({ ...file, sha256: await sha256(new Uint8Array(100).fill(9)) }, "m");
		expect(counted).toBe(1);
		files.useOpener({
			...opener,
			failed: () => counted++,
			open: async () => Promise.reject(new CoreError("decrypt_failed")),
		});
		await files.open({ ...file, id: "o" }, "m");
		expect(counted).toBe(2);
		files.useOpener({
			...opener,
			failed: () => counted++,
			download: async () => Promise.reject(new TypeError("offline")),
		});
		await files.open({ ...file, id: "n" }, "m");
		await files.open({ ...file, id: "s", size: 40 << 20 }, "m");
		await files.open({ ...file, id: "u", url: null }, "m");
		expect(counted).toBe(2);
	});

	// Task 18's re-review, N3: a fast scroll queues every file it passes.
	test("a file waiting for its place goes from the queue with its message's deletion", async () => {
		const { files, fileOf, opener } = cache();
		const started: string[] = [];
		const gates: (() => void)[] = [];
		files.useOpener({
			...opener,
			download: (url, most) => {
				started.push(url);
				return new Promise((done) => gates.push(() => done(new Uint8Array(most))));
			},
		});
		const all = await Promise.all(["1", "2", "3", "4", "5"].map((id) => fileOf(id, 100)));
		const opening = all.map((file, at) => files.open(file, `m${at}`, { auto: true }));
		files.forgetMessage("m4");
		for (const go of gates.splice(0)) go();
		await Promise.all(opening.slice(0, 4));
		// A place freed: what waited would start at once.
		await Bun.sleep(20);
		expect(started).toEqual(all.slice(0, 4).map((file) => file.url ?? ""));
		expect(files.state(all[4]!)).toBeUndefined();
	});

	test("a file waiting for its place goes from the queue once no view asks for it", async () => {
		const { files, fileOf, opener } = cache();
		const started: string[] = [];
		const gates: (() => void)[] = [];
		files.useOpener({
			...opener,
			download: (url, most) => {
				started.push(url);
				return new Promise((done) => gates.push(() => done(new Uint8Array(most))));
			},
		});
		const all = await Promise.all(["1", "2", "3", "4", "5", "6"].map((id) => fileOf(id, 100)));
		const opening = all.map((file) => files.open(file, "m", { auto: true }));
		// Two views asked for the sixth; one goes. The fifth's only view scrolled away.
		void files.open(all[5]!, "m", { auto: true });
		files.letGo(all[5]!);
		files.letGo(all[4]!);
		for (const go of gates.splice(0)) go();
		await Promise.all(opening.slice(0, 4));
		await until(() => started.length === 5);
		expect(started).toEqual([...all.slice(0, 4), all[5]!].map((file) => file.url ?? ""));
		expect(files.state(all[4]!)).toBeUndefined();
	});

	// Task 18's re-review, N4: two messages naming one file with its key share its place.
	test("a file asked for again keeps every message that asked for it", async () => {
		const { files, fileOf, opener, revoked } = cache();
		const file = await fileOf("s", 100);
		let lost = true;
		files.useOpener({
			...opener,
			download: async (url, most, progress) => {
				if (lost) throw new TypeError("fetch failed");
				return opener.download(url, most, progress);
			},
		});
		expect(await files.open(file, "m1", { auto: true })).toEqual({ status: "failed", reason: "download" });
		await files.open(file, "m2", { auto: true });
		lost = false;
		expect(await files.open(file, "m1")).toMatchObject({ status: "ready" });
		// The first message's deletion leaves the file the second still draws.
		files.forgetMessage("m1");
		expect(revoked).toEqual([]);
		expect(files.state(file)).toMatchObject({ status: "ready" });
		files.forgetMessage("m2");
		expect(revoked).toHaveLength(1);
	});
});
