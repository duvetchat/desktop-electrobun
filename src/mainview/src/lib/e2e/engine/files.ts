// A conversation's files (PLAN-E2E-CLIENTES.md, «Adjuntos», and its conventions between clients). Going out, each is
// sealed by the core with a key drawn for it alone, under an ID this device gives it, beside the SHA-256 of what it was
// (WebCrypto's: the one thing a client works out itself); its thumbnail rides in the message when it's 8 KiB or less
// and the message holds it, else it's a file of its own, which goes up after the message's files. Coming back, a file
// is downloaded from the API's signed URL, opened by the core and checked against what its message says of it. What a
// sender writes of a file is theirs: its name is cleaned, its type only says how it's waited for (its bytes say what it
// is), its size bounds what's downloaded, and a dimension, a duration or a waveform that doesn't read as one goes.
import { MAX_REQUEST_BYTES } from "$lib/api/api";
import { base64Bytes } from "$lib/activity-thumbnail";
import { bytesBase64 } from "$lib/staged-images";
import { cleanName, SNIFF_PREFIX, sniffType, WAVEFORM_SAMPLES, type EnvelopeFile } from "../conventions";
import { CoreError } from "../errors";
import { ATTACHMENT_PART, PART_TAG, type CoreHost } from "../host";
import { uuidv7 } from "../uuid";
import type { ShownMessage } from "./content";

/** A file the person sends, as the page has it: its bytes, its name as picked, and what the page could tell of it. */
export interface OutgoingFile {
	file: Blob;
	name: string;
	width?: number;
	height?: number;
	duration_ms?: number;
	/** A voice note's 64 peaks, a byte each. */
	waveform?: Uint8Array;
	/** Its picture's or its video's thumbnail (lib/e2e/thumbnails.ts): a JPEG, or a PNG with transparency. */
	thumbnail?: Blob;
}

/** What a message says of a file, as a view may use it: `said` is only its sender's word on its type. */
export interface ShownFile {
	id: string;
	key: string;
	sha256: string;
	name: string;
	said: string;
	size: number;
	width?: number;
	height?: number;
	duration_ms?: number;
	waveform?: string;
	thumbnail?: string;
	thumbnail_ref?: FileRef;
}

/** A thumbnail that's a file of its own. */
export interface FileRef {
	id: string;
	key: string;
	sha256: string;
	size: number;
}

/** A file a view draws: what its message says of it, and the API's signed URLs of its bytes and its thumbnail's. */
export type SealedFile = ShownFile & { url: string | null; thumbnailUrl?: string | null };

/** Why a file isn't shown: no URL for it, a size that isn't its own, other bytes than its sender's, bytes the core
 * didn't open, which no ask changes; or no download, which a click asks again (task 18's review, I4). */
export type FileFailure = "unavailable" | "size" | "hash" | "download" | "open";

export class FileError extends Error {
	constructor(
		readonly reason: FileFailure,
		options?: ErrorOptions,
	) {
		super(`the file can't be shown: ${reason}`, options);
		this.name = "FileError";
	}
}

/** A message whose files this device no longer has the sealed bytes of (the app started again): it can only go. */
export class FilesGone extends Error {
	constructor() {
		super("this message's files aren't on this device any more");
		this.name = "FilesGone";
	}
}

/** The most a thumbnail inside a message holds (the core's). */
const MAX_THUMBNAIL = 8 << 10;
/** A thumbnail's types. */
const THUMBNAIL_TYPES = ["image/jpeg", "image/png"];
/** The longest side of a picture or a video taken from what its sender says, and the longest duration: a day. */
const MAX_SIDE = 65_535;
const MAX_DURATION_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OCTET_STREAM = "application/octet-stream";

/** What a file of `size` bytes is once sealed: each part of 64 KiB with its tag, and an empty file one part. */
export const sealedSize = (size: number) => size + PART_TAG * Math.max(1, Math.ceil(size / ATTACHMENT_PART));

const sha256Of = async (bytes: Uint8Array | Blob) =>
	bytesBase64(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", bytes instanceof Blob ? await bytes.arrayBuffer() : new Uint8Array(bytes)),
		),
	);
const typeOf = async (blob: Blob) => sniffType(new Uint8Array(await blob.slice(0, SNIFF_PREFIX).arrayBuffer()));
const side = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_SIDE;
const duration = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_DURATION_MS;

/** Bytes sealed by the core under a key and an ID of their own: what a message names them by, and what goes up. */
async function sealOne(host: CoreHost, plain: Blob): Promise<FileRef & { sealed: Blob }> {
	const { key } = await host.handle<{ key: string }>({ cmd: "attachment_key" });
	const id = uuidv7();
	const sealed = await host.sealFile(key, id, plain);
	return { id, key, sha256: await sha256Of(plain), size: plain.size, sealed };
}

interface Made {
	attachment: EnvelopeFile;
	sealed: Blob;
	thumbnail: Blob | null;
	apart: { id: string; sealed: Blob } | null;
}

/** A message's files sealed: what its envelope says of each, and the bytes that go up by their IDs. */
export class SealedFiles {
	readonly #host: CoreHost;
	readonly #made: Made[];

	private constructor(host: CoreHost, made: Made[]) {
		this.#host = host;
		this.#made = made;
	}

	get attachments(): EnvelopeFile[] {
		return this.#made.map((made) => made.attachment);
	}

	/** The IDs the API takes them by, in its order: the message's files, then the thumbnails of their own. */
	get ids(): string[] {
		const apart = this.#made.flatMap((made) => (made.apart ? [made.apart.id] : []));
		return [...this.#made.map((made) => made.attachment.id), ...apart];
	}

	/** Their sealed bytes, in the IDs' order. */
	get blobs(): Blob[] {
		const apart = this.#made.flatMap((made) => (made.apart ? [made.apart.sealed] : []));
		return [...this.#made.map((made) => made.sealed), ...apart];
	}

	/** The largest thumbnail still inside the message, made a file of its own: false once none is left. */
	async apart(): Promise<boolean> {
		let largest: Made | null = null;
		for (const made of this.#made) {
			if (made.attachment.thumbnail === undefined || !made.thumbnail) continue;
			if (!largest || made.thumbnail.size > (largest.thumbnail?.size ?? 0)) largest = made;
		}
		if (!largest) return false;
		await this.#toFile(largest);
		return true;
	}

	async #toFile(made: Made) {
		if (!made.thumbnail) return;
		const { sealed, ...ref } = await sealOne(this.#host, made.thumbnail);
		delete made.attachment.thumbnail;
		made.attachment.thumbnail_ref = ref;
		made.apart = { id: ref.id, sealed };
	}

	/**
	 * The person's files, each sealed with a key of its own under an ID this device gives it, its type read from its
	 * bytes and its name cleaned; and its thumbnail, a JPEG or a PNG of a picture's or a video's, inside the message when
	 * it's 8 KiB or less (apart() takes one out), else a file of its own.
	 */
	static async of(host: CoreHost, files: OutgoingFile[]): Promise<SealedFiles> {
		const made: Made[] = [];
		for (const one of files) {
			const type = await typeOf(one.file);
			const { sealed, ...ref } = await sealOne(host, one.file);
			const attachment: EnvelopeFile = { ...ref, name: cleanName(one.name), type };
			if (side(one.width) && side(one.height)) Object.assign(attachment, { width: one.width, height: one.height });
			if (duration(one.duration_ms)) attachment.duration_ms = one.duration_ms;
			if (one.waveform?.length === WAVEFORM_SAMPLES) attachment.waveform = bytesBase64(one.waveform);
			const pictured = type.startsWith("image/") || type.startsWith("video/");
			const thumbnail =
				one.thumbnail && pictured && THUMBNAIL_TYPES.includes(await typeOf(one.thumbnail)) ? one.thumbnail : null;
			made.push({ attachment, sealed, thumbnail, apart: null });
		}
		const sealed = new SealedFiles(host, made);
		for (const one of made) {
			if (!one.thumbnail) continue;
			if (one.thumbnail.size > MAX_THUMBNAIL) await sealed.#toFile(one);
			else one.attachment.thumbnail = bytesBase64(new Uint8Array(await one.thumbnail.arrayBuffer()));
		}
		return sealed;
	}
}

/** A thumbnail's file as its message names it, when it reads as one. */
function fileRef(value: unknown): FileRef | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const [id, key, sha256, size] = ["id", "key", "sha256", "size"].map((field): unknown => Reflect.get(value, field));
	if (typeof id !== "string" || !UUID.test(id) || typeof key !== "string" || typeof sha256 !== "string")
		return undefined;
	return typeof size === "number" && size >= 0 ? { id, key, sha256, size } : undefined;
}

/** The bytes a base64 field holds, or null for one that doesn't read. */
function decoded(value: unknown): Uint8Array | null {
	if (typeof value !== "string") return null;
	try {
		return base64Bytes(value);
	} catch {
		return null;
	}
}

/**
 * A file the core shows of a message (its `messages`' attachments), as a view may use it: null for one without an ID or
 * a key. Its name is cleaned; its type is only its sender's word (`said`); a size is any number, which openSealed bounds;
 * its dimensions, duration and waveform only when they read as such; a thumbnail inside it only of 8 KiB or less.
 */
export function shownFile(raw: unknown): ShownFile | null {
	if (typeof raw !== "object" || raw === null) return null;
	const at = (field: string): unknown => Reflect.get(raw, field);
	const [id, key, sha256, name, said, size] = ["id", "key", "sha256", "name", "type", "size"].map(at);
	if (typeof id !== "string" || !UUID.test(id) || typeof key !== "string" || typeof sha256 !== "string") return null;
	if (typeof size !== "number" || size < 0) return null;
	const file: ShownFile = {
		...{ id, key, sha256, size },
		name: cleanName(typeof name === "string" ? name : ""),
		said: typeof said === "string" ? said : OCTET_STREAM,
	};
	const [width, height, length] = ["width", "height", "duration_ms"].map(at);
	if (side(width) && side(height)) Object.assign(file, { width, height });
	if (duration(length)) file.duration_ms = length;
	const waveform = at("waveform");
	if (typeof waveform === "string" && decoded(waveform)?.length === WAVEFORM_SAMPLES) file.waveform = waveform;
	const thumbnail = at("thumbnail");
	const inside = decoded(thumbnail);
	if (typeof thumbnail === "string" && inside && inside.length <= MAX_THUMBNAIL) file.thumbnail = thumbnail;
	const ref = fileRef(at("thumbnail_ref"));
	if (ref && !file.thumbnail) file.thumbnail_ref = ref;
	return file;
}

/** How a file's sealed bytes come down, and how the core opens them. */
export interface FileOpener {
	/** The sealed bytes, `most` of them at most, `progress` hearing how many came. */
	download(most: number, progress?: (received: number) => void): Promise<Uint8Array>;
	open(key: string, id: string, sealed: Blob, progress?: (done: number) => void): Promise<Blob>;
}

/**
 * A file of a message, opened and checked before anything uses it (Review Focus 7): a size no request could carry is
 * never downloaded, and the download stops past what a file of its size holds; what came must be all of it, the core
 * must open it to that many bytes, and their SHA-256 must be the one its message says. Its type is its bytes'
 * (sniffType's), the Blob's too: a page or an SVG called a picture is application/octet-stream. `progress` hears how
 * far it is, from 0 to 1, the download and the opening together. A FileError says why it isn't shown.
 */
export async function openSealed(
	file: Pick<FileRef, "id" | "key" | "sha256" | "size">,
	deps: FileOpener,
	progress?: (share: number) => void,
): Promise<{ blob: Blob; type: string }> {
	const { size } = file;
	if (!Number.isSafeInteger(size) || sealedSize(size) > MAX_REQUEST_BYTES) throw new FileError("size");
	const most = sealedSize(size);
	const whole = most + size;
	let sealed: Uint8Array;
	try {
		sealed = await deps.download(most, (received) => {
			if (received > most) throw new FileError("size");
			progress?.(received / whole);
		});
	} catch (error) {
		if (error instanceof FileError) throw error;
		throw new FileError(error instanceof RangeError ? "size" : "download", { cause: error });
	}
	if (sealed.length !== most) throw new FileError("size");
	let plain: Blob;
	try {
		plain = await deps.open(file.key, file.id, new Blob([new Uint8Array(sealed)]), (done) =>
			progress?.((most + done) / whole),
		);
	} catch (error) {
		// The core's own word on its bytes or its key is final; one that didn't reach it (no engine ready now, a tab's
		// handover) isn't.
		const final = error instanceof CoreError && (error.code === "decrypt_failed" || error.code === "bad_command");
		throw new FileError(final ? "open" : "download", { cause: error });
	}
	if (plain.size !== size) throw new FileError("size");
	const bytes = new Uint8Array(await plain.arrayBuffer());
	if ((await sha256Of(bytes)) !== file.sha256) throw new FileError("hash");
	const type = sniffType(bytes.subarray(0, SNIFF_PREFIX));
	return { blob: new Blob([bytes], { type }), type };
}

/** The types of the decrypted files the app draws, each in its element: every one sniffType reads but bytes to save. */
const DRAWN = new Set([
	...["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"],
	...["video/mp4", "video/webm", "video/quicktime"],
	...["audio/mp4", "audio/wav", "audio/webm", "audio/ogg", "audio/flac", "audio/mpeg"],
]);

/**
 * The element a decrypted file is drawn in, by its bytes' own type (openSealed's): an <img>, a <video>, an <audio>
 * player, or else none: it's saved as bytes, never opened (Review Focus 6). AVIF and QuickTime stay: the app draws an
 * AVIF in an <img>, as every engine it runs on decodes one, and plays a QuickTime as it plays a room's (Chromium reads
 * its H.264); one it can't play offers its file to save.
 */
export function drawnBy(type: string): "image" | "video" | "audio" | "download" {
	if (!DRAWN.has(type)) return "download";
	return type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : "audio";
}

/**
 * A GIF of the picker's as a file of its own (Ruling 12), to go sealed as any picture: its bytes, which must be a GIF's,
 * named after the last part of its URL. Null when they can't be had or aren't a GIF.
 */
export async function gifFile(url: string, bytesOf: (url: string) => Promise<Uint8Array | null>): Promise<File | null> {
	const bytes = await bytesOf(url).catch(() => null);
	if (!bytes || sniffType(bytes.subarray(0, SNIFF_PREFIX)) !== "image/gif") return null;
	let last = new URL(url).pathname.split("/").pop() ?? "";
	try {
		last = decodeURIComponent(last);
	} catch {
		// Kept as it was written.
	}
	const name = cleanName(last);
	return new File([new Uint8Array(bytes)], /\.gif$/i.test(name) ? name : `${name}.gif`, { type: "image/gif" });
}

/** How many messages a search page gives. */
const SEARCH_PAGE = 100;

/**
 * The names of the files whose messages this device holds, by their IDs, a thumbnail of its own named as its file:
 * one pass of the core's search of the messages with files, a page at a time (Ruling 31).
 */
export async function fileNames(host: CoreHost): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	for (let offset = 0; ; offset += SEARCH_PAGE) {
		const { total, messages } = await host.handle<{ total: number; messages: ShownMessage[] }>({
			...{ cmd: "search", has: ["file"], limit: SEARCH_PAGE, offset },
		});
		for (const message of messages) {
			for (const raw of message.attachments) {
				const file = shownFile(raw);
				if (!file) continue;
				names.set(file.id, file.name);
				if (file.thumbnail_ref) names.set(file.thumbnail_ref.id, file.name);
			}
		}
		if (messages.length < SEARCH_PAGE || offset + SEARCH_PAGE >= total) return names;
	}
}
