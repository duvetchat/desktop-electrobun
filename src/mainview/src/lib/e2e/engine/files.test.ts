import { afterEach, describe, expect, test } from "bun:test";
import type { DirectMessage } from "$lib/api/conversations";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bytesBase64 } from "$lib/staged-images";
import { drawnAs, type EnvelopeFile } from "../conventions";
import { FakeApi, type GatewayEvent } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	commitByHand,
	firstDevice,
	rejection,
	restarted,
	sameGroup,
	turnEnded,
	until,
	useFake,
	type TestDevice,
} from "../testing/engines";
import { holdUploads, useXHR } from "../testing/xhr";
import { drawnBy, FileError, FilesGone, gifFile, openSealed, sealedSize, shownFile, type ShownFile } from "./files";

// A conversation's files (PLAN-E2E-CLIENTES.md, «Adjuntos», and its conventions between clients): each sealed by the
// core with a key and an ID of its own, sent with that ID, and opened by the other device from the API's signed URL,
// its bytes checked against what the message says of them. What a sender writes of a file is theirs: a name with a
// path, a type it isn't, a size it doesn't have. Ana's and Bo's devices, in a DM whose group Ana made.
const SLOW = 180_000;
useXHR();
/** Uploads stop halfway until letGo: what a test holds goes as it ends, failed or not, so none times out in the next. */
const holds: (() => void)[] = [];
const holdAll = () => holdUploads(() => new Promise<void>((go) => holds.push(go)));
const letGo = () => {
	holdUploads(null);
	for (const go of holds.splice(0)) go();
};
afterEach(letGo);

/** Ana's and Bo's first devices in their DM (Ana's hearing what `aHears` lets through), and the forms and bodies the
 * fake took. */
async function dm(aHears?: (event: GatewayEvent) => boolean) {
	const fake = new FakeApi();
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	const forms: Promise<FormData>[] = [];
	const bodies: Promise<string>[] = [];
	useFake(fake, (request) => {
		bodies.push(request.clone().text());
		if (request.headers.get("Content-Type")?.includes("multipart/form-data")) forms.push(request.formData());
	});
	const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
	const a = await firstDevice(fake, ana, { hears: aHears });
	const b = await firstDevice(fake, bo);
	await a.engine.openConversation(conversation);
	await sameGroup([a, b], conversation);
	return { fake, a, b, conversation, forms: () => Promise.all(forms), bodies: () => Promise.all(bodies) };
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
/** Bytes a client reads as a PNG, a JPEG or a GIF: their signature, then anything. */
const withHead = (head: number[], n: number) => new Uint8Array([...head, ...random(n - head.length)]);
const png = (n: number) => withHead([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], n);
const jpeg = (n: number) => withHead([0xff, 0xd8, 0xff], n);
const gif = (n: number) => withHead([...new TextEncoder().encode("GIF89a")], n);
const blob = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)]);

/** The device's files of a message, once its core holds the message, as a view reads them. */
async function filesOn(device: TestDevice, conversation: string, id: string): Promise<ShownFile[]> {
	let files: ShownFile[] = [];
	await until(async () => {
		const [row] = await device.engine.messages(conversation, [id]);
		if (row?.status !== "ok") return false;
		files = row.attachments.map(shownFile).filter((file): file is ShownFile => file !== null);
		return true;
	});
	return files;
}

/** How a device opens a file the API keeps at `url`: downloaded with none of the app's headers, opened by its core. */
const openerOf = (device: TestDevice, url: string | undefined) => ({
	download: (most: number, progress?: (received: number) => void) => {
		if (!url) throw new Error("the API names no such file");
		return device.api.sealedFile(url, most, progress);
	},
	open: (key: string, id: string, sealed: Blob, progress?: (done: number) => void) =>
		device.engine.openFile(key, id, sealed, progress),
});
const urlOf = (message: DirectMessage, id: string) => message.attachments?.find((a) => a.id === id)?.url;
/** The IDs of the conversation's messages the API holds, as a device reads its queue. */
const onTheApi = async (device: TestDevice, conversation: string) =>
	(await device.api.queue(conversation, 0)).entries.filter((e) => e.kind === "message").map((e) => e.message_id!);

/**
 * A file as another client could send it, its envelope written by hand: the core seals it and encrypts what it's told,
 * and nothing checks what the sender says of it. Sent beside Ana's engine, which is idle.
 */
async function sendWritten(
	device: TestDevice,
	conversation: string,
	files: { bytes: Uint8Array; said: Partial<EnvelopeFile> }[],
): Promise<DirectMessage> {
	const attachments: EnvelopeFile[] = [];
	const sealed: Blob[] = [];
	for (const { bytes, said } of files) {
		const { key } = await device.host.handle<{ key: string }>({ cmd: "attachment_key" });
		const id = crypto.randomUUID();
		const hash = bytesBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));
		sealed.push(await device.host.sealFile(key, id, blob(bytes)));
		attachments.push({
			id,
			key,
			sha256: hash,
			name: "file",
			type: "application/octet-stream",
			size: bytes.length,
			...said,
		});
	}
	const nonce = crypto.randomUUID();
	const { ciphertext } = await device.host.handle<{ ciphertext: string }>({
		...{ cmd: "encrypt", conversation_id: conversation, nonce },
		envelope: { attachments },
	});
	const ids = attachments.map((a) => a.id);
	const message = await device.api.sendMessage(conversation, { ciphertext, nonce, attachment_ids: ids }, sealed);
	await device.host.handle({
		...{ cmd: "sent", conversation_id: conversation, nonce },
		...{ message_id: message.id, seq: message.seq },
	});
	return message;
}

// Step 5's review, M4 (desktop-electrobun#544): a thumbnail of its own was taken whatever its size, up to a request's
// 32 MiB, and every reader downloaded it as its row neared the screen.
test("a thumbnail of its own past what a 320 px JPEG or PNG takes is none: it's never downloaded", () => {
	const ref = { id: crypto.randomUUID(), key: "a2V5", sha256: "aGFzaA==" };
	const raw = {
		id: crypto.randomUUID(),
		key: "a2V5",
		sha256: "aGFzaA==",
		name: "a.png",
		type: "image/png",
		size: 1000,
	};
	expect(shownFile({ ...raw, thumbnail_ref: { ...ref, size: 512 << 10 } })?.thumbnail_ref).toEqual({
		...ref,
		size: 512 << 10,
	});
	expect(shownFile({ ...raw, thumbnail_ref: { ...ref, size: (512 << 10) + 1 } })).toMatchObject({ name: "a.png" });
	expect(shownFile({ ...raw, thumbnail_ref: { ...ref, size: (512 << 10) + 1 } })?.thumbnail_ref).toBeUndefined();
	expect(shownFile({ ...raw, thumbnail_ref: { ...ref, size: 32 << 20 } })?.thumbnail_ref).toBeUndefined();
});

describe.skipIf(!coreLibrary)("a conversation's files", () => {
	test(
		"a file is sealed, sent with its id, and opened by the other device",
		async () => {
			const { fake, a, b, conversation, forms, bodies } = await dm();
			const picture = png(70_000);
			const progress: [number, number][] = [];
			const sent = (await a.engine.sendMessage(
				{
					...{ conversation_id: conversation, nonce: crypto.randomUUID(), text: "a picture" },
					files: [{ file: blob(picture), name: "cat.png", width: 640, height: 480 }],
				},
				{ onUploadProgress: (done, total) => progress.push([done, total]) },
			))!;
			// The API took one file, under the ID the envelope names: the sealed bytes, as a file it can't open.
			const [file] = await filesOn(b, conversation, sent.id);
			expect(file).toMatchObject({ name: "cat.png", said: "image/png", size: picture.length, width: 640, height: 480 });
			expect(sent.attachments).toMatchObject([
				{ id: file!.id, filename: "file", content_type: "application/octet-stream", size_bytes: sealedSize(70_000) },
			]);
			const kept = fake.fileBytes(file!.id)!;
			expect(kept.length).toBe(sealedSize(picture.length));
			expect(Buffer.from(kept).includes(Buffer.from(picture.subarray(8, 64)))).toBe(false);
			// It went in a form, its ID beside it; its part names nothing of the file, and the bar measured what went up.
			const [form] = await forms();
			expect(form!.getAll("attachment_ids")).toEqual([file!.id]);
			const [part] = form!.getAll("files");
			expect(part).toBeInstanceOf(Blob);
			expect(part instanceof Blob && part.size).toBe(sealedSize(picture.length));
			expect(progress.at(-1)![0]).toBe(progress.at(-1)![1]);
			expect(progress.at(-1)![1]).toBeGreaterThan(sealedSize(picture.length));
			expect((await bodies()).some((body) => body.includes("cat.png"))).toBe(false);

			// Bo's device downloads it from its signed URL, and its core opens it: the picture, typed by its bytes.
			const opened = await openSealed(file!, openerOf(b, urlOf(sent, file!.id)));
			expect(await bytesOf(opened.blob)).toEqual(picture);
			expect(opened.type).toBe("image/png");
			expect(opened.blob.type).toBe("image/png");
			expect(drawnBy(opened.type)).toBe("image");
		},
		SLOW,
	);

	// Step 5's review, M6 (desktop-electrobun#544): in the core's format a part's nonce is its index, so one key over two
	// contents would use GCM's nonces twice. Only a key drawn for each file keeps that from happening.
	test(
		"each file is sealed under a key of its own: two files, a thumbnail apart, and one file sent again with other content",
		async () => {
			const { a, b, conversation } = await dm();
			const first = (await a.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				files: [
					{ file: blob(png(1000)), name: "a.png" },
					{ file: blob(png(2000)), name: "b.png", thumbnail: blob(jpeg(20 << 10)) },
				],
			}))!;
			const [one, two] = await filesOn(b, conversation, first.id);
			// The same file sent again with other content, as after a Cancel: a message of its own.
			const again = (await a.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				files: [{ file: blob(png(1000)), name: "a.png" }],
			}))!;
			const [three] = await filesOn(b, conversation, again.id);
			const keys = [one!.key, two!.key, two!.thumbnail_ref!.key, three!.key];
			expect(new Set(keys).size).toBe(4);
		},
		SLOW,
	);

	test(
		"a thumbnail of 8 KiB or less rides in the message; a larger one is a file of its own",
		async () => {
			const { a, b, conversation, forms } = await dm();
			const [small, large] = [jpeg(4 << 10), jpeg(20 << 10)];
			const sent = (await a.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				files: [
					{ file: blob(png(1000)), name: "a.png", thumbnail: blob(small) },
					{ file: blob(png(2000)), name: "b.png", thumbnail: blob(large) },
				],
			}))!;
			const [first, second] = await filesOn(b, conversation, sent.id);
			expect(first!.thumbnail).toBe(bytesBase64(small));
			expect(first!.thumbnail_ref).toBeUndefined();
			expect(second!.thumbnail).toBeUndefined();
			expect(second!.thumbnail_ref).toMatchObject({ size: large.length });
			// The files in their order, then the thumbnail of its own, which goes up in the same request.
			const [form] = await forms();
			expect(form!.getAll("attachment_ids")).toEqual([first!.id, second!.id, second!.thumbnail_ref!.id]);
			const thumbnail = await openSealed(second!.thumbnail_ref!, openerOf(b, urlOf(sent, second!.thumbnail_ref!.id)));
			expect(await bytesOf(thumbnail.blob)).toEqual(large);
			expect(thumbnail.type).toBe("image/jpeg");

			// Thumbnails of 8 KiB or less that the message can't hold together go apart, until it fits.
			const many = (await a.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				files: Array.from({ length: 5 }, (_, i) => ({
					file: blob(png(100)),
					name: `${i}.png`,
					thumbnail: blob(jpeg(7_900)),
				})),
			}))!;
			const files = await filesOn(b, conversation, many.id);
			expect(files).toHaveLength(5);
			const inside = files.filter((f) => f.thumbnail);
			const apart = files.filter((f) => f.thumbnail_ref);
			expect(inside.length + apart.length).toBe(5);
			expect(apart.length).toBeGreaterThan(0);
			expect(inside.length).toBeGreaterThan(0);
			for (const f of apart) {
				const opened = await openSealed(f.thumbnail_ref!, openerOf(b, urlOf(many, f.thumbnail_ref!.id)));
				expect(opened.type).toBe("image/jpeg");
			}
		},
		SLOW,
	);

	test(
		"a decrypted file is drawn by its bytes or downloaded, never opened",
		async () => {
			const { a, b, conversation } = await dm();
			const page = new TextEncoder().encode("<!doctype html><script>parent.postMessage('x', '*')</script>");
			const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
			const sent = await sendWritten(a, conversation, [
				{ bytes: page, said: { name: "cat.png", type: "image/png" } },
				{ bytes: svg, said: { name: "logo.svg", type: "image/svg+xml" } },
				{ bytes: jpeg(3000), said: { name: "photo.bin", type: "application/octet-stream" } },
			]);
			const [html, vector, photo] = await filesOn(b, conversation, sent.id);
			// An HTML page called a PNG is no picture: its bytes say what it is, and it only ever downloads.
			const asPage = await openSealed(html!, openerOf(b, urlOf(sent, html!.id)));
			expect(asPage.type).toBe("application/octet-stream");
			expect(asPage.blob.type).toBe("application/octet-stream");
			expect(drawnBy(asPage.type)).toBe("download");
			// An SVG isn't drawn either: no element of the app's takes one.
			const asVector = await openSealed(vector!, openerOf(b, urlOf(sent, vector!.id)));
			expect(drawnBy(asVector.type)).toBe("download");
			// A picture is a picture whatever its sender calls it.
			const asPhoto = await openSealed(photo!, openerOf(b, urlOf(sent, photo!.id)));
			expect(asPhoto.type).toBe("image/jpeg");
			expect(drawnBy(asPhoto.type)).toBe("image");
			for (const type of ["video/mp4", "video/webm", "video/quicktime"]) expect(drawnBy(type)).toBe("video");
			for (const type of ["audio/ogg", "audio/webm", "audio/mpeg"]) expect(drawnBy(type)).toBe("audio");
			for (const type of ["image/avif", "image/webp", "image/gif"]) expect(drawnBy(type)).toBe("image");
			for (const type of ["text/html", "image/svg+xml", "application/pdf", "image/heic"]) {
				expect(drawnBy(type)).toBe("download");
			}
		},
		SLOW,
	);

	test(
		"a file's name, type and size are checked before they're used",
		async () => {
			const { a, b, conversation } = await dm();
			const bytes = png(100);
			const sent = await sendWritten(a, conversation, [
				{ bytes, said: { name: "../../Desktop/‮gnp.exe", type: "image/png", width: 4_000_000_000 } },
				// It says it's smaller than it is: the download stops past what a file of its size holds.
				{ bytes, said: { name: "small.png", size: 10 } },
				// And bigger: what came isn't all of it.
				{ bytes, said: { name: "big.png", size: 1000 } },
				// A size no request could carry is never downloaded.
				{ bytes, said: { name: "huge.png", size: 2 ** 40, duration_ms: 2 ** 60 } },
			]);
			const [named, small, big, huge] = await filesOn(b, conversation, sent.id);
			// Its name without its path or what hides its kind; a width no picture has left out; its type only a claim.
			expect(named).toMatchObject({ name: "gnp.exe", said: "image/png" });
			expect(named!.width).toBeUndefined();
			const shownAs = await openSealed(named!, openerOf(b, urlOf(sent, named!.id)));
			expect(shownAs.type).toBe("image/png");

			const reasons: string[] = [];
			for (const file of [small!, big!]) {
				const error = await rejection(openSealed(file, openerOf(b, urlOf(sent, file.id))));
				reasons.push(error instanceof FileError ? error.reason : String(error));
			}
			expect(reasons).toEqual(["size", "size"]);
			let asked = false;
			const refused = await rejection(
				openSealed(huge!, {
					download: () => {
						asked = true;
						return Promise.resolve(new Uint8Array());
					},
					open: () => Promise.reject(new Error("never")),
				}),
			);
			expect(refused instanceof FileError && refused.reason).toBe("size");
			expect(asked).toBe(false);
			expect(huge!.duration_ms).toBeUndefined();
		},
		SLOW,
	);

	test(
		"a file whose hash differs isn't shown",
		async () => {
			const { a, b, conversation } = await dm();
			const other = bytesBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", png(64))));
			const sent = await sendWritten(a, conversation, [{ bytes: png(100), said: { name: "a.png", sha256: other } }]);
			const [file] = await filesOn(b, conversation, sent.id);
			const error = await rejection(openSealed(file!, openerOf(b, urlOf(sent, file!.id))));
			expect(error instanceof FileError && error.reason).toBe("hash");
		},
		SLOW,
	);

	test(
		"a GIF picked in a conversation goes as a sealed file",
		async () => {
			const { a, b, conversation, bodies } = await dm();
			const url = "https://static.klipy.com/ii/abc/12/34/dancing-cat.gif";
			const bytes = gif(5000);
			const picked = await gifFile(url, async (asked) => (asked === url ? bytes : null));
			expect(picked).toMatchObject({ name: "dancing-cat.gif", type: "image/gif" });
			// Bytes that aren't a GIF aren't sent as one.
			expect(await gifFile(url, async () => png(100))).toBeNull();
			const sent = (await a.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				files: [{ file: picked!, name: picked!.name }],
			}))!;
			const [file] = await filesOn(b, conversation, sent.id);
			expect(file).toMatchObject({ name: "dancing-cat.gif", said: "image/gif", size: bytes.length });
			const [row] = await b.engine.messages(conversation, [sent.id]);
			expect(row!.text).toBeNull();
			// The API never saw where it came from.
			expect((await bodies()).some((body) => body.includes("klipy"))).toBe(false);
		},
		SLOW,
	);

	test(
		"a cancelled upload discards its message",
		async () => {
			const { a, b, conversation } = await dm();
			let release = () => {};
			holdUploads(() => new Promise<void>((resolve) => (release = resolve)));
			const stop = new AbortController();
			const progress: number[] = [];
			const nonce = crypto.randomUUID();
			const sending = a.engine.sendMessage(
				{ conversation_id: conversation, nonce, text: "never mind", files: [{ file: blob(png(5000)), name: "a.png" }] },
				{ signal: stop.signal, onUploadProgress: (done) => progress.push(done) },
			);
			await until(() => progress.length > 0);
			stop.abort();
			release();
			holdUploads(null);
			await rejection(sending);
			// The person's Cancel: the core lets the message go, and nothing of it reached anyone.
			expect(await a.engine.discardMessage(conversation, nonce)).toBeNull();
			expect(await a.engine.pendingMessages(conversation)).toEqual([]);
			const listed = await b.api.queue(conversation, 0);
			expect(listed.entries.filter((entry) => entry.kind === "message")).toEqual([]);
		},
		SLOW,
	);

	test(
		"Settings names an encrypted file from this device's own messages",
		async () => {
			const { a, b, conversation } = await dm();
			const sent = (await a.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID(), text: "two files" },
				files: [
					{ file: blob(png(100)), name: "../notes/plan.png" },
					{ file: blob(random(50)), name: "report.bin" },
				],
			}))!;
			const ids = sent.attachments!.map((attachment) => attachment.id);
			await filesOn(b, conversation, sent.id);
			for (const device of [a, b]) {
				const names = await device.engine.fileNames();
				expect(ids.map((id) => names.get(id))).toEqual(["plan.png", "report.bin"]);
			}
			// A file this device holds no message of has no name here.
			expect((await b.engine.fileNames()).get(crypto.randomUUID())).toBeUndefined();
		},
		SLOW,
	);

	// Task 18's review, I2: only the core's calls take the engine's turn; a message's request waits outside it.
	test(
		"an incoming message is applied while an upload is held",
		async () => {
			const { a, b, conversation } = await dm();
			holdAll();
			const progress: number[] = [];
			const sending = a.engine.sendMessage(
				{
					conversation_id: conversation,
					nonce: crypto.randomUUID(),
					files: [{ file: blob(png(5000)), name: "a.png" }],
				},
				{ onUploadProgress: (done) => progress.push(done) },
			);
			await until(() => progress.length > 0);
			// Bo's message comes while Ana's upload is held halfway: her device applies it, and her other work goes on.
			const his = (await b.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				text: "meanwhile",
			}))!;
			await until(async () => (await a.engine.messages(conversation, [his.id]))[0]?.text === "meanwhile", 15_000);
			letGo();
			expect(await sending).not.toBeNull();
		},
		SLOW,
	);

	test(
		"a Cancel stops its own upload, and never waits for an older message's",
		async () => {
			const { a, conversation, forms } = await dm();
			holdAll();
			const progress: number[] = [];
			const older = a.engine.sendMessage(
				{
					conversation_id: conversation,
					nonce: crypto.randomUUID(),
					files: [{ file: blob(png(5000)), name: "a.png" }],
				},
				{ onUploadProgress: (done) => progress.push(done) },
			);
			await until(() => progress.length > 0);
			// A newer message waits behind it in its conversation's lane; its Cancel ends it at once, and so does its Dismiss.
			const stop = new AbortController();
			const nonce = crypto.randomUUID();
			const newer = a.engine.sendMessage(
				{ conversation_id: conversation, nonce, files: [{ file: blob(png(3000)), name: "b.png" }] },
				{ signal: stop.signal },
			);
			await until(async () => (await a.engine.pendingMessages(conversation)).length === 2, 10_000);
			stop.abort();
			const soon = <T>(work: Promise<T>) => Promise.race([work, Bun.sleep(5_000).then(() => "waiting" as const)]);
			expect(
				await soon(
					newer.then(
						() => "sent",
						() => "stopped",
					),
				),
			).toBe("stopped");
			expect(await soon(a.engine.discardMessage(conversation, nonce))).toBeNull();
			letGo();
			await older;
			expect(await a.engine.pendingMessages(conversation)).toEqual([]);
			expect(await forms()).toHaveLength(1);
			expect(await onTheApi(a, conversation)).toHaveLength(1);
		},
		SLOW,
	);

	// Task 18's review, I3: a refusal of a message's files won't change, so they don't go up again at every flush.
	test(
		"a waiting message with files that the API refused waits for the person's Retry",
		async () => {
			const { fake, a, conversation, forms } = await dm();
			const path = { method: "POST", path: `/api/users/@me/conversations/${conversation}/messages` };
			fake.refuse(path, 413, { error: "file too large" });
			const nonce = crypto.randomUUID();
			const files = [{ file: blob(png(5000)), name: "big.png" }];
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce, files }));
			// Its sealed bytes are here: a Retry can send it.
			expect((await a.engine.pendingMessages(conversation))[0]?.files_gone).toBeUndefined();
			// The next message, and a READY, send what waits: the refused one stays.
			await a.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: "next" });
			a.connect(a.registered.at(-1)!);
			await turnEnded(a);
			await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "after the READY",
			});
			expect(await forms()).toHaveLength(1);
			// The person's Retry sends it.
			expect(await a.engine.sendMessage({ conversation_id: conversation, nonce, files })).not.toBeNull();
			expect(await forms()).toHaveLength(2);
		},
		SLOW,
	);

	// Task 18's review, I6: what sends a message with files a second time, under task 16's names.
	test(
		"a message cut before its answer is sent again with the same bytes, with files",
		async () => {
			// Ana's device doesn't hear its own messages' events, which its queue would settle them with first.
			const { fake, a, b, conversation, forms } = await dm((event) => event.type !== "DM_MESSAGE_CREATE");
			const path = { method: "POST", path: `/api/users/@me/conversations/${conversation}/messages` };
			const bytes = async (form: FormData) =>
				Promise.all(form.getAll("files").map((part) => (part instanceof Blob ? bytesOf(part) : part)));
			// The API takes it, and its answer is lost: sent again, the same bytes, which the API answers with its message.
			const once = crypto.randomUUID();
			const picture = [{ file: blob(png(5000)), name: "a.png" }];
			fake.loseAnswer(path);
			await rejection(
				a.engine.sendMessage({ conversation_id: conversation, nonce: once, text: "once", files: picture }),
			);
			const sent = (await a.engine.sendMessage({ conversation_id: conversation, nonce: once, files: picture }))!;
			const [first, again] = await forms();
			expect(again!.get("ciphertext")).toBe(first!.get("ciphertext"));
			expect(again!.getAll("attachment_ids")).toEqual(first!.getAll("attachment_ids"));
			expect(await bytes(again!)).toEqual(await bytes(first!));
			expect(await onTheApi(a, conversation)).toEqual([sent.id]);
			expect(await filesOn(b, conversation, sent.id)).toMatchObject([{ name: "a.png" }]);

			// Its files went up, and its connection was cut before the message: sent again, the API takes them again.
			const twice = crypto.randomUUID();
			fake.cutAfterFiles(path);
			const other = [{ file: blob(png(4000)), name: "b.png" }];
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: twice, files: other }));
			const resent = (await a.engine.sendMessage({ conversation_id: conversation, nonce: twice, files: other }))!;
			const [cut, taken] = (await forms()).slice(2);
			expect(taken!.getAll("attachment_ids")).toEqual(cut!.getAll("attachment_ids"));
			expect(resent.attachments?.map((file) => file.id)).toEqual(cut!.getAll("attachment_ids").map(String));
			expect(await onTheApi(a, conversation)).toEqual([sent.id, resent.id]);
			const [file] = await filesOn(b, conversation, resent.id);
			expect((await openSealed(file!, openerOf(b, urlOf(resent, file!.id)))).type).toBe("image/png");
		},
		SLOW,
	);

	test(
		"a stale message is discarded and encrypted again, with files",
		async () => {
			const { fake, a, b, conversation, forms } = await dm();
			const path = { method: "POST", path: `/api/users/@me/conversations/${conversation}/messages` };
			const epoch = async () =>
				(await a.host.handle<{ epoch: number }>({ cmd: "group", conversation_id: conversation })).epoch;
			// Its request never reached the API, while the group moved on six epochs: the core says it's stale.
			fake.cutRequest(path);
			const nonce = crypto.randomUUID();
			const files = [{ file: blob(png(5000)), name: "late.png" }];
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce, text: "late", files }));
			await b.engine.stop();
			await b.host.open(b.user);
			for (let i = 0; i < 6; i++) await commitByHand(b, conversation);
			await until(async () => (await epoch()) === 7);
			const sent = (await a.engine.sendMessage({ conversation_id: conversation, nonce, text: "late", files }))!;
			expect(sent.nonce).not.toBe(nonce);
			const [cut, remade] = [(await forms())[0]!, (await forms()).at(-1)!];
			expect(remade.getAll("attachment_ids")).toEqual(cut.getAll("attachment_ids"));
			const bo = await restarted(fake, b);
			expect(await filesOn(bo, conversation, sent.id)).toMatchObject([{ name: "late.png" }]);

			// The API says it's stale (409): made again under another nonce, with the same files.
			const refused = crypto.randomUUID();
			const group = await a.host.handle<{ generation: number; epoch: number }>({
				...{ cmd: "group", conversation_id: conversation },
			});
			fake.refuse(path, 409, { error: "stale message", ...group });
			const more = [{ file: blob(png(3000)), name: "again.png" }];
			const posted = (await a.engine.sendMessage({ conversation_id: conversation, nonce: refused, files: more }))!;
			expect(posted.nonce).not.toBe(refused);
			const [before, after] = (await forms()).slice(-2);
			expect(after!.getAll("attachment_ids")).toEqual(before!.getAll("attachment_ids"));
			expect(await filesOn(bo, conversation, posted.id)).toMatchObject([{ name: "again.png" }]);
		},
		SLOW,
	);

	test(
		"a message cut before its answer, and the app closed, waits for its Dismiss, with files",
		async () => {
			const { fake, a, conversation } = await dm();
			fake.cutRequest({ method: "POST", path: `/api/users/@me/conversations/${conversation}/messages` });
			const nonce = crypto.randomUUID();
			const files = [{ file: blob(png(5000)), name: "a.png" }];
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce, text: "with a file", files }));
			// Started again: its sealed bytes went with the app, so it goes neither at the start nor on a Retry.
			const again = await restarted(fake, a);
			await turnEnded(again);
			expect(await rejection(again.engine.sendMessage({ conversation_id: conversation, nonce, files }))).toBeInstanceOf(
				FilesGone,
			);
			expect(await onTheApi(again, conversation)).toEqual([]);
			// The view shows it so at once (task 18's review, M5).
			expect(await again.engine.pendingMessages(conversation)).toMatchObject([{ nonce, files_gone: true }]);
			expect(await again.engine.discardMessage(conversation, nonce)).toBeNull();
			expect(await again.engine.pendingMessages(conversation)).toEqual([]);
		},
		SLOW,
	);

	test(
		"a voice note goes by its convention",
		async () => {
			const { fake, a, b, conversation } = await dm();
			// Cut first: its Retry goes through the core's check of the envelope it kept, byte for byte.
			fake.cutRequest({ method: "POST", path: `/api/users/@me/conversations/${conversation}/messages` });
			const waveform = new Uint8Array(64).map((_, i) => i * 4);
			const ogg = withHead([...new TextEncoder().encode("OggS")], 3000);
			const note = [{ file: blob(ogg), name: "voice-note.webm", duration_ms: 2300, waveform }];
			const nonce = crypto.randomUUID();
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce, files: note }));
			const sent = (await a.engine.sendMessage({ conversation_id: conversation, nonce, files: note }))!;
			const [file] = await filesOn(b, conversation, sent.id);
			expect(file).toMatchObject({ said: "audio/ogg", duration_ms: 2300, waveform: bytesBase64(waveform) });
			const [row] = await b.engine.messages(conversation, [sent.id]);
			const said = [{ type: file!.said, duration_ms: file!.duration_ms, waveform: file!.waveform }];
			expect(drawnAs({ text: row!.text, attachments: said }, false)).toBe("voice_note");
		},
		SLOW,
	);

	// The ruled downloads: through the API itself (stream=1), the API's budget's 429 waited out.
	test(
		"a download refused by the API's budget waits for its Retry-After",
		async () => {
			const { fake, a, b, conversation } = await dm();
			const sent = (await a.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				files: [{ file: blob(png(5000)), name: "a.png" }],
			}))!;
			const [file] = await filesOn(b, conversation, sent.id);
			fake.refuse(
				{ method: "GET", path: /^\/attachments\// },
				429,
				{ error: "too many bytes" },
				{ "Retry-After": "1" },
			);
			expect((await openSealed(file!, openerOf(b, urlOf(sent, file!.id)))).type).toBe("image/png");
			// Its first answer may wait past the API's 30 s for the storage's first byte.
			expect(readFileSync(join(import.meta.dir, "../../api/e2e.ts"), "utf8")).toContain("requestLimits.slowAnswerMs");
		},
		SLOW,
	);

	// Task 18's review, Missing 2 and M4.
	test(
		"an attachment that doesn't open is counted, as decryption failures are",
		async () => {
			const { fake, a } = await dm();
			a.engine.fileFailed();
			a.clock.advance(120_000);
			await until(() => fake.decryptFailures.some((failure) => failure.kind === "attachment"));
		},
		SLOW,
	);

	test(
		"a message the queue deletes is told deleted, for its files to go",
		async () => {
			const { a, b, conversation } = await dm();
			const deleted: string[] = [];
			a.engine.onMessages((_id, _ids, _through, gone) => deleted.push(...(gone ?? [])));
			const sent = (await b.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				files: [{ file: blob(png(500)), name: "a.png" }],
			}))!;
			await filesOn(a, conversation, sent.id);
			await b.engine.deleteMessage(conversation, sent.id);
			await until(() => deleted.includes(sent.id));
		},
		SLOW,
	);

	// Task 18's re-review, N1: a send made while another's flush reads what waits goes up in that flush.
	test(
		"a message another flush delivers goes with its own upload, whose Cancel leaves nothing posted",
		async () => {
			const { a, conversation, forms } = await dm();
			holdAll();
			const stop = new AbortController();
			const progress: number[] = [];
			const nonce = crypto.randomUUID();
			// Two sends in one tick: the first's flush finds both waiting, and delivers both.
			const first = a.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: "first" });
			const second = a.engine.sendMessage(
				{ conversation_id: conversation, nonce, files: [{ file: blob(png(5000)), name: "b.png" }] },
				{ signal: stop.signal, onUploadProgress: (done) => progress.push(done) },
			);
			await until(() => holds.length === 1);
			// Its bar moves, and its Cancel stops its request, then its Dismiss: nothing of it reaches the API.
			expect(progress.length).toBeGreaterThan(0);
			stop.abort();
			await rejection(second);
			expect(await a.engine.discardMessage(conversation, nonce)).toBeNull();
			letGo();
			expect(await first).not.toBeNull();
			await turnEnded(a);
			expect(await forms()).toEqual([]);
			expect(await onTheApi(a, conversation)).toHaveLength(1);
			expect(await a.engine.pendingMessages(conversation)).toEqual([]);
		},
		SLOW,
	);

	// The Dismiss that follows a Cancel can come late, as another tab's does: its message's own flush comes first.
	test(
		"a cancelled message whose Dismiss comes late is never sent",
		async () => {
			const { a, conversation, forms } = await dm();
			holdAll();
			const progress: number[] = [];
			const older = a.engine.sendMessage(
				{
					conversation_id: conversation,
					nonce: crypto.randomUUID(),
					files: [{ file: blob(png(5000)), name: "a.png" }],
				},
				{ onUploadProgress: (done) => progress.push(done) },
			);
			await until(() => progress.length > 0);
			const stop = new AbortController();
			const nonce = crypto.randomUUID();
			const newer = a.engine.sendMessage(
				{ conversation_id: conversation, nonce, files: [{ file: blob(png(3000)), name: "b.png" }] },
				{ signal: stop.signal },
			);
			await until(async () => (await a.engine.pendingMessages(conversation)).length === 2);
			stop.abort();
			await rejection(newer);
			letGo();
			await older;
			await turnEnded(a);
			expect(await forms()).toHaveLength(1);
			expect(await onTheApi(a, conversation)).toHaveLength(1);
			expect(await a.engine.discardMessage(conversation, nonce)).toBeNull();
			expect(await a.engine.pendingMessages(conversation)).toEqual([]);
		},
		SLOW,
	);

	test(
		"a failed message with files, sent again by the next flush and dismissed while it goes up, isn't posted",
		async () => {
			const { fake, a, conversation, forms } = await dm();
			fake.cutRequest({ method: "POST", path: `/api/users/@me/conversations/${conversation}/messages` });
			const failed = crypto.randomUUID();
			const files = [{ file: blob(png(5000)), name: "a.png" }];
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: failed, files }));
			// The next send's flush sends it again first; the person dismisses it while it goes up.
			holdAll();
			const next = a.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: "next" });
			await until(() => holds.length === 1);
			expect(await a.engine.discardMessage(conversation, failed)).toBeNull();
			letGo();
			const went = (await next)!;
			// Its request stopped before the API took it: the next message alone is posted, and nothing waits.
			expect(await onTheApi(a, conversation)).toEqual([went.id]);
			expect(await forms()).toHaveLength(1);
			expect(await a.engine.pendingMessages(conversation)).toEqual([]);
		},
		SLOW,
	);

	// Task 18's re-review, N2: the API took the message while another request's 426 made the device wait for its update.
	test(
		"a message the API took while its device stopped being ready is bound here all the same",
		async () => {
			const { fake, a, conversation } = await dm();
			const before = (await a.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				text: "before",
			}))!;
			holdAll();
			const going = a.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				files: [{ file: blob(png(5000)), name: "a.png" }],
			});
			await until(() => holds.length === 1);
			fake.refuse({ method: "PATCH", path: `/api/users/@me/conversations/${conversation}/messages/${before.id}` }, 426);
			await rejection(a.engine.editMessage(conversation, before.id, "edited"));
			expect(a.engine.state).toMatchObject({ name: "update" });
			letGo();
			expect(await going).not.toBeNull();
			expect(await a.engine.pendingMessages(conversation)).toEqual([]);
		},
		SLOW,
	);

	// Task 18's re-review, N5: a file's URL is signed for 24 hours, and a view can outlast it.
	test(
		"a file whose signature expired is signed again before it's asked again",
		async () => {
			const { fake, a, b, conversation } = await dm();
			const sent = (await a.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				files: [{ file: blob(png(5000)), name: "a.png" }],
			}))!;
			const [file] = await filesOn(b, conversation, sent.id);
			fake.refuse({ method: "GET", path: /^\/attachments\// }, 403, { error: "invalid or expired signature" });
			expect((await openSealed(file!, openerOf(b, urlOf(sent, file!.id)))).type).toBe("image/png");
		},
		SLOW,
	);
});

// What step 5's fuzzing found (PLAN-E2E-CLIENTES.md, «Lo que el paso 5 revisa»), which e2e-fuzz-corpus.json keeps too.
describe("what the fuzzers found", () => {
	const file = { id: "0193a4b2-0000-7000-8000-0000000000c3", key: "a2V5", sha256: "c2hh", name: "a.ogg", size: 3 };

	test("a file's waveform and thumbnail are kept only as base64 in the form the core writes it", () => {
		const waveform = bytesBase64(new Uint8Array(64).fill(7));
		const thumbnail = bytesBase64(new Uint8Array(100).fill(9));
		expect(shownFile({ ...file, waveform, thumbnail })).toMatchObject({ waveform, thumbnail });
		// Without its padding, and with a space in front: neither is kept.
		const shown = shownFile({ ...file, waveform: waveform.replace(/=+$/, ""), thumbnail: ` ${thumbnail}` });
		expect(shown).not.toHaveProperty("waveform");
		expect(shown).not.toHaveProperty("thumbnail");
	});

	test("a thumbnail inside the message, an empty one too, is its thumbnail: one of its own beside it isn't taken", () => {
		const ref = { id: "0193a4b2-0000-7000-8000-0000000000c4", key: "a2V5", sha256: "c2hh", size: 9 };
		const shown = shownFile({ ...file, thumbnail: "", thumbnail_ref: ref });
		expect(shown).toMatchObject({ thumbnail: "" });
		expect(shown).not.toHaveProperty("thumbnail_ref");
		expect(shownFile({ ...file, thumbnail_ref: ref })).toMatchObject({ thumbnail_ref: ref });
	});
});
