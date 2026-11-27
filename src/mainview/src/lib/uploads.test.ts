import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { get } from "svelte/store";
import type { UploadOptions } from "$lib/api/api";
import {
	allUp,
	CANCELLED,
	cancelUpload,
	chatFileSize,
	fileGoingUp,
	fileShare,
	forgetUnlisted,
	messageUploadNote,
	messageUploads,
	sendFollowed,
	uploadNote,
	uploadPercent,
	withoutSending,
} from "$lib/uploads";

// A file's size under it in the chat, and in the message box: the app's sizes (lib/i18n/format.ts), and megabytes with
// one decimal, as the chat has always written them.
describe("a file's size in the chat", () => {
	test("is bytes, then kilobytes and megabytes with one decimal", () => {
		expect(chatFileSize(500)).toBe("500 B");
		expect(chatFileSize(1536)).toBe("1.5 KB");
		expect(chatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
		expect(chatFileSize(1500 * 1024 * 1024)).toBe("1500.0 MB");
	});
});

// What an image's Save or Upload says while it goes up (#78), as the mobile app says it.
describe("an upload's percent", () => {
	test("is rounded down, so it says 100 only once every byte is up", () => {
		expect(uploadPercent(0, 1000)).toBe(0);
		expect(uploadPercent(420, 1000)).toBe(42);
		expect(uploadPercent(999, 1000)).toBe(99);
		expect(uploadPercent(99_999, 100_000)).toBe(99);
		expect(uploadPercent(1000, 1000)).toBe(100);
	});

	test("is 0 while the total isn't known, and never past 100", () => {
		expect(uploadPercent(10, 0)).toBe(0);
		expect(uploadPercent(1200, 1000)).toBe(100);
	});

	test("reads as the mobile app's: Uploading · 42%", () => {
		expect(uploadNote(42)).toBe("Uploading · 42%");
		expect(uploadNote(uploadPercent(1000, 1000))).toBe("Uploading · 100%");
	});
});

// A message's files went up saying only "Uploading…", with no way to stop them (#61). Their upload now shows on the
// message being sent, as the mobile app shows it, and Cancel stops it while its bytes go up.
describe("a message's upload", () => {
	test("is all up only once its total is known and every byte of it is sent", () => {
		expect(allUp(0, 0)).toBe(false);
		expect(allUp(999, 1000)).toBe(false);
		expect(allUp(1000, 1000)).toBe(true);
	});

	test("fills its files' bars one after another, each by its size, an empty one too", () => {
		const sizes = [100, 0, 300];
		const shares = (sent: number) => sizes.map((_, i) => fileShare(sizes, i, sent, 401));
		expect(shares(0)).toEqual([0, 0, 0]);
		expect(shares(50)).toEqual([0.5, 0, 0]);
		expect(shares(101)).toEqual([1, 1, 0]);
		expect(shares(251)).toEqual([1, 1, 0.5]);
		expect(shares(401)).toEqual([1, 1, 1]);
		// Its total unknown yet: nothing has gone.
		expect(fileShare(sizes, 0, 50, 0)).toBe(0);
	});

	test("says which file goes up and how far all of them are, as the mobile app does", () => {
		expect(messageUploadNote([1000], 420, 1000)).toBe("Uploading · 42%");
		expect(messageUploadNote([100, 100, 200], 0, 400)).toBe("Uploading 1 of 3 · 0%");
		expect(messageUploadNote([100, 100, 200], 50, 400)).toBe("Uploading 1 of 3 · 12%");
		expect(messageUploadNote([100, 100, 200], 150, 400)).toBe("Uploading 2 of 3 · 37%");
		expect(messageUploadNote([100, 100, 200], 399, 400)).toBe("Uploading 3 of 3 · 99%");
		expect(messageUploadNote([100, 100, 200], 400, 400)).toBe("Uploading 3 of 3 · 100%");
		expect(fileGoingUp([100, 100, 200], 400, 400)).toBe(2);
	});
});

// A send whose request a test holds: what it was given to follow its upload, and how to end it.
function heldSend<T>(answer: T) {
	const held: {
		upload?: UploadOptions;
		answer: () => void;
		fail: (err: unknown) => void;
		// The request's own end, as sendForm's: an abort of its signal fails it while it's under way.
		send: (upload?: UploadOptions) => Promise<T>;
	} = {
		answer: () => {},
		fail: () => {},
		send: (upload) =>
			new Promise<T>((resolve, reject) => {
				held.upload = upload;
				held.answer = () => resolve(answer);
				held.fail = reject;
				upload?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
			}),
	};
	return held;
}

const photo = new File([new Uint8Array(1000)], "photo.png", { type: "image/png" });
const upload = (nonce: string) => get(messageUploads)[nonce];

describe("a message sent with files", () => {
	test("is followed by its nonce from 0, a percent at a time, until its request ends", async () => {
		const held = heldSend("posted");
		const sending = sendFollowed("n1", [photo], held.send);
		expect(upload("n1")).toEqual({ sent: 0, total: 0 });
		held.upload!.onUploadProgress!(10, 1000);
		expect(upload("n1")).toEqual({ sent: 10, total: 1000 });
		// The same percent: no news for the lists.
		const before = get(messageUploads);
		held.upload!.onUploadProgress!(15, 1000);
		expect(get(messageUploads)).toBe(before);
		held.upload!.onUploadProgress!(1000, 1000);
		expect(upload("n1")).toEqual({ sent: 1000, total: 1000 });
		held.answer();
		expect(await sending).toBe("posted");
		expect(upload("n1")).toBeUndefined();
	});

	test("Cancel stops it while its bytes go up: its request is aborted, and the send resolves to CANCELLED", async () => {
		const held = heldSend("posted");
		const sending = sendFollowed("n2", [photo], held.send);
		held.upload!.onUploadProgress!(500, 1000);
		expect(cancelUpload("n2")).toBe(true);
		expect(held.upload!.signal!.aborted).toBe(true);
		expect(await sending).toBe(CANCELLED);
		expect(upload("n2")).toBeUndefined();
		// Nothing left to cancel.
		expect(cancelUpload("n2")).toBe(false);
	});

	test("Cancel is refused once every byte is up, as the API may post the message whatever happens then", async () => {
		const held = heldSend("posted");
		const sending = sendFollowed("n3", [photo], held.send);
		held.upload!.onUploadProgress!(1000, 1000);
		expect(cancelUpload("n3")).toBe(false);
		expect(held.upload!.signal!.aborted).toBe(false);
		held.answer();
		expect(await sending).toBe("posted");
	});

	test("an answer that came before Cancel wins: the message was posted, and the send resolves to it", async () => {
		// The answer is in and being read, as coreFetch reads it, when Cancel is pressed: the request is over by then.
		let answered!: () => void;
		const reading = new Promise<void>((resolve) => (answered = resolve));
		let given: UploadOptions | undefined;
		const sending = sendFollowed("n4", [photo], async (options) => {
			given = options;
			await reading;
			await Promise.resolve();
			return "posted";
		});
		given!.onUploadProgress!(500, 1000);
		answered();
		expect(cancelUpload("n4")).toBe(true);
		expect(await sending).toBe("posted");
	});

	test("a failure that isn't Cancel's fails the send, to retry or dismiss", async () => {
		const held = heldSend("posted");
		const sending = sendFollowed("n5", [photo], held.send);
		held.upload!.onUploadProgress!(200, 1000);
		held.fail(new Error("the server said no"));
		await expect(sending).rejects.toThrow("the server said no");
		expect(upload("n5")).toBeUndefined();
	});

	test("a Retry is followed anew, from 0", async () => {
		const first = heldSend("posted");
		const failed = sendFollowed("n6", [photo], first.send);
		first.upload!.onUploadProgress!(700, 1000);
		first.fail(new Error("no"));
		await failed.catch(() => {});
		const again = heldSend("posted");
		const retried = sendFollowed("n6", [photo], again.send);
		expect(upload("n6")).toEqual({ sent: 0, total: 0 });
		again.answer();
		expect(await retried).toBe("posted");
	});

	test("cancelled, it leaves its list; already replaced by the API's copy, it was posted, and stays", () => {
		const older = { id: "m1", nonce: undefined };
		const sending = { id: "n9", nonce: "n9" };
		const posted = { id: "m2", nonce: "n9" };
		expect(withoutSending([older, sending], "n9")).toEqual([older]);
		expect(withoutSending([older, posted], "n9")).toBeNull();
	});

	test("without files, nothing is followed and nothing can be cancelled", async () => {
		let given: UploadOptions | undefined = { signal: new AbortController().signal };
		const sending = sendFollowed("n7", undefined, async (options) => {
			given = options;
			return "posted";
		});
		expect(upload("n7")).toBeUndefined();
		expect(cancelUpload("n7")).toBe(false);
		expect(await sending).toBe("posted");
		expect(given).toBeUndefined();
		expect(await sendFollowed("n8", [], async () => "posted")).toBe("posted");
		expect(upload("n8")).toBeUndefined();
	});
});

// #323: a failed send's retry data (its files and voice note among them) stayed once its message had left every list,
// its chat's evicted or its room gone, where nothing could retry or dismiss it any more.
describe("forgetUnlisted", () => {
	test("forgets the retry data of the sends whose message no list has, and keeps the others", () => {
		const retries = new Map<string, { files: File[] }>([
			["shown", { files: [] }],
			["evicted", { files: [new File(["x"], "big.bin")] }],
		]);
		forgetUnlisted(retries, { room: [{ nonce: null }, { nonce: "shown" }], other: [] });
		expect([...retries.keys()]).toEqual(["shown"]);
	});

	test("reads no list while it holds nothing", () => {
		const lists = new Proxy(
			{},
			{
				ownKeys: () => {
					throw new Error("read");
				},
			},
		);
		expect(() => forgetUnlisted(new Map(), lists)).not.toThrow();
	});
});

// The rooms' and the conversations' sends both forget theirs as the lists change.
test("both kinds of send forget their retry data as their message leaves the lists", () => {
	const source = (file: string) => readFileSync(join(import.meta.dir, "components", file), "utf8");
	expect(source("Chat.svelte")).toContain("channelMessages.subscribe((all) => forgetUnlisted(retryData, all));");
	expect(source("ConversationView.svelte")).toContain(
		"dmMessages.subscribe((all) => forgetUnlisted(dmRetryData, all));",
	);
});
