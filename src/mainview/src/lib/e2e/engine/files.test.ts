import { describe, expect, test } from "bun:test";
import type { DirectMessage } from "$lib/api/conversations";
import { bytesBase64 } from "$lib/staged-images";
import type { EnvelopeFile } from "../conventions";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import { firstDevice, rejection, sameGroup, until, useFake, type TestDevice } from "../testing/engines";
import { holdUploads, useXHR } from "../testing/xhr";
import { drawnBy, FileError, gifFile, openSealed, sealedSize, shownFile, type ShownFile } from "./files";

// A conversation's files (PLAN-E2E-CLIENTES.md, «Adjuntos», and its conventions between clients): each sealed by the
// core with a key and an ID of its own, sent with that ID, and opened by the other device from the API's signed URL,
// its bytes checked against what the message says of them. What a sender writes of a file is theirs: a name with a
// path, a type it isn't, a size it doesn't have. Ana's and Bo's devices, in a DM whose group Ana made.
const SLOW = 180_000;
useXHR();

/** Ana's and Bo's first devices in their DM, and the forms and bodies the fake took. */
async function dm() {
	const fake = new FakeApi();
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	const forms: Promise<FormData>[] = [];
	const bodies: Promise<string>[] = [];
	useFake(fake, (request) => {
		bodies.push(request.clone().text());
		if (request.headers.get("Content-Type")?.includes("multipart/form-data")) forms.push(request.formData());
	});
	const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
	const a = await firstDevice(fake, ana);
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
});
