import { afterAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FetchError } from "$lib/api/api";
import type { Identity, InboxMessage } from "$lib/api/e2e";
import { imageSize } from "$lib/image-size";
import { asMap, cbor, certificateDevice, commitmentDevice, listDevices } from "./cbor";
import {
	approvalFrameMessage,
	cleanName,
	drawnAs,
	MAX_DEVICE_NAME,
	MAX_FILE_NAME,
	readApprovalFrame,
	SNIFF_PREFIX,
	sniffType,
	THUMBNAIL_SIDE,
	thumbnailDrawn,
	WAVEFORM_SAMPLES,
	type ApprovalFrame,
} from "./conventions";
import type { EngineParts } from "./engine/engine";
import { shownFile } from "./engine/files";
import { takeInbox } from "./engine/inbox";
import { KEPT_APPROVALS } from "./engine/store";
import { entryOf, messageEntry } from "./engine/sync";
import { CoreError } from "./errors";
import type { EngineEvent } from "./events";
import conventions from "./testing/e2e-conventions.json";
import {
	base64,
	base64As,
	cborBytes,
	cborDepth,
	cborLengths,
	cborValue,
	json,
	Kept,
	mutate,
	mutateText,
	Random,
	runs,
	SEED,
	text,
	timed,
	unbase64,
	type CborValue,
} from "./testing/fuzz";
import { coreLibrary } from "./testing/host-bun";

// Step 5's fuzzing (PLAN-E2E-CLIENTES.md, «Lo que el paso 5 revisa»): what the client reads on its own, of another
// person's device or of the server, whatever it holds. Each reader answers its refusal and never throws, ends within the
// budget (BUDGET_MS an input), and what it answers keeps its invariants. Each takes its hand-picked inputs first (what
// the fuzzers found, and where the two apps' platforms read differently), then a fixed seed's: a few thousand a reader
// in CI, DUVET_FUZZ_RUNS for a long run. DUVET_FUZZ_CORPUS=write writes e2e-fuzz-corpus.json of what a run kept (with
// a core, for its seeds; then Prettier formats it), which fuzz-corpus.test.ts holds this app to, and the mobile app's
// fuzz task its own readers.

// Thousands of inputs a reader: on a loaded runner, past bun's 5 s a test; a long run's, hours.
setDefaultTimeout(process.env.DUVET_FUZZ_RUNS ? 6 * 3_600_000 : 60_000);

const CORPUS = join(import.meta.dir, "testing/e2e-fuzz-corpus.json");
const WRITE = process.env.DUVET_FUZZ_CORPUS === "write";
const stored: Record<string, any> = existsSync(CORPUS) ? JSON.parse(readFileSync(CORPUS, "utf8")) : {};
const kept = new Kept();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Every hidden character, an expression of its own: the module's is its own.
const HIDDEN = /[\p{Cc}\p{Zl}\p{Zp}]|(?!\u200D)\p{Cf}/u;
const STEPS = ["commitment", "offer", "reveal", "transfer"] as const;
const OCTET = "application/octet-stream";
const TYPES = new Set([
	...["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "audio/wav", "audio/mp4", "audio/ogg"],
	...["audio/flac", "audio/mpeg", "audio/webm", "video/mp4", "video/quicktime", "video/webm", OCTET],
]);
const codePoints = (value: string) => Array.from(value).length;
/** A value in a typed place, as another device or the server may send one: a reader takes it, whatever it is. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a reader's input is its sender's word, of any type
const sent = <T>(value: unknown): T => value as T;
/** A field of what may be an object, as a reader reads it. */
const fieldOf = (value: unknown, key: string): unknown => (isObject(value) ? value[key] : undefined);
const isObject = (value: unknown): value is Record<string, any> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
/** Base64 as the core and the API write it: what `base64` writes again of what `atob` reads. */
const canonical = (value: string) => {
	const bytes = unbase64(value);
	return bytes !== null && base64(bytes) === value;
};
/** JSON both apps read alike: no number but a whole one JS holds exactly (Dart reads 1.0 and 1e3 as doubles). */
const portable = (value: unknown): boolean =>
	typeof value === "number"
		? Number.isSafeInteger(value)
		: typeof value === "object" && value !== null
			? Object.values(value).every(portable)
			: true;

/**
 * What a real core made: a certificate, a device list and an approval's commitment, and the devices they name. Made
 * again when the corpus is written (it takes a core), else read from it.
 */
interface Seeds {
	certificate: string;
	device_list: string;
	commitment: string;
	certificate_device: string;
	list_devices: string[];
	commitment_device: string;
}

async function madeSeeds(): Promise<Seeds | null> {
	if (!WRITE) return sent<Seeds | undefined>(stored.seeds) ?? null;
	if (!coreLibrary)
		throw new Error("writing the corpus takes a core: DUVET_E2E_FFI, or native/core's for this platform");
	const { BunCoreHost } = await import("./testing/host-bun");
	const { uuidv7 } = await import("./uuid");
	const [user, device, other] = [uuidv7(), uuidv7(), uuidv7()];
	const [first, second] = [new BunCoreHost(), new BunCoreHost()];
	try {
		await first.open(user);
		await first.handle({ cmd: "create_device", user_id: user, device_id: device });
		const made = await first.handle<{ certificate: string; device_list: string }>({ cmd: "create_identity" });
		await second.open(user);
		await second.handle({ cmd: "create_device", user_id: user, device_id: other });
		const { commitment } = await second.handle<{ commitment: string }>({ cmd: "approval_begin" });
		return {
			...{ certificate: made.certificate, device_list: made.device_list, commitment },
			...{ certificate_device: device, list_devices: [device], commitment_device: other },
		};
	} finally {
		for (const host of [first, second]) rmSync(host.folder, { recursive: true, force: true });
	}
}
const seeds = await madeSeeds();

afterAll(() => {
	if (!WRITE) return;
	const readers = {
		approval_frames: "readApprovalFrame(message): the frame, or null",
		names: "cleanName(name): clean",
		types: "sniffType(bytes): type",
		thumbnails: "thumbnailDrawn(bytes): drawn",
		drawn: "drawnAs({text, attachments}, sticker): drawn",
		cbor: "cbor(bytes) reads a value (read) or refuses (null)",
		certificates: "certificateDevice(certificate): device, or null",
		device_lists: "listDevices(list): devices, or null",
		commitments: "commitmentDevice(commitment): device, or null",
		shown_files: "shownFile(file): shown, or null",
		event_entries:
			"the entry an event carries (entryOf; a DM_MESSAGE_CREATE's, messageEntry): {id, entry, generation?}, or null",
	};
	const about =
		"What step 5's fuzzing of the desktop's readers kept (PLAN-E2E-CLIENTES.md, «Lo que el paso 5 revisa»): inputs " +
		"of another device or of the server, each with the desktop's answer, hand-picked ones first. desktop-electrobun's " +
		"src/mainview/src/lib/e2e/fuzz-corpus.test.ts holds the desktop to it, and the mobile app's fuzz task holds its " +
		"own readers to the same answers: where they differ, the two engines separate. Bytes are standard base64; null " +
		"is a reader's refusal. Written by fuzz.test.ts with DUVET_FUZZ_CORPUS=write; `seeds` a real core made.";
	writeFileSync(CORPUS, `${JSON.stringify({ about, readers, seed: SEED, seeds, ...kept.cases }, null, "\t")}\n`);
});

describe("what the client reads of others", () => {
	test("an approval frame in the inbox", () => {
		const rng = new Random(SEED);
		const picked = PICKED.frames();
		const fixtures = conventions.approval_frames.map((c) => c.message);
		const frameJson = (): Record<string, unknown> => {
			const fields: Record<string, unknown> = {};
			const good: Record<string, () => unknown> = {
				duvet: () => "approval",
				step: () => rng.pick(STEPS),
				data: () => base64(rng.bytes(1 + rng.int(64))),
				name: () => text(rng, 70),
			};
			for (const key of ["duvet", "step", "data", "name", "extra"]) {
				if (rng.chance(key === "extra" ? 0.1 : key === "name" ? 0.6 : 0.95)) {
					fields[key] = rng.chance(0.85) && good[key] ? good[key]() : json(rng);
				}
			}
			return fields;
		};
		const inputs: (() => [string, string])[] = [
			() => ["written", approvalFrameMessage(sent<ApprovalFrame>(frameJson()))],
			() => {
				let bytes: Uint8Array = new TextEncoder().encode(
					JSON.stringify(frameJson(), null, rng.chance(0.2) ? 2 : undefined),
				);
				if (rng.chance(0.1)) bytes = concat([0xef, 0xbb, 0xbf], bytes);
				if (rng.chance(0.2)) bytes = mutate(rng, bytes);
				return ["json", base64As(rng, bytes)];
			},
			() => ["mutated", base64As(rng, mutate(rng, unbase64(rng.pick(fixtures)) ?? new Uint8Array()))],
			() => ["text", mutateText(rng, rng.pick(fixtures))],
			() => ["bytes", base64As(rng, rng.bytes(rng.size(64)))],
			() => ["anything", text(rng, 40)],
		];
		for (let n = 0; n < picked.length + runs(4000); n++) {
			const [how, message] = n < picked.length ? ["picked", picked[n]!] : rng.pick(inputs)();
			const frame = timed(
				() => readApprovalFrame(message),
				() => message,
			);
			if (WRITE) {
				const signature = `${how}:${frame ? `${frame.step}:${"name" in frame}` : "none"}:${canonical(message)}`;
				kept.keep("approval_frames", signature, { message, frame }, how === "picked");
			}
			if (!frame) continue;
			expect(Object.keys(frame).every((key) => ["duvet", "step", "data", "name"].includes(key))).toBe(true);
			expect(frame.duvet).toBe("approval");
			expect(STEPS).toContain(frame.step);
			// Read of base64 in its one form, its data too, which both apps decode alike.
			expect(canonical(message)).toBe(true);
			expect(frame.data !== "" && canonical(frame.data)).toBe(true);
			if (frame.name !== undefined) {
				const name = frame.name;
				expect(HIDDEN.test(name) || !name.isWellFormed() || name !== name.trim()).toBe(false);
				expect(codePoints(name) >= 1 && codePoints(name) <= MAX_DEVICE_NAME).toBe(true);
			}
			// A frame it reads writes back to the same frame.
			expect(readApprovalFrame(approvalFrameMessage(frame))).toEqual(frame);
		}
	});

	test("a file's name", () => {
		const rng = new Random(SEED + 1);
		const picked = PICKED.names;
		const fixtures = conventions.names.map((c) => c.name);
		const inputs: (() => [string, string])[] = [
			() => ["text", text(rng, 300)],
			() => ["path", Array.from({ length: 1 + rng.int(4) }, () => text(rng, 12)).join(rng.pick(["/", "\\"]))],
			() => ["fixture", mutateText(rng, rng.pick(fixtures))],
			() => ["long", text(rng, 4).repeat(40 + rng.int(80))],
		];
		for (let n = 0; n < picked.length + runs(4000); n++) {
			const [how, name] = n < picked.length ? ["picked", picked[n]!] : rng.pick(inputs)();
			const clean = timed(
				() => cleanName(name),
				() => name,
			);
			if (WRITE && name.length <= 600) {
				const shape = clean === name ? "same" : clean === "file" ? "file" : "cleaned";
				const signature = `${how}:${shape}:${codePoints(clean) === MAX_FILE_NAME}:${name.isWellFormed()}`;
				kept.keep("names", signature, { name, clean }, how === "picked");
			}
			// No separator nor hidden character, well formed, trimmed, 255 code points at most, never empty, . or ..
			expect(/[/\\]/.test(clean) || HIDDEN.test(clean) || !clean.isWellFormed() || clean !== clean.trim()).toBe(false);
			expect(codePoints(clean) >= 1 && codePoints(clean) <= MAX_FILE_NAME).toBe(true);
			expect(["", ".", ".."]).not.toContain(clean);
			// Cleaned once is clean.
			expect(cleanName(clean)).toBe(clean);
		}
	});

	test("a file's type, by its bytes", () => {
		const rng = new Random(SEED + 2);
		const picked = PICKED.types();
		// The fixture's cases without their runs of zeros (conventions.test.ts has them whole): what's mutated here.
		const fixtures = conventions.types.map((c) => concat(unbase64(c.bytes) ?? [], unbase64(c.tail ?? "") ?? []));
		const webms: Uint8Array[] = [];
		for (let n = 0; n < picked.length + runs(4000); n++) {
			let bytes: Uint8Array;
			let expected: string | null = null;
			const how = n < picked.length ? "picked" : rng.pick(["webm", "webm", "mutated", "fixture", "bytes", "long"]);
			if (how === "picked") [bytes, expected] = picked[n]!;
			else if (how === "webm") {
				[bytes, expected] = webm(rng);
				// The latest few, for the mutations: a long run's inputs would fill the memory.
				webms[webms.length < 64 ? webms.length : rng.int(64)] = bytes;
			} else if (how === "mutated" || how === "fixture") {
				bytes = mutate(rng, rng.pick(how === "fixture" || !webms.length ? fixtures : webms), fixtures);
			} else if (how === "long") {
				// A file past the 64 KiB read, whose bytes there count for nothing.
				bytes = new Uint8Array(SNIFF_PREFIX + 1 + rng.int(100));
				bytes.set(rng.pick(fixtures).subarray(0, SNIFF_PREFIX));
				bytes.set(rng.bytes(bytes.length - SNIFF_PREFIX), SNIFF_PREFIX);
			} else bytes = rng.bytes(rng.size(64));
			const type = timed(
				() => sniffType(bytes),
				() => base64(bytes.subarray(0, 300)),
			);
			if (WRITE && bytes.length <= 1024) {
				kept.keep("types", `${how}:${type}`, { bytes: base64(bytes), type }, how === "picked");
			}
			expect(TYPES.has(type)).toBe(true);
			// Its first 64 KiB alone say what it is.
			if (bytes.length > SNIFF_PREFIX) expect(sniffType(bytes.subarray(0, SNIFF_PREFIX))).toBe(type);
			// One made here is what it was made as: a WebM by its tracks, video with one of video, else audio with one.
			if (expected) expect(type).toBe(expected);
		}
	});

	test("an image's size by its header, and whether a thumbnail is drawn", () => {
		const rng = new Random(SEED + 3);
		const picked = PICKED.images();
		const made: Uint8Array[] = [];
		const makers: Record<string, (rng: Random) => [Uint8Array, { width: number; height: number } | null]> = {
			png: pngOf,
			jpeg: jpegOf,
			gif: gifOf,
			webp: webpOf,
		};
		for (let n = 0; n < picked.length + runs(4000); n++) {
			const how =
				n < picked.length ? "picked" : rng.pick(["png", "jpeg", "gif", "webp", "mutated", "mutated", "bytes"]);
			let bytes: Uint8Array;
			let size: { width: number; height: number } | null | undefined;
			if (how === "picked") [bytes, size] = picked[n]!;
			else if (how === "mutated" && made.length) bytes = mutate(rng, rng.pick(made), made);
			else if (how === "bytes" || how === "mutated") bytes = rng.bytes(rng.size(40));
			else {
				[bytes, size] = makers[how]!(rng);
				made[made.length < 64 ? made.length : rng.int(64)] = bytes;
			}
			const read = timed(
				() => imageSize(bytes),
				() => base64(bytes.subarray(0, 300)),
			);
			const drawn = thumbnailDrawn(bytes);
			if (WRITE && bytes.length <= 1024) {
				kept.keep("thumbnails", `${how}:${drawn}:${read !== null}`, { bytes: base64(bytes), drawn }, how === "picked");
			}
			if (read) {
				expect(Number.isSafeInteger(read.width) && Number.isSafeInteger(read.height)).toBe(true);
				expect(read.width >= 0 && read.height >= 0 && read.width < 2 ** 32 && read.height < 2 ** 32).toBe(true);
			}
			// What an image made here says it is; a thumbnail drawn only as a JPEG or a PNG of 320 a side at most.
			if (size !== undefined) expect(read).toEqual(size);
			const small = !!read && read.width > 0 && read.height > 0 && Math.max(read.width, read.height) <= THUMBNAIL_SIDE;
			expect(drawn).toBe(small && ["image/jpeg", "image/png"].includes(sniffType(bytes)));
		}
	});

	test("what a message the core shows is drawn as", () => {
		const rng = new Random(SEED + 4);
		const picked = PICKED.drawn();
		const field = (key: string): unknown => {
			if (rng.chance(0.15)) return json(rng);
			if (key === "type")
				return rng.pick(["audio/ogg", "audio/webm", "audio/", "AUDIO/ogg", "video/mp4", "", text(rng, 8)]);
			if (key === "duration_ms") return rng.pick([0, 1500, -1, 1.5, "1500", null, 2 ** 53]);
			return rng.chance(0.6) ? base64As(rng, rng.bytes(rng.pick([64, 64, 63, 65, 0]))) : text(rng, 8);
		};
		const attachment = (): unknown => {
			if (rng.chance(0.05)) return json(rng, 1);
			const keys = ["type", "duration_ms", "waveform"].filter(() => rng.chance(0.85));
			return Object.fromEntries(keys.map((key) => [key, field(key)]));
		};
		for (let n = 0; n < picked.length + runs(4000); n++) {
			const [message, sticker] =
				n < picked.length
					? picked[n]!
					: [
							sent<Parameters<typeof drawnAs>[0]>({
								text: rng.pick([null, "", text(rng, 10)]),
								attachments: Array.from({ length: rng.pick([0, 1, 1, 1, 2, 3]) }, attachment),
							}),
							rng.chance(),
						];
			const drawn = timed(
				() => drawnAs(message, sticker),
				() => message,
			);
			const [file, ...more]: unknown[] = [...message.attachments];
			const [type, waveform] = [fieldOf(file, "type"), fieldOf(file, "waveform")];
			const voice =
				!message.text &&
				!more.length &&
				typeof type === "string" &&
				type.startsWith("audio/") &&
				typeof fieldOf(file, "duration_ms") === "number" &&
				typeof waveform === "string" &&
				canonical(waveform) &&
				unbase64(waveform)!.length === WAVEFORM_SAMPLES;
			if (WRITE && portable(message)) {
				const shape = isObject(file) ? Object.keys(file).sort().join(",") : typeof file;
				const signature = `${drawn}:${message.attachments.length}:${shape}`;
				kept.keep("drawn", signature, { message, sticker, drawn }, n < picked.length);
			}
			expect(drawn).toBe(!message.text && !file ? (sticker ? "sticker" : "nothing") : voice ? "voice_note" : "message");
		}
	});

	test("the CBOR of a certificate, a device list or a commitment", () => {
		const rng = new Random(SEED + 5);
		const picked = PICKED.cbor();
		const seeded = seeds ? [seeds.certificate, seeds.device_list, seeds.commitment].map((s) => unbase64(s)!) : [];
		const bodies = seeded.flatMap((bytes) => {
			const body = asMap(cbor(bytes))?.get("body");
			return body instanceof Uint8Array ? [body] : [];
		});
		const pool = [...seeded, ...bodies];
		const exact = (v: CborValue): boolean =>
			typeof v === "number"
				? Number.isSafeInteger(v)
				: Array.isArray(v)
					? v.every(exact)
					: !(v instanceof Map) || [...v.values()].every(exact);
		const UNWRITTEN = [0x1c, 0x1f, 0x3f, 0x5f, 0x7f, 0x9f, 0xbf, 0xc0, 0xd8, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xff, 0xe0];
		const kinds = ["value", "value", "mutated", "seed", "lying", "deep", "unwritten", "bytes"];
		for (let n = 0; n < picked.length + runs(4000); n++) {
			const how = n < picked.length ? "picked" : rng.pick(kinds);
			let bytes: Uint8Array;
			let value: CborValue | undefined;
			let read: boolean | undefined;
			switch (how) {
				case "picked":
					[bytes, read] = picked[n]!;
					break;
				case "value":
					value = cborValue(rng);
					bytes = cborBytes(value, rng);
					break;
				case "mutated":
					bytes = mutate(rng, pool.length && rng.chance() ? rng.pick(pool) : cborBytes(cborValue(rng)), pool);
					break;
				case "seed":
					bytes = pool.length ? rng.pick(pool) : cborBytes(cborValue(rng));
					break;
				case "lying": {
					// Bytes, a text, a list or a map of a length of 4 or 8 bytes, past 2^63 at times, and little after it.
					const wide = rng.chance();
					const length = wide ? [rng.chance() ? 0xff : rng.int(256), ...rng.bytes(7)] : rng.bytes(4);
					bytes = concat([rng.pick([0x40, 0x60, 0x80, 0xa0]) | (wide ? 27 : 26)], length, rng.bytes(rng.int(16)));
					break;
				}
				case "deep": {
					// Lists or maps in each other, at times past the reader's 33 levels.
					const levels = 28 + rng.int(10);
					bytes = deep(levels, () => rng.chance());
					read = levels <= 33;
					break;
				}
				case "unwritten":
					bytes = concat([rng.pick(UNWRITTEN)], rng.bytes(rng.int(9)));
					read = false;
					break;
				default:
					bytes = rng.bytes(rng.size(64));
			}
			const result = timed(
				() => cbor(bytes),
				() => base64(bytes.subarray(0, 300)),
			);
			if (WRITE && bytes.length <= 1024) {
				kept.keep(
					"cbor",
					`${how}:${result !== null}`,
					{ bytes: base64(bytes), read: result !== null },
					how === "picked",
				);
			}
			if (read !== undefined) expect(result !== null).toBe(read);
			if (value !== undefined) expect(result).toEqual(value);
			if (result === null) continue;
			// Lists and maps 33 deep at most, and no length past what its bytes hold.
			expect(cborDepth(result)).toBeLessThanOrEqual(33);
			expect(Math.max(0, ...cborLengths(result))).toBeLessThanOrEqual(bytes.length);
			// Read again from its own CBOR, it's the same value (of numbers JS holds exactly).
			if (exact(result)) expect(cbor(cborBytes(result))).toEqual(result);
		}
	});

	test("which device a certificate or a commitment names, and which devices a list names", () => {
		const rng = new Random(SEED + 6);
		if (seeds) {
			expect(certificateDevice(seeds.certificate)).toBe(seeds.certificate_device);
			expect(listDevices(seeds.device_list)).toEqual(seeds.list_devices);
			expect(commitmentDevice(seeds.commitment)).toBe(seeds.commitment_device);
		}
		const picked = PICKED.signed();
		const made = (): [string, Uint8Array] => {
			const devices = Array.from({ length: rng.int(21) }, () => (rng.chance(0.95) ? rng.bytes(16) : cborValue(rng, 1)));
			switch (rng.int(3)) {
				case 0: {
					const device = rng.chance(0.9) ? rng.bytes(16) : cborValue(rng, 1);
					return [
						"certificate",
						signed(
							new Map<string, CborValue>([
								["user", rng.bytes(16)],
								["device", device],
							]),
						),
					];
				}
				case 1: {
					const body = new Map<string, CborValue>([["devices", devices]]);
					if (rng.chance(0.8)) body.set("version", rng.chance(0.9) ? rng.int(1000) : cborValue(rng, 1));
					return ["list", signed(body)];
				}
				default:
					return [
						"commitment",
						cborBytes(
							new Map<string, CborValue>([
								["v", 1],
								["device", rng.bytes(16)],
							]),
						),
					];
			}
		};
		const pool = seeds ? [seeds.certificate, seeds.device_list, seeds.commitment].map((s) => unbase64(s)!) : [];
		for (let n = 0; n < picked.length + runs(4000); n++) {
			let kind: string;
			let given: string;
			if (n < picked.length) [kind, given] = ["picked", picked[n]!];
			else {
				let bytes: Uint8Array;
				[kind, bytes] = rng.chance(0.6) || !pool.length ? made() : ["seed", mutate(rng, rng.pick(pool), pool)];
				given = rng.chance(0.8) ? base64(bytes) : base64As(rng, bytes);
			}
			const [device, devices, committed] = timed(
				() => [certificateDevice(given), listDevices(given), commitmentDevice(given)] as const,
				() => given,
			);
			if (WRITE) {
				const [form, picks] = [canonical(given), kind === "picked"];
				kept.keep("certificates", `${kind}:${device !== null}:${form}`, { certificate: given, device }, picks);
				kept.keep("device_lists", `${kind}:${devices?.length ?? null}:${form}`, { list: given, devices }, picks);
				kept.keep(
					"commitments",
					`${kind}:${committed !== null}:${form}`,
					{ commitment: given, device: committed },
					picks,
				);
			}
			for (const id of [device, committed, ...(devices ?? [])]) if (id !== null) expect(id).toMatch(UUID);
			// Read only of base64 as the API and the core write it, which both apps decode alike.
			if (device !== null || devices !== null || committed !== null) expect(canonical(given)).toBe(true);
		}
	});

	test("an event's entry, and a message's", () => {
		const rng = new Random(SEED + 8);
		const picked = PICKED.events();
		const counts = (...values: unknown[]) =>
			values.every((v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0);
		const KEYS = ["id", "conversation_id", "author_id", "ciphertext", "seq", "sent_at", "generation", "epoch"];
		const EVENTS = [
			"DM_MESSAGE_CREATE",
			"MLS_COMMIT",
			"MLS_WELCOME",
			"MLS_PROPOSAL",
			"DM_MESSAGE_UPDATE",
			"DM_MESSAGE_DELETE",
		];
		for (let n = 0; n < picked.length + runs(4000); n++) {
			let event: EngineEvent;
			if (n < picked.length) event = picked[n]!;
			else {
				const type = rng.chance(0.05) ? rng.pick(["DEVICE_ADD", "READY", "KEY_PACKAGES_LOW"]) : rng.pick(EVENTS);
				let data: unknown = type === "DM_MESSAGE_CREATE" ? messageOf(rng) : mlsEventOf(rng);
				// What the server may send instead: a field gone, or of another kind; or data that isn't an object.
				if (rng.chance(0.05)) data = json(rng, 1);
				else if (isObject(data) && rng.chance(0.6)) {
					const entry = data.entry;
					const target = type === "DM_MESSAGE_CREATE" || rng.chance() || !isObject(entry) ? data : entry;
					const keys =
						target === data
							? [...KEYS, "sender_device_id", "entry", "mentions", "referenced_message"]
							: ["seq", "kind"];
					const key = rng.pick(keys);
					if (rng.chance(0.4)) delete target[key];
					else target[key] = rng.chance(0.5) ? rng.pick(["5", -1, 1.5, null, 2 ** 53, "", [], {}]) : json(rng, 1);
				}
				event = sent<EngineEvent>({ type, data });
			}
			const { type, data } = event as { type: string; data: unknown };
			const read = timed(
				() => entryOf(event),
				() => event,
			);
			const what = read && JSON.parse(JSON.stringify(read));
			if (WRITE && portable(event)) {
				const fields = isObject(data) ? Object.keys(data).sort().join(",") : typeof data;
				kept.keep("event_entries", `${type}:${read === null}:${fields}`, { event, entry: what }, n < picked.length);
			}
			if (type === "DM_MESSAGE_CREATE") {
				const m = isObject(data) ? data : {};
				const reads =
					isObject(data) &&
					typeof m.conversation_id === "string" &&
					m.conversation_id !== "" &&
					counts(m.seq, m.generation, m.epoch) &&
					Number.isSafeInteger(m.sent_at);
				expect(read !== null).toBe(reads);
				expect(messageEntry(sent(data)) === null).toBe(read === null);
				if (!read) continue;
				// Its number, kind, sender, device and message ID are the message's own, and nothing it didn't carry.
				const reply = isObject(m.referenced_message) ? m.referenced_message.message_id : undefined;
				const entry = {
					...{ seq: m.seq, kind: "message", data: m.ciphertext ?? null, sent_at: m.sent_at, generation: m.generation },
					...{ epoch: m.epoch, message_id: m.id, sender_user: m.author_id, sender_device: m.sender_device_id },
					// Whom it mentions, as it came: kept when it has a length, as `mentions?.length` reads it.
					...(Reflect.get(Object(m.mentions ?? {}), "length") ? { mentions: m.mentions } : {}),
					...(reply ? { reply_to: reply } : {}),
				};
				expect(what).toEqual(JSON.parse(JSON.stringify({ id: m.conversation_id, entry })));
			} else if (EVENTS.includes(type)) {
				const d = isObject(data) ? data : {};
				const mls = type.startsWith("MLS_");
				const reads =
					isObject(data) &&
					typeof d.conversation_id === "string" &&
					d.conversation_id !== "" &&
					isObject(d.entry) &&
					counts(d.entry.seq) &&
					(!mls || d.generation === undefined || counts(d.generation));
				expect(read !== null).toBe(reads);
				if (!read) continue;
				// The event's own entry, of its own conversation, and its generation where it gives one.
				expect<unknown>(read.id).toBe(d.conversation_id);
				expect<unknown>(read.entry).toBe(d.entry);
				expect<unknown>(read.generation).toBe(mls ? d.generation : undefined);
			} else expect(read).toBeNull();
		}
	});

	test("the inbox's routing: an approval frame to its flow, anything else to the core", async () => {
		const rng = new Random(SEED + 9);
		const [user, other] = [rng.uuid(), rng.uuid()];
		const certificates = seeds ? [seeds.certificate] : [];
		const deviceOf = seeds?.certificate_device ?? rng.uuid();
		const answers = [
			() => ({ type: "rotation.transfer" }),
			() => ({ type: "history.key", share_id: rng.uuid(), conversation_id: rng.uuid(), user_id: other }),
			() => ({ type: "approval.transfer" }),
			...["internal", "storage", "locked", "decrypt_failed", "bad_command", "invalid"].map((code) => () => {
				throw new CoreError(code, code, code === "bad_command" && rng.chance() ? { field: "key" } : {});
			}),
			() => {
				throw new CoreError("not_found", "no code yet", { what: "code" });
			},
			() => {
				throw new CoreError("rule_violation", "relisted", { rule: "removed_device_listed" });
			},
			() => {
				throw new Error("the worker stopped");
			},
		];
		// The inbox logs each message it can't take: thousands here.
		const quiet = [spyOn(console, "error"), spyOn(console, "warn")].map((spy) => spy.mockImplementation(() => {}));
		// Counted by the messages the inbox reads, as a long run counts its inputs.
		for (let read = 0; read < runs(1500); ) {
			const records = new Map<string, unknown>();
			const store = {
				read: <T>(key: string) => sent<T | undefined>(records.get(key)) ?? null,
				write: (key: string, value: unknown) =>
					void (value === null ? records.delete(key) : records.set(key, structuredClone(value))),
			};
			const frame = () =>
				approvalFrameMessage({ duvet: "approval", step: rng.pick(STEPS), data: base64(rng.bytes(8)) });
			const messages: InboxMessage[] = Array.from({ length: rng.int(8) }, (_, i) => ({
				id: `0193a4b2-0000-7000-8000-${String(i + 1).padStart(12, "0")}`,
				from_user_id: rng.chance(0.7) ? user : other,
				from_device_id: rng.chance(0.5) ? deviceOf : rng.uuid(),
				message: rng.pick([
					frame,
					() => base64(rng.bytes(1 + rng.int(48))),
					() => base64As(rng, rng.bytes(1 + rng.int(48))),
					() => text(rng, 20),
					() => sent<string>(json(rng, 1)),
				])(),
				created_at: "2026-11-26T10:00:00Z",
			}));
			read += Math.max(1, messages.length);
			const direct: Record<string, unknown>[] = [];
			const cleared: string[] = [];
			const identity = (of: string): Identity => ({
				...{ user_id: of, identity_key: base64(rng.bytes(32)), device_list: "", device_list_version: 1 },
				...{ certificates: rng.chance(0.8) ? certificates : [text(rng, 8)], active: true, changed_at: "" },
			});
			const status = () => sent<never>({ status: rng.pick([403, 404, 500]) });
			const parts = sent<EngineParts>({
				user,
				store,
				api: {
					inbox: async (after?: string) => messages.filter((m) => !after || m.id > after),
					clearInbox: async (through: string) => void cleared.push(through),
					identity: async (of: string) => {
						if (rng.chance(0.1)) throw new FetchError("no identity", {}, status());
						return identity(of);
					},
					identities: async (users: string[]) => users.map(identity),
				},
				host: {
					handle: async (command: Record<string, unknown>) => {
						if (command.cmd !== "receive_direct") return {};
						direct.push(command);
						return rng.pick(answers)();
					},
				},
			});
			const rotated = await takeInbox(parts, new Map(), undefined, () => rng.chance(0.9));
			expect(typeof rotated).toBe("boolean");
			const frames = new Set(messages.filter((m) => readApprovalFrame(m.message) !== null).map((m) => m.message));
			// No frame reaches the core, and what does goes as it came, with a certificate only when that names a device.
			for (const command of direct) {
				expect(frames.has(sent<string>(command.message))).toBe(false);
				expect(messages.some((m) => m.message === command.message)).toBe(true);
				if (command.from_certificate !== undefined) {
					expect(certificateDevice(sent<string>(command.from_certificate))).not.toBeNull();
				}
			}
			// The record keeps the user's own frames, never another user's, and never what isn't a frame.
			for (const keptOne of store.read<InboxMessage[]>(KEPT_APPROVALS) ?? []) {
				expect(keptOne.from_user_id).toBe(user);
				expect(readApprovalFrame(keptOne.message)).not.toBeNull();
			}
			// What's deleted is through a message of the inbox, once.
			expect(cleared.length).toBeLessThanOrEqual(1);
			for (const through of cleared) expect(messages.map((m) => m.id)).toContain(through);
		}
		for (const spy of quiet) spy.mockRestore();
	});

	test("a file of a message, as its sender wrote it", () => {
		const rng = new Random(SEED + 7);
		const picked = PICKED.files();
		const ref = () => ({
			id: rng.uuid(),
			key: base64(rng.bytes(32)),
			sha256: base64(rng.bytes(32)),
			size: rng.int(1e6),
		});
		const raw = (): Record<string, unknown> => ({
			...ref(),
			name: text(rng, 60),
			type: rng.pick(["image/png", "audio/ogg", text(rng, 10)]),
			size: rng.pick([0, 1, 1024, 2 ** 31, 2 ** 53 - 1]),
			...(rng.chance()
				? { width: rng.pick([1, 320, 65_535, 65_536, 0]), height: rng.pick([1, 240, 65_535, 65_536]) }
				: {}),
			...(rng.chance(0.3) ? { duration_ms: rng.pick([0, 1500, 86_400_000, 86_400_001]) } : {}),
			...(rng.chance(0.3) ? { waveform: base64As(rng, rng.bytes(rng.pick([64, 64, 63, 65, 0]))) } : {}),
			...(rng.chance(0.3) ? { thumbnail: base64As(rng, rng.bytes(rng.pick([0, 100, 8192, 8193]))) } : {}),
			...(rng.chance(0.3) ? { thumbnail_ref: rng.chance(0.8) ? ref() : json(rng, 1) } : {}),
		});
		const FIELDS = [
			"id",
			"key",
			"sha256",
			"name",
			"type",
			"size",
			"width",
			"height",
			"duration_ms",
			"waveform",
			"thumbnail",
		];
		for (let n = 0; n < picked.length + runs(3000); n++) {
			let file: unknown;
			if (n < picked.length) file = picked[n]!;
			else {
				file = rng.chance(0.05) ? json(rng) : raw();
				if (isObject(file) && rng.chance(0.5)) {
					for (const key of FIELDS) {
						const roll = rng.int(100);
						if (roll < 8) delete file[key];
						else if (roll < 16) file[key] = json(rng, 1);
					}
				}
			}
			const shown = timed(
				() => shownFile(file),
				() => file,
			);
			if (WRITE && portable(file) && JSON.stringify(file).length <= 4_000) {
				const signature = `${shown === null}:${Object.keys(shown ?? {})
					.sort()
					.join(",")}`;
				kept.keep("shown_files", signature, { file, shown }, n < picked.length);
			}
			const at = (key: string): unknown => (isObject(file) ? file[key] : undefined);
			const [id, key, sha256, size] = ["id", "key", "sha256", "size"].map(at);
			const reads =
				isObject(file) &&
				typeof id === "string" &&
				UUID.test(id) &&
				typeof key === "string" &&
				typeof sha256 === "string" &&
				typeof size === "number" &&
				size >= 0;
			expect(shown !== null).toBe(reads);
			if (!shown) continue;
			// Each field is the sender's own, or none: never one the file didn't carry.
			const name = at("name");
			expect(shown).toMatchObject({ id, key, sha256, size, name: cleanName(typeof name === "string" ? name : "") });
			const said = at("type");
			expect(shown.said).toBe(typeof said === "string" ? said : OCTET);
			for (const property of ["width", "height", "duration_ms", "waveform", "thumbnail"] as const) {
				if (property in shown) expect<unknown>(shown[property]).toBe(at(property));
			}
			expect("width" in shown).toBe("height" in shown);
			const side = (value: unknown) =>
				typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535;
			if (shown.width !== undefined) expect(side(shown.width) && side(shown.height)).toBe(true);
			if (shown.duration_ms !== undefined) expect(shown.duration_ms <= 86_400_000).toBe(true);
			if (shown.waveform !== undefined) {
				expect(canonical(shown.waveform) && unbase64(shown.waveform)!.length === WAVEFORM_SAMPLES).toBe(true);
			}
			if (shown.thumbnail !== undefined) {
				expect(canonical(shown.thumbnail) && unbase64(shown.thumbnail)!.length <= 8192).toBe(true);
			}
			// A thumbnail of its own only where none is inside, an empty one too.
			if (shown.thumbnail_ref !== undefined) {
				expect(shown.thumbnail).toBeUndefined();
				expect<unknown>(shown.thumbnail_ref).toEqual(at("thumbnail_ref"));
			}
		}
	});
});

const concat = (...parts: ArrayLike<number>[]) => Uint8Array.from(parts.flatMap((part) => Array.from(part)));
const ascii = (value: string) => new TextEncoder().encode(value);
const bigEndian = (value: number, width: number) =>
	Array.from({ length: width }, (_, i) => Math.floor(value / 256 ** (width - 1 - i)) % 256);
const littleEndian = (value: number, width: number) => bigEndian(value, width).reverse();
/** Base64 of text in UTF-8. */
const utf8 = (value: string) => base64(new TextEncoder().encode(value));
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Base64 with a bit set past its bytes, in its last character before the padding. */
const stray = (value: string) => {
	const at = value.replace(/=+$/, "").length - 1;
	return value.slice(0, at) + ALPHABET[ALPHABET.indexOf(value[at]!) | 1] + value.slice(at + 1);
};
/** The same bytes' base64 in the other forms a writer could put it, none of them read. */
const notCanonical = (value: string) => [
	value.replace(/=+$/, ""),
	` ${value}`,
	`${value}\n`,
	`${value.slice(0, 4)}\r\n${value.slice(4)}`,
	stray(value),
	value.replaceAll("+", "-").replaceAll("/", "_"),
	value.replaceAll("=", "%3D"),
];
/** A signed object as the core writes one, `{body, sig}`, its body the value's CBOR. */
const signed = (body: CborValue) =>
	cborBytes(
		new Map<string, CborValue>([
			["body", cborBytes(body)],
			["sig", new Uint8Array(64)],
		]),
	);
/** Lists or maps in each other, `levels` of them, a map's under the key "a", an empty list innermost. */
const deep = (levels: number, list: () => boolean) =>
	concat(...Array.from({ length: levels - 1 }, () => (list() ? [0x81] : [0xa1, 0x61, 0x61])), [0x80]);
const ID = Uint8Array.from({ length: 16 }, (_, i) => i + 1);

/** An EBML element: its ID (its marker kept), its size as a variable-length integer at its shortest, then its data. */
function ebml(id: number, data: Uint8Array): Uint8Array {
	const width = [1, 2, 3, 4, 5, 6, 7, 8].find((w) => data.length < 2 ** (7 * w) - 1)!;
	const size = bigEndian(data.length, width);
	size[0]! |= 0x80 >> (width - 1);
	return concat(bigEndian(id, id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1), size, data);
}

/** A WebM's EBML header, of the doc type given. */
const webmHeader = (docType: string) =>
	ebml(0x1a45dfa3, concat(ebml(0x4286, Uint8Array.of(1)), ebml(0x4282, ascii(docType))));
/** A segment's tracks, of the types given. */
const tracksOf = (types: number[]) =>
	ebml(
		0x1654ae6b,
		concat(
			...types.map((type) =>
				ebml(0xae, concat(ebml(0xd7, Uint8Array.of(1)), ebml(0x83, Uint8Array.of(type)), ebml(0x86, ascii("V_VP8")))),
			),
		),
	);

/** A WebM's header and segment, its tracks of the types picked, and the type its tracks make it. */
function webm(rng: Random): [Uint8Array, string] {
	const docType = rng.chance(0.85) ? "webm" : rng.pick(["matroska", "webmx", "web", ""]);
	const types = Array.from({ length: rng.int(4) }, () => rng.pick([1, 2, 17, 18, 3]));
	const [info, cluster] = [ebml(0x1549a966, rng.bytes(rng.int(20))), ebml(0x1f43b675, rng.bytes(rng.int(40)))];
	const clusterFirst = rng.chance(0.15);
	const body = clusterFirst ? concat(info, cluster, tracksOf(types)) : concat(info, tracksOf(types), cluster);
	// MediaRecorder's segment has no size: all ones of 8 bytes, which runs to the end.
	const unsized = concat([0x18, 0x53, 0x80, 0x67, 0x01, ...new Array(7).fill(0xff)], body);
	const segment = rng.chance(0.3) ? unsized : ebml(0x18538067, body);
	const tracked = types.includes(1) ? "video/webm" : types.includes(2) ? "audio/webm" : OCTET;
	return [concat(webmHeader(docType), segment), docType !== "webm" || clusterFirst ? OCTET : tracked];
}

const sideOf = (rng: Random, most: number) => rng.pick([0, 1, 240, 320, 321, rng.int(400), most, rng.int(most + 1)]);
/** A PNG's signature and header, of the size given. */
const png = (width: number, height: number, tail: Uint8Array = new Uint8Array()) =>
	concat(
		[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13],
		ascii("IHDR"),
		bigEndian(width, 4),
		bigEndian(height, 4),
		[8, 6, 0, 0, 0, 0, 0, 0, 0],
		tail,
	);
/** A JPEG's start, the segments given, then a frame header of the size given. */
const jpeg = (width: number, height: number, before: number[] = [], frame = 0xc0) =>
	Uint8Array.from([0xff, 0xd8, ...before, 0xff, frame, 0, 17, 8, ...bigEndian(height, 2), ...bigEndian(width, 2), 3]);

/** A PNG's signature and header, of a size picked: what its header says. */
function pngOf(rng: Random): [Uint8Array, { width: number; height: number }] {
	const [width, height] = [sideOf(rng, 2 ** 32 - 1), sideOf(rng, 2 ** 32 - 1)];
	return [png(width, height, rng.bytes(rng.int(20))), { width, height }];
}

/** A JPEG's segments up to its first frame header, as encoders and editors put them: what that header says. */
function jpegOf(rng: Random): [Uint8Array, { width: number; height: number } | null] {
	const before: number[] = [];
	for (let n = rng.int(5); n > 0; n--) {
		const data = rng.bytes(rng.int(30));
		const segment = (marker: number) => [0xff, marker, ...bigEndian(data.length + 2, 2), ...data];
		before.push(
			...rng.pick([
				() => [0xff], // a fill byte before the next marker
				() => [0xff, rng.pick([0x01, 0xd0, 0xd3, 0xd7, 0xd8])],
				() => segment(0xe0 + rng.int(16)),
				() => segment(rng.pick([0xc4, 0xc8, 0xcc, 0xdb, 0xdd, 0xfe])),
			])(),
		);
	}
	const [width, height] = [sideOf(rng, 65_535), sideOf(rng, 65_535)];
	const frame = rng.pick([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
	return [concat(jpeg(width, height, before, frame), rng.bytes(9)), width && height ? { width, height } : null];
}

/** A GIF's screen and frames, up to its trailer, or cut before it: the size browsers draw it at. */
function gifOf(rng: Random): [Uint8Array, { width: number; height: number } | null] {
	let [width, height] = [sideOf(rng, 65_535), sideOf(rng, 65_535)];
	const table = rng.chance();
	const packed = table ? 0x80 | rng.int(8) : rng.int(8);
	const parts = [...ascii(rng.pick(["GIF87a", "GIF89a"])), ...littleEndian(width, 2), ...littleEndian(height, 2)];
	parts.push(packed, 0, 0, ...(table ? rng.bytes(3 << ((packed & 7) + 1)) : []));
	const subBlocks = () => [...Array.from({ length: rng.int(3) }, () => [4, ...rng.bytes(4)]).flat(), 0];
	for (let n = rng.int(4); n > 0; n--) {
		if (rng.chance(0.4)) {
			parts.push(0x21, rng.pick([0xf9, 0xff, 0xfe]), ...subBlocks());
			continue;
		}
		const [left, top, w, h] = [rng.int(300), rng.int(300), sideOf(rng, 2000), sideOf(rng, 2000)];
		const local = rng.chance(0.3);
		parts.push(0x2c, ...littleEndian(left, 2), ...littleEndian(top, 2), ...littleEndian(w, 2), ...littleEndian(h, 2));
		parts.push(local ? 0x81 : 0, ...(local ? rng.bytes(12) : []), 2, ...subBlocks());
		[width, height] = [Math.max(width, left + w), Math.max(height, top + h)];
	}
	const ended = rng.chance(0.85);
	if (ended) parts.push(0x3b);
	return [Uint8Array.from(parts), ended ? { width, height } : null];
}

/** A WebP's first chunk, a simple image's (VP8 or VP8L) or an extended one's canvas (VP8X): the size it says. */
function webpOf(rng: Random): [Uint8Array, { width: number; height: number }] {
	const kind = rng.pick(["VP8 ", "VP8L", "VP8X"]);
	let payload: number[];
	let size: { width: number; height: number };
	if (kind === "VP8 ") {
		size = { width: rng.int(0x4000), height: rng.int(0x4000) };
		const scaled = size.width | (rng.int(4) << 14);
		payload = [...rng.bytes(3), 0x9d, 0x01, 0x2a, ...littleEndian(scaled, 2), ...littleEndian(size.height, 2)];
	} else if (kind === "VP8L") {
		size = { width: 1 + rng.int(0x4000), height: 1 + rng.int(0x4000) };
		payload = [0x2f, ...littleEndian(size.width - 1 + (size.height - 1) * 2 ** 14 + rng.int(16) * 2 ** 28, 4)];
	} else {
		size = { width: 1 + rng.int(0x1000000), height: 1 + rng.int(0x1000000) };
		payload = [...rng.bytes(4), ...littleEndian(size.width - 1, 3), ...littleEndian(size.height - 1, 3)];
	}
	// The 30 bytes a reader takes at least.
	payload.push(...rng.bytes(10 + rng.int(10)));
	const chunk = concat(ascii(kind), littleEndian(payload.length, 4), payload);
	return [concat(ascii("RIFF"), littleEndian(chunk.length + 4, 4), ascii("WEBP"), chunk), size];
}

/** A DM_MESSAGE_CREATE's message as the API sends an encrypted one. */
function messageOf(rng: Random): Record<string, unknown> {
	return {
		...{ id: rng.uuid(), conversation_id: rng.uuid(), author_id: rng.uuid(), content: null, type: 0 },
		...{ created_at: "2026-11-26T10:00:00Z", updated_at: "2026-11-26T10:00:00Z", attachments: [], reactions: [] },
		...{ embeds: [], sticker_attachment_id: null, ciphertext: base64(rng.bytes(rng.int(48))), seq: rng.int(1000) },
		...{
			sent_at: 1_763_150_000_000 + rng.int(1e6),
			generation: rng.int(4),
			epoch: rng.int(50),
			sender_device_id: rng.uuid(),
		},
		...(rng.chance(0.3) ? { mentions: Array.from({ length: rng.int(3) }, () => rng.uuid()) } : {}),
		...(rng.chance(0.3) ? { referenced_message: { type: 0, message_id: rng.chance(0.9) ? rng.uuid() : null } } : {}),
	};
}

/** An MLS event's data as the API sends one, its entry with its data (none at times, past 16 KiB). */
function mlsEventOf(rng: Random): Record<string, unknown> {
	const entry = {
		...{ seq: rng.int(1000), kind: rng.pick(["commit", "welcome", "proposal", "message", "edit", "delete"]) },
		...{
			data: rng.chance(0.8) ? base64(rng.bytes(rng.int(48))) : null,
			sent_at: 1_763_150_000_000,
			generation: rng.int(4),
		},
		...{ epoch: rng.int(50), message_id: rng.uuid(), sender_user: rng.uuid(), sender_device: rng.uuid() },
	};
	return { conversation_id: rng.uuid(), generation: rng.int(4), epoch: rng.int(50), entry, devices: [] };
}

/**
 * The hand-picked inputs, which every run takes first and the corpus keeps: what the fuzzers found, the edges of each
 * reader, and where the two apps' platforms read differently (atob and Dart's base64Decode, JavaScript's and Dart's
 * numbers, a byte order mark, a lone surrogate).
 */
const PICKED = {
	frames(): string[] {
		const frame = { duvet: "approval", step: "offer", data: "b2Y=" } as const;
		const offer = approvalFrameMessage(frame);
		// One whose base64 has a / (a ? at every third byte of its JSON makes one), which the URL's alphabet writes as _.
		const slashed = approvalFrameMessage({ ...frame, name: "???" });
		const named = (name: string) => approvalFrameMessage({ ...frame, name });
		return [
			offer,
			...notCanonical(offer),
			...notCanonical(slashed),
			approvalFrameMessage({ ...frame, data: stray(frame.data) }),
			named("Ana\uDB40\u200B\uDC01"),
			named("Ana\uD800"),
			named("x".repeat(MAX_DEVICE_NAME)),
			named("x".repeat(MAX_DEVICE_NAME + 1)),
			named("\uD83D\uDE00".repeat(MAX_DEVICE_NAME)),
			named("  Ana  "),
			named("Ana\u0085"),
			named("\u200B\u202E"),
			named(""),
			utf8(`{"duvet":"approval","step":"offer","step":"reveal","data":"b2Y="}`),
			utf8(`{"__proto__":{},"duvet":"approval","step":"offer","data":"b2Y="}`),
			utf8(` {"duvet":"approval","step":"offer","data":"b2Y="} `),
			utf8(`\uFEFF{"duvet":"approval","step":"offer","data":"b2Y="}`),
			utf8(`{"duvet":"approval","step":"offer","data":"b2Y=","name":null}`),
			utf8(`{"duvet":"approval","step":"offer","data":"b2Y=","name":5}`),
			utf8(`{"duvet":"approval","step":"\\ud800","data":"b2Y="}`),
			utf8(`{"duvet":"approval","step":"offer","data":""}`),
			utf8(`{"duvet":"approval","step":"offer","data":"b2Y="`),
			utf8("[".repeat(20_000)),
			base64(Uint8Array.of(0xc3, 0x28)),
			"",
		];
	},
	names: [
		"invoice\uDB40\u200B\uDC01.pdf",
		"a\uD800b",
		"\uDC00",
		"\uD83D",
		"Ana\u0085",
		"\u0085file",
		"x\u180Ey",
		"\u{E0001}a\u{E0020}\u{E007F}b",
		"\u200D",
		"a\u200Db",
		"\u061Cx\u{1D173}y\u{13430}z\u0890",
		"\uFEFFname",
		"\uFFFE\u{10FFFF}",
		" . ",
		"...",
		"a/..",
		"..\\",
		"CON",
		"x".repeat(MAX_FILE_NAME),
		"x".repeat(MAX_FILE_NAME + 1),
		"\uD83D\uDE00".repeat(MAX_FILE_NAME + 1),
		` ${"x".repeat(MAX_FILE_NAME - 1)} y`,
		"a\u00A0",
		"\u3000a\u3000",
		"\u2028",
		"a\\b/c",
		"/",
		"",
	],
	types(): [Uint8Array, string][] {
		const header = webmHeader("webm");
		// A segment whose size is a byte of all ones, which here is 127 bytes, not the end: tracks past them aren't read.
		const short = (tracks: Uint8Array, before: number) =>
			concat(header, [0x18, 0x53, 0x80, 0x67, 0xff], before ? ebml(0xec, new Uint8Array(before)) : [], tracks);
		const brand = (name: string) => concat([0, 0, 0, 20], ascii("ftyp"), ascii(name), new Uint8Array(8));
		return [
			[concat(header, ebml(0x18538067, tracksOf([2]))), "audio/webm"],
			[concat(header, ebml(0x18538067, tracksOf([1, 2]))), "video/webm"],
			[concat(header, ebml(0x18538067, tracksOf([17]))), OCTET],
			[concat(webmHeader("matroska"), ebml(0x18538067, tracksOf([1]))), OCTET],
			[short(tracksOf([2]), 0), "audio/webm"],
			[short(tracksOf([2]), 130), OCTET],
			[header, OCTET],
			[brand("isom"), "video/mp4"],
			[brand("M4A "), "audio/mp4"],
			[brand("qt  "), "video/quicktime"],
			[brand("avif"), "image/avif"],
			[brand("heic"), OCTET],
			[brand("mif1"), OCTET],
			[concat(ascii("ID3"), new Uint8Array(4)), "audio/mpeg"],
			[Uint8Array.of(0xff, 0xfb, 0x90), "audio/mpeg"],
			[Uint8Array.of(0xff, 0xf1, 0x50), OCTET],
			[Uint8Array.of(0xff), OCTET],
			[concat(ascii("RIFF"), new Uint8Array(4), ascii("AVI ")), OCTET],
			[Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a), OCTET],
			[Uint8Array.of(0xff, 0xd8), OCTET],
			[ascii("GIF90a"), OCTET],
			[ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"), OCTET],
			[ascii("%PDF-1.7"), OCTET],
		];
	},
	images(): [Uint8Array, { width: number; height: number } | null][] {
		const app = [0xff, 0xe0, 0, 4, 0, 0];
		return [
			[png(THUMBNAIL_SIDE, THUMBNAIL_SIDE), { width: THUMBNAIL_SIDE, height: THUMBNAIL_SIDE }],
			[png(THUMBNAIL_SIDE + 1, 1), { width: THUMBNAIL_SIDE + 1, height: 1 }],
			[png(0, 10), { width: 0, height: 10 }],
			[png(2 ** 32 - 1, 1), { width: 2 ** 32 - 1, height: 1 }],
			[png(10, 10).subarray(0, 23), null],
			[jpeg(THUMBNAIL_SIDE, 240), { width: THUMBNAIL_SIDE, height: 240 }],
			[jpeg(12_000, 12_000), { width: 12_000, height: 12_000 }],
			[jpeg(320, 240, [0xff, 0xff, 0xd0, ...app]), { width: 320, height: 240 }],
			[jpeg(320, 0), null],
			[jpeg(320, 240).subarray(0, 10), null],
			[Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff), null],
			[Uint8Array.of(0xff, 0xd8, 0xff, 0xda, 0, 2), null],
			[jpeg(64, 64, [], 0xc4), null],
		];
	},
	drawn(): [Parameters<typeof drawnAs>[0], boolean][] {
		const waveform = base64(new Uint8Array(WAVEFORM_SAMPLES).fill(7));
		const note = (file: Record<string, unknown>, said: string | null = null) => ({ text: said, attachments: [file] });
		const voice = { type: "audio/ogg", duration_ms: 1500, waveform };
		const notes = (others: string[]) =>
			others.map((w): [Parameters<typeof drawnAs>[0], boolean] => [note({ ...voice, waveform: w }), false]);
		return [
			[note(voice), false],
			[note(voice, ""), false],
			[note(voice, "hi"), false],
			[{ text: null, attachments: [voice, voice] }, false],
			...notes(notCanonical(waveform)),
			[note({ ...voice, waveform: base64(new Uint8Array(WAVEFORM_SAMPLES - 1)) }), false],
			[note({ ...voice, duration_ms: "1500" }), false],
			[note({ ...voice, duration_ms: -1 }), false],
			[note({ ...voice, type: "audio" }), false],
			[note({ ...voice, type: "AUDIO/ogg" }), false],
			[{ text: null, attachments: [] }, true],
			[{ text: null, attachments: [] }, false],
			[{ text: "", attachments: [] }, true],
			[sent({ text: null, attachments: [null] }), false],
		];
	},
	cbor(): [Uint8Array, boolean][] {
		const big = (head: number, first: number) => Uint8Array.of(head, first, 0, 0, 0, 0, 0, 0, 0);
		return [
			[Uint8Array.of(0x9a, 0x05, 0xf5, 0xe1, 0x00), false],
			// Lengths past 2^63, which a 64-bit integer that wraps reads as below 0: an empty list or map there.
			[big(0x9b, 0x80), false],
			[big(0xbb, 0x80), false],
			[Uint8Array.of(0x9b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), false],
			[concat(big(0x9b, 0x80), [0x01]), false],
			[Uint8Array.of(0x9b, 0, 0, 0, 0, 0, 0, 0, 0), true],
			[deep(33, () => true), true],
			[deep(34, () => true), false],
			[deep(33, () => false), true],
			[deep(34, () => false), false],
			// A text's byte order mark, which the core keeps and Dart's utf8.decode drops: {"<mark>a": 1, "a": 2} has two keys.
			[Uint8Array.of(0xa1, 0x64, 0xef, 0xbb, 0xbf, 0x61, 0x01), true],
			[Uint8Array.of(0xa2, 0x64, 0xef, 0xbb, 0xbf, 0x61, 0x01, 0x61, 0x61, 0x02), true],
			[Uint8Array.of(0xa2, 0x61, 0x61, 0x01, 0x61, 0x61, 0x02), false],
			[Uint8Array.of(0xa1, 0x01, 0x02), false],
			[Uint8Array.of(0xc0, 0x00), false],
			[Uint8Array.of(0xf9, 0x00, 0x00), false],
			[Uint8Array.of(0xf7), false],
			[Uint8Array.of(0x9f, 0xff), false],
			[Uint8Array.of(0xff), false],
			[Uint8Array.of(0x01, 0x01), false],
			[Uint8Array.of(0x62, 0xc3, 0x28), false],
			[Uint8Array.of(0x63, 0xed, 0xa0, 0x80), false],
			[Uint8Array.of(0x62, 0xc0, 0x80), false],
			[Uint8Array.of(0x7b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), false],
			[Uint8Array.of(0x18, 0x01), true],
			[Uint8Array.of(0x1b, 0, 0x20, 0, 0, 0, 0, 0, 0), true],
			[Uint8Array.of(0x3b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), true],
			[new Uint8Array(), false],
		];
	},
	signed(): string[] {
		const certificate = base64(signed(new Map<string, CborValue>([["device", ID]])));
		const list = (body: [string, CborValue][]) => base64(signed(new Map<string, CborValue>(body)));
		const devices = Array.from({ length: 20 }, (_, i) => Uint8Array.from(ID, (byte) => byte ^ i));
		const commitment = base64(cborBytes(new Map<string, CborValue>([["device", ID]])));
		// A list whose devices say 2^63 of them, which a 64-bit integer that wraps reads as none, then its version.
		const wrapped = concat(
			[0xa2, 0x67],
			ascii("devices"),
			[0x9b, 0x80, 0, 0, 0, 0, 0, 0, 0, 0x67],
			ascii("version"),
			[1],
		);
		return [
			...(seeds ? [seeds.certificate, seeds.device_list, seeds.commitment] : []),
			certificate,
			...notCanonical(certificate),
			list([
				["devices", [ID]],
				["version", 1],
			]),
			list([
				["devices", devices],
				["version", 7],
			]),
			list([["devices", [ID]]]),
			list([
				["devices", [ID]],
				["version", "1"],
			]),
			list([
				["devices", [ID.subarray(1)]],
				["version", 1],
			]),
			base64(cborBytes(new Map<string, CborValue>([["body", wrapped]]))),
			commitment,
			...notCanonical(commitment),
			// A certificate whose device is under a key with a byte order mark, another key to the core: it names none.
			base64(signed(new Map<string, CborValue>([["\uFEFFdevice", ID]]))),
		];
	},
	events(): EngineEvent[] {
		const ids = Array.from({ length: 5 }, (_, i) => `0193a4b2-0000-7000-8000-00000000000${i}`);
		const message = {
			...{ id: ids[0], conversation_id: ids[1], author_id: ids[2], sender_device_id: ids[3], ciphertext: "AAAA" },
			...{ seq: 5, sent_at: 1_763_150_000_123, generation: 0, epoch: 2, content: null, type: 0 },
		};
		const entry = { seq: 5, kind: "commit", data: "AAAA", sent_at: 1, generation: 0, epoch: 2 };
		const mls = { conversation_id: ids[1], generation: 0, epoch: 2, entry };
		const event = (type: string, data: unknown) => sent<EngineEvent>({ type, data });
		const { sent_at: _, ...untimed } = message;
		const reply = { type: 0, message_id: ids[4] };
		return [
			event("DM_MESSAGE_CREATE", message),
			event("DM_MESSAGE_CREATE", { ...message, mentions: [ids[2]], referenced_message: reply }),
			event("DM_MESSAGE_CREATE", { ...message, mentions: [], referenced_message: { ...reply, message_id: null } }),
			event("DM_MESSAGE_CREATE", { ...message, ciphertext: undefined, sender_device_id: undefined }),
			event("DM_MESSAGE_CREATE", untimed),
			event("DM_MESSAGE_CREATE", { ...message, seq: "5" }),
			event("DM_MESSAGE_CREATE", { ...message, seq: -1 }),
			event("DM_MESSAGE_CREATE", { ...message, generation: null }),
			event("DM_MESSAGE_CREATE", { ...message, conversation_id: "" }),
			event("DM_MESSAGE_CREATE", { id: ids[0], conversation_id: ids[1], type: 3, content: null }),
			event("DM_MESSAGE_CREATE", null),
			event("DM_MESSAGE_CREATE", []),
			event("MLS_COMMIT", mls),
			event("MLS_WELCOME", { ...mls, devices: [ids[3]] }),
			event("MLS_PROPOSAL", { ...mls, entry: { ...entry, kind: "proposal", statement: "AAAA" } }),
			event("MLS_COMMIT", { ...mls, entry: { ...entry, data: null } }),
			event("MLS_COMMIT", { ...mls, generation: "x" }),
			event("MLS_COMMIT", { ...mls, generation: undefined }),
			event("MLS_COMMIT", { ...mls, entry: undefined }),
			event("MLS_COMMIT", { ...mls, entry: { ...entry, seq: "5" } }),
			event("MLS_COMMIT", { ...mls, conversation_id: 5 }),
			event("MLS_COMMIT", null),
			event("DM_MESSAGE_UPDATE", {
				id: ids[0],
				conversation_id: ids[1],
				edited_at: "",
				entry: { ...entry, kind: "edit" },
			}),
			event("DM_MESSAGE_DELETE", { id: ids[0], conversation_id: ids[1], entry: { ...entry, kind: "delete" } }),
			event("DM_MESSAGE_DELETE", { id: ids[0], conversation_id: ids[1] }),
			event("DEVICE_ADD", { id: ids[3] }),
		];
	},
	files(): unknown[] {
		const file = { id: "0193a4b2-0000-7000-8000-0000000000c3", key: "a2V5", sha256: "c2hh", name: "a.ogg", size: 3 };
		const ref = { id: "0193a4b2-0000-7000-8000-0000000000c4", key: "a2V5", sha256: "c2hh", size: 9 };
		const waveform = base64(new Uint8Array(WAVEFORM_SAMPLES).fill(7));
		const thumbnail = base64(new Uint8Array(100).fill(9));
		return [
			{ ...file, type: "audio/ogg", waveform, thumbnail },
			...notCanonical(waveform).map((w) => ({ ...file, waveform: w })),
			...notCanonical(thumbnail).map((t) => ({ ...file, thumbnail: t })),
			{ ...file, thumbnail: "", thumbnail_ref: ref },
			{ ...file, thumbnail_ref: ref },
			{ ...file, thumbnail: base64(new Uint8Array(8192)), thumbnail_ref: ref },
			{ ...file, thumbnail: base64(new Uint8Array(8193)), thumbnail_ref: ref },
			{ ...file, thumbnail_ref: { ...ref, id: ref.id.toUpperCase() } },
			{ ...file, name: "" },
			{ ...file, name: 5, type: 5 },
			{ ...file, size: 0 },
			{ ...file, size: 2 ** 53 - 1 },
			{ ...file, size: -1 },
			{ ...file, size: "3" },
			{ ...file, id: file.id.toUpperCase() },
			{ ...file, key: 5 },
			{ ...file, width: 65_535, height: 65_535 },
			{ ...file, width: 65_536, height: 1 },
			{ ...file, width: 320 },
			{ ...file, duration_ms: 86_400_000 },
			{ ...file, duration_ms: 86_400_001 },
			{ ...file, duration_ms: -1 },
			null,
			[],
		];
	},
};
