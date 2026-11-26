// What the desktop and the mobile app do alike where the core leaves it to them (PLAN-E2E-CLIENTES.md, its conventions
// between clients): a message's envelope as the core's encrypt takes it, what a message the core shows is drawn as, a
// file's name and type as a client may use them, and the frames of a device's approval in the inbox, with its
// fingerprint. Each has its cases in testing/e2e-conventions.json, which the mobile app's conventions_test.dart reads
// too. Bun's half of the desktop's boundary reads this module as well (src/bun/e2e/rpc.ts), hence relative imports:
// its type check knows no $lib.
import { base64Bytes } from "../activity-thumbnail";
import { imageSize } from "../image-size";
import { bytesBase64 } from "../staged-images";

/** A file a message carries, as the core's encrypt takes it and its messages show it: its binaries in base64. */
export interface EnvelopeFile {
	id: string;
	key: string;
	sha256: string;
	name: string;
	type: string;
	size: number;
	width?: number;
	height?: number;
	duration_ms?: number;
	waveform?: string;
	thumbnail?: string;
	thumbnail_ref?: { id: string; key: string; sha256: string; size: number };
}

/** A message's content as encrypt takes it, which the core writes as the envelope `{v: 1, text?, attachments?}`. */
export interface Envelope {
	text?: string;
	attachments?: EnvelopeFile[];
}

/**
 * A message's envelope: its text as a message's content carries it today, mentions and emojis included (`<@id>`,
 * `<#id>`, `<:id:>`), and its files. With neither it's the empty envelope of a sticker's message, the sticker in the
 * clear beside it. The core refuses an empty text: a message without one leaves it out.
 */
export function messageEnvelope(text: string, attachments: EnvelopeFile[]): Envelope {
	return { ...(text ? { text } : {}), ...(attachments.length ? { attachments } : {}) };
}

/** A voice note's waveform: 64 samples of a byte, each the peak of its stretch of the note. */
export const WAVEFORM_SAMPLES = 64;

/**
 * What a message the core shows is drawn as: a voice note (no text, and one audio file with its waveform and duration,
 * by what its sender says of it: its player still reads the file's type from its bytes), the sticker of an empty
 * envelope, nothing for an empty envelope without a sticker, or else a message, with its text and files. Its sender
 * wrote the fields, so they're read as the convention has them, never throwing: a duration is a number, and a
 * waveform its 64 bytes in padded standard base64; anything else is a file's.
 */
export function drawnAs(
	message: {
		text: string | null;
		attachments: readonly { type?: unknown; duration_ms?: unknown; waveform?: unknown }[];
	},
	sticker: boolean,
): "voice_note" | "sticker" | "nothing" | "message" {
	const [file, ...more] = message.attachments;
	if (!message.text && !file) return sticker ? "sticker" : "nothing";
	const voice =
		!message.text &&
		!more.length &&
		typeof file?.type === "string" &&
		file.type.startsWith("audio/") &&
		typeof file.duration_ms === "number" &&
		typeof file.waveform === "string" &&
		BASE64.test(file.waveform) &&
		base64Bytes(file.waveform).length === WAVEFORM_SAMPLES;
	return voice ? "voice_note" : "message";
}

/** The most characters a file's name keeps, counted by code point. */
export const MAX_FILE_NAME = 255;
// What a name loses: control characters, the line and paragraph separators, and every format character but the
// zero-width joiner, which holds an emoji sequence together. The bidirectional controls are format characters: with one,
// "invoice\u202Ecod.exe" shows as "invoiceexe.doc".
const UNSEEN = /[\p{Cc}\p{Zl}\p{Zp}]|(?!\u200D)\p{Cf}/gu;
// A lone surrogate, which shows as U+FFFD and is written as one in UTF-8, is made one first: halves that a hidden
// character kept apart would otherwise join into a character of their own once it goes, as U+DB40 U+200B U+DC01 joins
// into U+E0001, a hidden tag character.
const visible = (text: string) => text.replace(/\p{Cs}/gu, "\uFFFD").replace(UNSEEN, "");

/**
 * A file's name as a client may show or use it, whoever wrote it: its last part after any / or \, without the
 * characters that hide what it is, trimmed, 255 characters at most; "file" when nothing of it is left.
 */
export function cleanName(name: string): string {
	const last = name.split(/[/\\]/).pop() ?? "";
	const kept = Array.from(visible(last).trim()).slice(0, MAX_FILE_NAME).join("").trim();
	return kept === "" || kept === "." || kept === ".." ? "file" : kept;
}

/** How much of a file both apps read to tell its type: its first 64 KiB. */
export const SNIFF_PREFIX = 64 << 10;

/** A thumbnail's longer side, at most: as an app makes one, and as both draw one. */
export const THUMBNAIL_SIDE = 320;

/**
 * Whether a thumbnail's bytes are drawn: a JPEG or a PNG whose header says it's THUMBNAIL_SIDE a side at most, read
 * before anything decodes it. What its sender writes is theirs, and an 8 KiB JPEG whose header says 12000 × 12000 would
 * take a bitmap of 576 MB on every visit (task 18's re-review; the mobile app's review, I3).
 */
export function thumbnailDrawn(bytes: Uint8Array): boolean {
	const type = sniffType(bytes.subarray(0, SNIFF_PREFIX));
	const size = type === "image/jpeg" || type === "image/png" ? imageSize(bytes) : null;
	return !!size && size.width > 0 && size.height > 0 && Math.max(size.width, size.height) <= THUMBNAIL_SIDE;
}
const OCTET_STREAM = "application/octet-stream";
// The brands of an ISO media file (its `ftyp`) the clients draw; any other is a file to download.
const BRANDS: Record<string, string> = {
	"M4A ": "audio/mp4",
	"qt  ": "video/quicktime",
	avif: "image/avif",
	...Object.fromEntries(
		[
			"isom",
			"iso2",
			"iso4",
			"iso5",
			"iso6",
			"mp41",
			"mp42",
			"avc1",
			"M4V ",
			"dash",
			"mmp4",
			"3gp4",
			"3gp5",
			"3gp6",
		].map((brand) => [brand, "video/mp4"]),
	),
};

/**
 * A file's type, read from its first 64 KiB at most (SNIFF_PREFIX): one of the media both apps draw, or else
 * application/octet-stream, a file that is only ever downloaded, as a HEIC and a PDF are. What its sender says it is
 * counts for nothing: a page or an SVG that calls itself a picture is no picture.
 */
export function sniffType(file: Uint8Array): string {
	const bytes = file.subarray(0, SNIFF_PREFIX);
	const at = (offset: number, ...expected: number[]) => expected.every((byte, i) => bytes[offset + i] === byte);
	const text = (offset: number, ascii: string) => at(offset, ...Array.from(ascii, (c) => c.charCodeAt(0)));
	if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
	if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
	if (text(0, "GIF87a") || text(0, "GIF89a")) return "image/gif";
	if (text(0, "RIFF") && text(8, "WEBP")) return "image/webp";
	if (text(0, "RIFF") && text(8, "WAVE")) return "audio/wav";
	if (text(4, "ftyp") && bytes.length >= 12)
		return BRANDS[String.fromCharCode(...bytes.subarray(8, 12))] ?? OCTET_STREAM;
	if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return webmType(bytes) ?? OCTET_STREAM;
	if (text(0, "OggS")) return "audio/ogg";
	if (text(0, "fLaC")) return "audio/flac";
	if (text(0, "ID3") || (bytes[0] === 0xff && bytes[1] !== undefined && [0xfb, 0xfa, 0xf3, 0xf2].includes(bytes[1]))) {
		return "audio/mpeg";
	}
	return OCTET_STREAM;
}

// The EBML elements a WebM's type is read from (Matroska's specification).
const EBML = 0x1a45dfa3;
const DOC_TYPE = 0x4282;
const SEGMENT = 0x18538067;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_TYPE = 0x83;
const CLUSTER = 0x1f43b675;
const WEBM = [0x77, 0x65, 0x62, 0x6d]; // a DocType of "webm"

/**
 * A WebM's type, by its tracks: audio when none is video (MediaRecorder's voice notes, the desktop's), else video. Null
 * for anything else: a Matroska that isn't a WebM, or one whose tracks aren't in the bytes it has.
 */
function webmType(bytes: Uint8Array): string | null {
	let at = 0;
	// A variable-length integer: its length is its first byte's leading zeros, plus one; an ID keeps its marker.
	const vint = (id: boolean): number | null => {
		const first = bytes[at];
		if (first === undefined || first === 0) return null;
		const length = Math.clz32(first) - 23;
		if (at + length > bytes.length) return null;
		let value = id ? first : first & (0xff >> length);
		for (let i = 1; i < length; i++) value = value * 256 + bytes[at + i]!;
		at += length;
		return value;
	};
	// An element's ID and where its data ends: an unknown size (all ones) runs to the end of what there is.
	const element = () => {
		const id = vint(true);
		const size = vint(false);
		return id === null || size === null ? null : { id, end: Math.min(at + size, bytes.length) };
	};
	const header = element();
	if (header?.id !== EBML) return null;
	let webm = false;
	while (at < header.end) {
		const child = element();
		if (!child) return null;
		if (child.id === DOC_TYPE) webm = child.end - at === WEBM.length && WEBM.every((byte, i) => bytes[at + i] === byte);
		at = child.end;
	}
	const segment = element();
	if (!webm || segment?.id !== SEGMENT) return null;
	let audio = false;
	while (at < segment.end) {
		const child = element();
		// The tracks come before the first cluster.
		if (!child || child.id === CLUSTER) break;
		while (child.id === TRACKS && at < child.end) {
			const entry = element();
			if (!entry) return null;
			while (entry.id === TRACK_ENTRY && at < entry.end) {
				const field = element();
				if (!field) return null;
				if (field.id === TRACK_TYPE && field.end === at + 1 && bytes[at] === 1) return "video/webm";
				if (field.id === TRACK_TYPE && field.end === at + 1 && bytes[at] === 2) audio = true;
				at = field.end;
			}
			at = entry.end;
		}
		at = child.end;
	}
	return audio ? "audio/webm" : null;
}

export type ApprovalStep = "commitment" | "offer" | "reveal" | "transfer";

/** A step of a device's approval, as one device sends it to another through the inbox: the core's bytes in base64. */
export interface ApprovalFrame {
	duvet: "approval";
	step: ApprovalStep;
	data: string;
	/** The new device's name, which the device approving it shows. */
	name?: string;
}

const STEPS: readonly string[] = ["commitment", "offer", "reveal", "transfer"] satisfies ApprovalStep[];
const isStep = (value: unknown): value is ApprovalStep => typeof value === "string" && STEPS.includes(value);
const FRAME_FIELDS: readonly string[] = ["duvet", "step", "data", "name"];
// Standard base64, padded, as the core writes binaries.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** The most characters a device's name has, counted by code point. */
export const MAX_DEVICE_NAME = 64;

/** An approval frame as the inbox's message carries it: its JSON in UTF-8, its fields in this order, in base64. */
export function approvalFrameMessage({ step, data, name }: ApprovalFrame): string {
	const frame = { duvet: "approval", step, data, ...(name === undefined ? {} : { name }) };
	return bytesBase64(new TextEncoder().encode(JSON.stringify(frame)));
}

/**
 * The approval frame an inbox message is, or null, when it's a message of the core between devices (receive_direct's).
 * A frame is JSON with duvet "approval", one of the four steps, its data in base64, a name of 64 characters at most if
 * any, and nothing else.
 */
export function readApprovalFrame(message: string): ApprovalFrame | null {
	let value: unknown;
	try {
		// A byte order mark stays for JSON to refuse, as Dart's utf8.decode keeps it in the mobile app.
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(base64Bytes(message)));
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	if (Object.keys(value).some((key) => !FRAME_FIELDS.includes(key))) return null;
	const [duvet, step, data, name]: unknown[] = FRAME_FIELDS.map((field) => Reflect.get(value, field));
	if (duvet !== "approval" || !isStep(step)) return null;
	if (typeof data !== "string" || !data || !BASE64.test(data)) return null;
	// The approving device shows the name: it loses what doesn't show, as a file's name does.
	const shown = typeof name === "string" ? visible(name).trim() : name;
	if (shown !== undefined && (typeof shown !== "string" || !shown || Array.from(shown).length > MAX_DEVICE_NAME)) {
		return null;
	}
	return { duvet, step, data, ...(shown === undefined ? {} : { name: shown }) };
}

const FINGERPRINT_LABEL = new TextEncoder().encode("duvet approval fingerprint v1");

/**
 * The fingerprint of a device's approval (Ruling 35), which the approving computer's box names and the new device's
 * screen shows, for the person to compare: SHA-256 over `duvet approval fingerprint v1` and the commitment's bytes, as
 * its frame carries them, which bind all that the core certifies. Its first 8 bytes, in 16 lowercase hex digits, in
 * four groups of four.
 */
export async function approvalFingerprint(commitment: Uint8Array): Promise<string> {
	const input = new Uint8Array(FINGERPRINT_LABEL.length + commitment.length);
	input.set(FINGERPRINT_LABEL);
	input.set(commitment, FINGERPRINT_LABEL.length);
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
	const hex = Array.from(digest.subarray(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 4)} ${hex.slice(4, 8)} ${hex.slice(8, 12)} ${hex.slice(12, 16)}`;
}
