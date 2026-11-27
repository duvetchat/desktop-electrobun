// The desktop's half of the API's suite clients-interop (PLAN-E2E-CLIENTES.md, Task 35; Review Focus 1 and 9): this
// app's engine talking to the mobile app's (its test/e2e/interop_test.dart, which the suite runs at the same time)
// through a real API and gateway. Alice, with a second device, and Dave's first device are this app's; Bob and Carol,
// and a device of Dave's, the other's. Each side waits for what the other does through the server; what a person
// carries between two screens (a code, a QR, a recovery key, a security number) goes through the folder the suite names
// (E2E_INTEROP_DIR). The texts each side writes are the script's, the same in both files. Outside that suite, skipped.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { base64Bytes } from "$lib/activity-thumbnail";
import { sessionApi } from "$lib/api/api";
import { logIn } from "$lib/api/auth";
import type { DirectMessage } from "$lib/api/conversations";
import { e2eApi } from "$lib/api/e2e";
import { identifyData } from "$lib/api/ws/identify";
import { getWSHostURL } from "$lib/common/common";
import { listDevices } from "../cbor";
import { deviceName } from "../client";
import { drawnAs, sniffType, thumbnailDrawn } from "../conventions";
import type { ShownMessage } from "../engine/content";
import { E2EEngine, systemClock } from "../engine/engine";
import { openSealed, shownFile, type FileRef } from "../engine/files";
import { pageStore, type EngineStore } from "../engine/store";
import type { EngineEvent, EngineEvents } from "../events";
import conventions from "./e2e-conventions.json";
import { BunCoreHost } from "./host-bun";
import { useXHR } from "./xhr";

interface Account {
	id: string;
	email: string;
}

const env = process.env;
const accounts: unknown = JSON.parse(env.E2E_LIVE_ACCOUNTS ?? "[]");
const WITNESS = env.E2E_INTEROP_WITNESS ?? "";
const SHARED = env.E2E_INTEROP_DIR ?? "";
const STICKER = env.E2E_INTEROP_STICKER ?? "";
const interop =
	env.E2E_LIVE_API && WITNESS && SHARED && STICKER
		? { accounts: Array.isArray(accounts) ? accounts : [], password: env.E2E_LIVE_PASSWORD ?? "" }
		: null;
// The app reaches the API and the gateway at VITE_API_URL and VITE_WS_URL, which the preload points nowhere.
if (interop) Object.assign(globalThis, { VITE_API_URL: env.E2E_LIVE_API, VITE_WS_URL: env.E2E_LIVE_WS ?? "" });
// A message's files go up as a form, through the XMLHttpRequest Bun lacks.
useXHR();

/** The first wait on the other app, whose test is compiled first; then each step's. */
const FIRST = 8 * 60_000;
const STEP = 120_000;
/**
 * How often a wait asks the API: a route takes 64 requests a minute from a user, this device's engine's included. A
 * wait on what a core or an engine shows asks nothing, and looks every 100 ms.
 */
const POLL = 2_000;
const nonce = () => crypto.randomUUID();

// The script, the same in the mobile app's half.
const SCRIPT = {
	aliceHello: "Hello Bob, it's Alice on the desktop",
	aliceEdited: "Hello Bob, it's Alice on the desktop (edited)",
	aliceGone: "Alice deletes this one",
	aliceWitness: `The desktop's witness: ${WITNESS}`,
	bobHello: (alice: string) => `Hi <@${alice}>, Bob here on Android`,
	bobEdited: (alice: string) => `Hi <@${alice}>, Bob here on Android (edited)`,
	bobGone: "Bob deletes this one",
	bobWitness: `The phone's witness: ${WITNESS}`,
	alicePicture: "A picture from the desktop",
	bobPicture: "A picture from the phone",
	// Pictures whose thumbnails are more than a message holds (8 KiB): each goes as a file of its own, after its picture.
	alicePictureApart: "A picture from the desktop, its thumbnail apart",
	bobPictureApart: "A picture from the phone, its thumbnail apart",
	toCarol: "Carol, this came before your device",
	carolAnswer: "Carol here: I read it",
	groupName: "Interop group",
	groupAlice: "In the group: Alice",
	groupBob: "In the group: Bob",
	groupCarol: "In the group: Carol read what came before her",
	// A voice note each way: its length and its 64 peaks.
	aliceVoice: { duration_ms: 4200, waveform: Uint8Array.from({ length: 64 }, (_, i) => 255 - i * 4) },
	bobVoice: { duration_ms: 3100, waveform: Uint8Array.from({ length: 64 }, (_, i) => i * 4) },
};

/**
 * Waits until `get` gives something, as another device's work ends in its own time, looking every `every` ms: a look
 * that throws (a refusal, a lost answer) is one more look; past `ms`, it fails with the last one's error.
 */
async function until<T>(get: () => Promise<T | null | undefined>, ms = STEP, every = 100): Promise<T> {
	const deadline = Date.now() + ms;
	let last = "";
	for (;;) {
		try {
			const got = await get();
			if (got !== null && got !== undefined) return got;
		} catch (error) {
			last = error instanceof Error ? error.message : JSON.stringify(error);
		}
		if (Date.now() > deadline) throw new Error(`what the test waited for never came${last ? ` (${last})` : ""}`);
		await Bun.sleep(every);
	}
}
const eventually = (holds: () => Promise<boolean>, ms = STEP, every = 100) =>
	until(async () => (await holds()) || null, ms, every);

// ---- what a person carries between two screens: a note in the shared folder, written whole (a rename)

function note(name: string, value: unknown) {
	const path = join(SHARED, `${name}.json`);
	writeFileSync(`${path}.part`, JSON.stringify(value));
	renameSync(`${path}.part`, path);
}
async function noted<T>(name: string, ms = STEP): Promise<T> {
	const path = join(SHARED, `${name}.json`);
	await eventually(async () => existsSync(path), ms);
	return JSON.parse(readFileSync(path, "utf8"));
}

// ---- what is written to the console from here on, which the witness's case looks through (Review Focus 1)

const written: string[] = [];
const CONSOLE = ["log", "info", "warn", "error", "debug", "trace"] as const;
const spies = CONSOLE.map((method) => {
	const original = console[method].bind(console);
	return spyOn(console, method).mockImplementation((...args: unknown[]) => {
		written.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(" "));
		for (const arg of args) {
			try {
				written.push(JSON.stringify(arg) ?? "");
			} catch {
				// Written as its string above.
			}
		}
		original(...args);
	});
});

/** The stack's nth seeded account. */
function account(n: number): Account {
	const found: unknown = interop?.accounts[n];
	if (typeof found === "object" && found !== null && "id" in found && "email" in found) {
		const { id, email } = found;
		if (typeof id === "string" && typeof email === "string") return { id, email };
	}
	throw new Error(`the stack names no account ${n}`);
}

/**
 * A connection to the gateway for an engine, as the app's: identified with no device, then again with the one the
 * engine registers (Ruling 30's reopen); its events go to the engine. As live.test.ts's.
 */
function gateway(token: string) {
	const listeners = new Set<(event: EngineEvent) => void>();
	let socket: WebSocket | null = null;
	const connect = (device: string | null) => {
		socket?.close();
		const opened = new WebSocket(`${getWSHostURL()}/gateway?token=${encodeURIComponent(token)}`);
		socket = opened;
		opened.onopen = () => {
			const data = { ...identifyData(token, null), ...(device ? { device_id: device } : {}) };
			opened.send(JSON.stringify({ type: "identify", data }));
		};
		opened.onmessage = (event) => {
			const message = JSON.parse(String(event.data));
			if (message.event !== "payload" || typeof message.d?.type !== "string") return;
			for (const listener of listeners) listener(message.d);
		};
	};
	const events: EngineEvents = {
		listen(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
	};
	return { events, connect, close: () => socket?.close() };
}

/** The records the devices keep in memory, which the witness's case looks through (the app's is pageStore's). */
const records: Map<string, string>[] = [];
function keptStore(): EngineStore {
	const items = new Map<string, string>();
	records.push(items);
	return {
		read: (key) => {
			const kept = items.get(key);
			return kept === undefined ? null : JSON.parse(kept);
		},
		write: (key, value) => void (value === null ? items.delete(key) : items.set(key, JSON.stringify(value))),
	};
}

/** Every device made here: the witness's case looks through their folders, and they end with the file. */
const made: { host: BunCoreHost; end: () => Promise<void> }[] = [];
afterAll(async () => {
	await Promise.all(made.map((device) => device.end()));
	for (const spy of spies) spy.mockRestore();
});

/**
 * An account's device as the app makes one, not started: a session of its own, its routes, its connection to the
 * gateway, its core, its record and its engine; `end` stops them and deletes the core's folder.
 */
async function deviceOf(who: Account, store: EngineStore = keptStore()) {
	if (!interop) throw new Error("no stack");
	const session = await logIn({ email: who.email, password: interop.password });
	const client = sessionApi({ token: session.token, sessionToken: session.session_token ?? null });
	const routes = e2eApi(client);
	const socket = gateway(session.token);
	const host = new BunCoreHost();
	const registered: string[] = [];
	/** An engine on the device's core, session and connection: a new one is the app's next start. */
	const engineOn = () =>
		new E2EEngine({
			...{ host, api: routes, events: socket.events, clock: systemClock, user: who.id },
			store,
			deviceName: deviceName(),
			// The page draws what the API lists to this session.
			shown: async (id) => (await routes.conversations()).find((conv) => conv.id === id) ?? null,
			registered: (id) => {
				registered.push(id);
				socket.connect(id);
			},
		});
	socket.connect(null);
	const device = {
		...{ client, routes, socket, host, registered, engineOn },
		engine: engineOn(),
		end: async () => {
			await device.engine.stop();
			socket.close();
			rmSync(host.folder, { recursive: true, force: true });
		},
	};
	made.push(device);
	return device;
}
type Device = Awaited<ReturnType<typeof deviceOf>>;
const idOf = (device: Device) => device.registered.at(-1) ?? "";

/** A first device of the account's: its identity made, its recovery key saved, ready. */
async function firstDevice(who: Account, store?: EngineStore): Promise<Device> {
	const device = await deviceOf(who, store);
	await device.engine.start();
	expect(device.engine.state.name).toBe("first_device");
	await device.engine.makeIdentity();
	await device.engine.keySaved();
	expect(device.engine.state).toEqual({ name: "ready" });
	return device;
}

/** Another device of the account's, set up by `first`'s approval by QR within this app, as live.test.ts's. */
async function approvedOn(first: Device, who: Account): Promise<Device> {
	const fresh = await deviceOf(who);
	await fresh.engine.start();
	expect(fresh.engine.state).toEqual({ name: "new_device" });
	await fresh.engine.stop();
	await fresh.host.open(who.id);
	const { qr } = await fresh.host.handle<{ qr: string }>({ cmd: "approval_begin" });
	const approved = await first.host.handle<Record<string, string>>({ cmd: "approval_from_qr", qr });
	await fresh.host.handle({ cmd: "approval_receive", transfer: approved.transfer });
	const served = await fresh.routes.identity(who.id);
	const { version } = await fresh.routes.putDeviceList({
		...{ device_list: approved.device_list!, certificate: approved.certificate },
		base_version: served.device_list_version,
	});
	await fresh.host.handle({ cmd: "device_list_uploaded", version });
	fresh.engine = fresh.engineOn();
	await fresh.engine.start();
	expect(fresh.engine.state).toEqual({ name: "ready" });
	return fresh;
}

// ---- conversations and their messages, as a device's core shows them and the API lists them

const listedIn = async (device: Device, conversation: string) =>
	(await device.client.get<DirectMessage[]>(`/api/users/@me/conversations/${conversation}/messages`)).data;

/** The newest rows of the conversation this device's core holds: no request, as a wait looks often. */
const rowsOf = async (device: Device, conversation: string) =>
	(
		await device.host.handle<{ messages: ShownMessage[] }>({
			...{ cmd: "messages", conversation_id: conversation, limit: 100 },
		})
	).messages;

/** A message of `author`'s this device's core shows in the conversation, whose row passes `which`: or null. */
async function shown(device: Device, conversation: string, author: string, which: (row: ShownMessage) => boolean) {
	const rows = await rowsOf(device, conversation);
	return rows.find((row) => row.status === "ok" && row.user_id === author && which(row)) ?? null;
}
const withText = (text: string) => (row: ShownMessage) => row.text === text;

/** Waits until every device shows `author`'s message that passes `which`: the first's row, and the API's listing. */
async function arrived(
	devices: [Device, ...Device[]],
	conversation: string,
	author: string,
	which: (row: ShownMessage) => boolean,
	ms = STEP,
) {
	const [first] = devices;
	const row = await until(async () => {
		for (const device of devices) if (!(await shown(device, conversation, author, which))) return null;
		return shown(first, conversation, author, which);
	}, ms);
	const listing = async () => (await listedIn(first, conversation)).find((m) => m.id === row.message_id);
	const listed = await until(listing, STEP, POLL);
	return { row, listed };
}
const read = (devices: [Device, ...Device[]], conversation: string, text: string, author: string, ms = STEP) =>
	arrived(devices, conversation, author, withText(text), ms);

/** Waits until no device shows the message any more, then sees the API list it no more either. */
async function gone(devices: Device[], conversation: string, id: string) {
	await eventually(async () => {
		for (const device of devices) if ((await device.engine.messages(conversation, [id])).length) return false;
		return true;
	});
	for (const device of devices) {
		await eventually(async () => !(await listedIn(device, conversation)).some((m) => m.id === id), STEP, POLL);
	}
}

interface ListedConversation {
	id: string;
	members: { user_id: string }[];
}
const membersOf = async (device: Device, conversation: string) =>
	(await device.client.get<ListedConversation[]>("/api/users/@me/conversations")).data
		.find((conv) => conv.id === conversation)
		?.members.map((member) => member.user_id)
		.sort() ?? [];
const friendsOf = async (device: Device) =>
	(await device.client.get<{ user: { id: string } }[]>("/api/users/@me/friends")).data.map((friend) => friend.user.id);

/** The conversation's group as the device's core holds it, or null without one. */
const heldGroup = (device: Device, conversation: string) =>
	device.host
		.handle<{ epoch: number; authenticator: string; devices: { user_id: string }[] }>({
			cmd: "group",
			conversation_id: conversation,
		})
		.catch(() => null);

/** Whether the devices hold the group at one epoch and authenticator, with leaves of these users alone. */
async function together(devices: Device[], conversation: string, users: string[]): Promise<boolean> {
	const groups = await Promise.all(devices.map((device) => heldGroup(device, conversation)));
	const [first] = groups;
	const leaves = [...new Set(first?.devices.map((leaf) => leaf.user_id))].sort();
	return (
		!!first &&
		groups.every((one) => one?.epoch === first.epoch && one.authenticator === first.authenticator) &&
		Bun.deepEquals(leaves, [...users].sort())
	);
}

// ---- the files: a picture and its thumbnail (Bun has no canvas to draw one), and a voice note

/**
 * A PNG of blocks of colour, which compresses to little, its first `noisy` rows noise, which doesn't: a thumbnail of
 * none fits inside its message, and one of 16 rows (about 16 KB) goes as a file of its own.
 */
function png(width: number, height: number, noisy = 0): Uint8Array<ArrayBuffer> {
	const row = width * 3 + 1;
	const raw = new Uint8Array(row * height);
	let seed = 35;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const at = y * row + 1 + x * 3;
			if (y >= noisy) raw.set([(x >> 5) * 20, (y >> 5) * 20, 160], at);
			else for (let c = 0; c < 3; c++) raw[at + c] = (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
		}
	}
	const chunk = (type: string, data: Uint8Array) => {
		const out = new Uint8Array(12 + data.length);
		const view = new DataView(out.buffer);
		view.setUint32(0, data.length);
		out.set(new TextEncoder().encode(type), 4);
		out.set(data, 8);
		view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
		return out;
	};
	const header = new Uint8Array(13);
	const fields = new DataView(header.buffer);
	fields.setUint32(0, width);
	fields.setUint32(4, height);
	header.set([8, 2, 0, 0, 0], 8);
	const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const idat = chunk("IDAT", new Uint8Array(deflateSync(raw)));
	return new Uint8Array(Buffer.concat([signature, chunk("IHDR", header), idat, chunk("IEND", new Uint8Array())]));
}

/** An audio file whose head is the fixture's of that type (the desktop's voice notes are WebMs of one audio track). */
function audio(type: string): Uint8Array<ArrayBuffer> {
	const head = base64Bytes(conventions.types.find((one) => one.type === type)?.bytes ?? "");
	const bytes = new Uint8Array(head.length + 16_000);
	bytes.set(head);
	for (let at = head.length; at < bytes.length; at++) bytes[at] = (at * 31) % 256;
	return bytes;
}
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** A file of a message this device shows, sealed as the API keeps it, downloaded from its signed URL and opened. */
async function openedFile(device: Device, file: FileRef, listed: DirectMessage | null) {
	const kept = listed?.attachments?.find((one) => one.id === file.id);
	if (!kept?.url) throw new Error("the API keeps no file of that ID for the message");
	const url = kept.url;
	return openSealed(file, {
		download: (most, progress) => device.routes.sealedFile(url, most, progress),
		open: (key, id, sealed, progress) => device.engine.openFile(key, id, sealed, progress),
	});
}

// ---- the devices and conversations the cases leave to the next ones

let a1: Device;
let a2: Device;
let d1: Device;
let dm = "";
let toCarol = "";
let group = "";
/** The DM's two messages deleted, for the backup's case. */
const deleted: string[] = [];

describe.skipIf(!interop)("interop, against the API's stack with the mobile app", () => {
	const [alice, bob, carol, dave] = interop ? [account(0), account(1), account(2), account(3)] : [];

	test("setup: Alice's two devices and Dave's first are ready, and Alice asks Bob and Carol to be friends", async () => {
		// Alice's first device keeps its record as the page does (localStorage), the others in memory.
		a1 = await firstDevice(alice!, pageStore(alice!.id));
		a2 = await approvedOn(a1, alice!);
		d1 = await firstDevice(dave!);
		for (const them of [bob!, carol!]) await a1.client.post("/api/users/@me/friends/requests", { user_id: them.id });
	}, 180_000);

	// Step 5's beginning: Carol has no device yet. Alice's DM with her has its group without her, which says so, and
	// what Alice sends is noted for her.
	test(
		"Carol, who has no device yet, is sent a message in her DM with Alice",
		async () => {
			await eventually(async () => (await friendsOf(a1)).includes(carol!.id), FIRST, POLL);
			toCarol = (await a1.engine.createConversation({ type: 1, user_id: carol!.id })).id;
			await eventually(async () => a1.engine.conversationState(toCarol)?.name === "no_device");
			expect(a1.engine.conversationState(toCarol)).toEqual({ name: "no_device", users: [carol!.id] });
			await a1.engine.sendMessage({ conversation_id: toCarol, nonce: nonce(), text: SCRIPT.toCarol });
		},
		FIRST + STEP,
	);

	// Step 1: the phone's engine joins the group the desktop's made; each reads what the other sends, its edits and its
	// deletions, Alice's on both her devices; a reply mentions her.
	test(
		"Alice opens a DM with Bob; they write to each other, and each edits and deletes a message",
		async () => {
			await eventually(async () => (await friendsOf(a1)).includes(bob!.id), FIRST, POLL);
			dm = (await a1.engine.createConversation({ type: 1, user_id: bob!.id })).id;
			await eventually(() => together([a1, a2], dm, [alice!.id, bob!.id]));
			const hello = (await a1.engine.sendMessage({ conversation_id: dm, nonce: nonce(), text: SCRIPT.aliceHello }))!;
			await a1.engine.sendMessage({ conversation_id: dm, nonce: nonce(), text: SCRIPT.aliceWitness });
			const doomed = (await a1.engine.sendMessage({ conversation_id: dm, nonce: nonce(), text: SCRIPT.aliceGone }))!;

			const answer = await read([a1, a2], dm, SCRIPT.bobHello(alice!.id), bob!.id, FIRST);
			expect(answer.row.reply_to).toBe(hello.id);
			expect(answer.listed).toMatchObject({ mentions: [alice!.id], referenced_message: { message_id: hello.id } });
			await read([a1, a2], dm, SCRIPT.bobWitness, bob!.id);
			const theirs = await read([a1, a2], dm, SCRIPT.bobGone, bob!.id);
			// The API holds none of their text.
			const listing = await until(() => listedIn(a1, dm), STEP, POLL);
			expect(JSON.stringify(listing).includes(WITNESS)).toBe(false);

			await a1.engine.editMessage(dm, hello.id, SCRIPT.aliceEdited);
			await a1.engine.deleteMessage(dm, doomed.id);
			const edited = await read([a1, a2], dm, SCRIPT.bobEdited(alice!.id), bob!.id);
			expect(edited.row.edited_at).not.toBeNull();
			await gone([a1, a2], dm, theirs.row.message_id!);
			deleted.push(doomed.id, theirs.row.message_id!);
		},
		FIRST + 4 * STEP,
	);

	// Step 2: a picture with its thumbnail and a voice note each way, and a sticker the desktop sends.
	test(
		"files cross each way, a picture with its thumbnail and a voice note, and a sticker",
		async () => {
			const picture = new Blob([png(400, 300)]);
			const thumbnail = new Blob([png(320, 240)]);
			await a1.engine.sendMessage({
				...{ conversation_id: dm, nonce: nonce(), text: SCRIPT.alicePicture },
				files: [{ file: picture, name: "from-the-desktop.png", width: 400, height: 300, thumbnail }],
			});
			const big = new Blob([png(320, 240, 16)]);
			expect(big.size).toBeGreaterThan(8 << 10);
			await a1.engine.sendMessage({
				...{ conversation_id: dm, nonce: nonce(), text: SCRIPT.alicePictureApart },
				files: [{ file: new Blob([png(400, 300, 20)]), name: "apart.png", width: 400, height: 300, thumbnail: big }],
			});
			const voice = new Blob([audio("audio/webm")]);
			await a1.engine.sendMessage({
				...{ conversation_id: dm, nonce: nonce() },
				files: [{ file: voice, name: "voice-note.webm", ...SCRIPT.aliceVoice }],
			});
			await a1.engine.sendMessage({ conversation_id: dm, nonce: nonce(), sticker_attachment_id: STICKER });

			// The phone's pictures: their bytes, PNGs by them, their size, and thumbnails this app draws, one inside its
			// message and one a file of its own.
			for (const [text, name, apart] of [
				[SCRIPT.bobPicture, "from-the-phone.png", false],
				[SCRIPT.bobPictureApart, "apart.png", true],
			] as const) {
				const theirs = await read([a1, a2], dm, text, bob!.id);
				const file = shownFile(theirs.row.attachments[0])!;
				expect(file).toMatchObject({ name, said: "image/png", width: 400, height: 300 });
				const opened = await openedFile(a1, file, theirs.listed);
				expect(opened.type).toBe("image/png");
				expect(opened.blob.size).toBe(file.size);
				expect([!!file.thumbnail, !!file.thumbnail_ref]).toEqual([!apart, apart]);
				const small = file.thumbnail
					? base64Bytes(file.thumbnail)
					: new Uint8Array(await (await openedFile(a1, file.thumbnail_ref!, theirs.listed)).blob.arrayBuffer());
				expect(["image/jpeg", "image/png"]).toContain(sniffType(small));
				expect(thumbnailDrawn(small)).toBe(true);
			}

			// Its voice note: one audio file without text, its waveform and its length, drawn as a voice note.
			const voiceNote = await arrived(
				[a1],
				dm,
				bob!.id,
				(row) => row.text === null && shownFile(row.attachments[0])?.said === "audio/ogg",
			);
			const sound = shownFile(voiceNote.row.attachments[0])!;
			expect(voiceNote.row.attachments).toHaveLength(1);
			expect(sound).toMatchObject({
				...{ duration_ms: SCRIPT.bobVoice.duration_ms, waveform: base64(SCRIPT.bobVoice.waveform) },
			});
			const said = [{ type: sound.said, duration_ms: sound.duration_ms, waveform: sound.waveform }];
			expect(drawnAs({ text: voiceNote.row.text, attachments: said }, false)).toBe("voice_note");
			expect((await openedFile(a1, sound, voiceNote.listed)).type).toBe("audio/ogg");
		},
		4 * STEP,
	);

	// Step 5: Carol's device came after Alice's message, and joined her DM with Alice: Alice's engine handed her what it
	// noted for her (a catch-up), and her answer comes back.
	test(
		"Carol, whose device came after, reads what Alice sent before it and answers",
		async () => {
			await read([a1, a2], toCarol, SCRIPT.carolAnswer, carol!.id, FIRST);
			expect(a1.engine.conversationState(toCarol)).toBeNull();
		},
		FIRST + STEP,
	);

	// Step 3: a group the desktop makes with Bob, where both write; then Carol, added, gets the last week from Alice.
	test(
		"Alice makes a group with Bob, adds Carol and shares a week of history with her",
		async () => {
			group = (await a1.engine.createConversation({ type: 2, name: SCRIPT.groupName, user_ids: [bob!.id] })).id;
			await eventually(() => together([a1, a2], group, [alice!.id, bob!.id]));
			await a1.engine.sendMessage({ conversation_id: group, nonce: nonce(), text: SCRIPT.groupAlice });
			await read([a1, a2], group, SCRIPT.groupBob, bob!.id);

			await a1.engine.addMember(group, carol!.id);
			await eventually(() => together([a1, a2], group, [alice!.id, bob!.id, carol!.id]));
			expect(await a1.engine.shareHistory(group, carol!.id, "week")).toMatchObject({ sent: true, truncated: false });
			await read([a1, a2], group, SCRIPT.groupCarol, carol!.id);
		},
		4 * STEP,
	);

	// Step 4: Bob leaves with his statement, and a member's commit takes him out; then Alice removes Carol.
	test(
		"Bob leaves, and Alice removes Carol",
		async () => {
			await eventually(
				async () => Bun.deepEquals(await membersOf(a1, group), [alice!.id, carol!.id].sort()),
				STEP,
				POLL,
			);
			await eventually(() => together([a1, a2], group, [alice!.id, carol!.id]));
			await a1.engine.removeMember(group, carol!.id);
			await eventually(() => together([a1, a2], group, [alice!.id]));
			expect(await until(() => membersOf(a1, group), STEP, POLL)).toEqual([alice!.id]);
		},
		3 * STEP,
	);

	// Step 6: Dave's devices across the engines, an attempt each way by the code, and one by the desktop's QR.
	test(
		"Dave's desktop device approves his new phone, which approves two new desktop devices, by code and by QR",
		async () => {
			// His phone asks; this device offers, shows the code its person types into the phone, and confirms after.
			const asked = () => (d1.engine.state.name === "ready" ? d1.engine.state.approval : undefined);
			await eventually(async () => asked()?.step === "asked", FIRST);
			const phone = asked()!.device;
			// The yes names the question it answers (desktop-electrobun#535).
			await d1.engine.approveDevice(phone, asked()!.question ?? "");
			await eventually(async () => asked()?.step === "code");
			note("dave-desktop-code", { device: phone, code: asked()!.code });
			expect(await noted<{ device: string }>("dave-phone-accepted")).toEqual({ device: phone });
			await d1.engine.confirmApproval(phone);
			const listed = async () => listDevices((await d1.routes.identity(dave!.id)).device_list) ?? [];
			await eventually(async () => (await listed()).includes(phone), STEP, POLL);

			// A new desktop device asks by the code: the phone approves it, and its code is typed in here.
			const second = await deviceOf(dave!);
			await second.engine.start();
			expect(second.engine.state).toEqual({ name: "new_device" });
			await second.engine.beginApproval();
			await second.engine.useCode();
			const code = await noted<{ device: string; code: string }>("dave-phone-code");
			expect(code.device).toBe(idOf(second));
			await eventually(async () => {
				const { state } = second.engine;
				return state.name === "new_device" && state.setup?.way === "code" && state.setup.offered;
			});
			await second.engine.acceptCode(code.code);
			note("dave-desktop-accepted", { device: idOf(second) });
			await eventually(async () => second.engine.state.name === "ready");

			// Another one shows its QR, which the phone scans: no code.
			const third = await deviceOf(dave!);
			await third.engine.start();
			expect(third.engine.state).toEqual({ name: "new_device" });
			await third.engine.beginApproval();
			const { state } = third.engine;
			const qr = state.name === "new_device" && state.setup?.way === "qr" ? state.setup.qr : "";
			expect(qr).not.toBe("");
			note("dave-desktop-qr", { device: idOf(third), qr });
			await eventually(async () => third.engine.state.name === "ready");

			// Four devices on his list, all with one identity.
			const four = await until(
				async () => {
					const devices = await listed();
					return devices.length === 4 ? devices : null;
				},
				STEP,
				POLL,
			);
			expect([...four].sort()).toEqual([idOf(d1), phone, idOf(second), idOf(third)].sort());
			const status = (device: Device) => device.host.handle<{ identity_key: string }>({ cmd: "status" });
			const keys = await Promise.all([d1, second, third].map(async (device) => (await status(device)).identity_key));
			const served = await until(() => d1.routes.identity(dave!.id), STEP, POLL);
			expect(new Set(keys)).toEqual(new Set([served.identity_key]));
		},
		FIRST + 4 * STEP,
	);

	// Step 8: the same security number on both apps; Alice changes her keys, Bob's phone is told, and the new number is
	// the same on both again, before Bob verifies it and after.
	test(
		"Alice changes her keys, and her security number with Bob matches his before and after he verifies",
		async () => {
			const before = await a1.engine.safetyNumber(bob!.id);
			note("alice-number-before", before);
			expect(await noted<{ digits: string }>("bob-number-before", FIRST)).toEqual({ digits: before.digits });

			await a1.engine.changeKeys();
			await a1.engine.keySaved();
			expect(a1.engine.state).toEqual({ name: "ready" });
			const after = await a1.engine.safetyNumber(bob!.id);
			expect(after.digits).not.toBe(before.digits);
			note("alice-number-after", after);
			expect(await noted<{ digits: string }>("bob-number-verified")).toEqual({ digits: after.digits });
			expect((await a1.engine.safetyNumber(bob!.id)).digits).toBe(after.digits);
			// Bob's mark is his alone: nothing on Alice's device says she verified him.
			expect(await a1.engine.contact(bob!.id)).toBe(false);
		},
		FIRST + 2 * STEP,
	);

	// Step 7: a device of Bob's on the desktop, set up with the recovery key his phone showed, restores what his phone
	// backed up of their DM, which it could never read from the queue: its edits in, its deletions out, a file opening.
	test(
		"a desktop device of Bob's recovers with his key and restores what his phone backed up",
		async () => {
			const { key } = await noted<{ key: string }>("bob-recovery-key");
			await noted("bob-backup-up", FIRST);
			const restored = await deviceOf(bob!);
			await restored.engine.start();
			expect(restored.engine.state).toEqual({ name: "new_device" });
			await restored.engine.recover(key);
			expect(restored.engine.state).toEqual({ name: "ready" });
			for (const [text, author] of [
				[SCRIPT.aliceEdited, alice!.id],
				[SCRIPT.aliceWitness, alice!.id],
				[SCRIPT.bobEdited(alice!.id), bob!.id],
				[SCRIPT.bobWitness, bob!.id],
				[SCRIPT.alicePicture, alice!.id],
			] as const)
				await read([restored], dm, text, author);
			expect(await restored.engine.messages(dm, deleted)).toEqual([]);
			const picture = await read([restored], dm, SCRIPT.bobPicture, bob!.id);
			expect((await openedFile(restored, shownFile(picture.row.attachments[0])!, picture.listed)).type).toBe(
				"image/png",
			);
			await eventually(async () => ["uploading", "up_to_date"].includes(restored.engine.backup().state));
		},
		FIRST + 2 * STEP,
	);

	// Review Focus 1: the witness, sent from here and read from the phone, is in no record of the devices' (the page's
	// localStorage and those in memory), no file of their folders (their cores' databases are sealed), and nothing
	// written to the console. The suite looks through the stack and this half's output.
	test(
		"the witness is nowhere this app keeps outside its cores' databases",
		async () => {
			const raw = Buffer.from(WITNESS);
			const forms = [WITNESS, raw.toString("hex")];
			for (let j = 0; j < 3; j++) {
				const run = raw.subarray(j, j + 3 * Math.floor((raw.length - j) / 3));
				forms.push(run.toString("base64"), run.toString("base64url"));
			}
			const holds = (text: string) => forms.some((form) => text.includes(form));
			const kept: string[] = [];
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i)!;
				kept.push(`${key}=${localStorage.getItem(key)}`);
			}
			// The page's record is there, Alice's first device's.
			expect(kept.some((item) => item.startsWith(`duvet.e2e.${alice!.id}.`))).toBe(true);
			for (const items of records) for (const [key, value] of items) kept.push(`${key}=${value}`);
			const files = made.flatMap(({ host }) =>
				[...new Bun.Glob("**/*").scanSync({ cwd: host.folder, onlyFiles: true, dot: true })].map((name) =>
					join(host.folder, name),
				),
			);
			expect(files.some((path) => path.endsWith("core.db"))).toBe(true);
			// What a failure names is where the witness was, never the witness: the suite looks through this output too.
			expect(kept.filter(holds).map((item) => item.split("=")[0])).toEqual([]);
			expect(files.filter((path) => holds(readFileSync(path).toString("latin1")))).toEqual([]);
			expect(written.filter(holds).length).toBe(0);
			// The cores do hold it: the look went where it was.
			expect(await shown(a1, dm, alice!.id, withText(SCRIPT.aliceWitness))).not.toBeNull();
			expect(await shown(a2, dm, bob!.id, withText(SCRIPT.bobWitness))).not.toBeNull();
		},
		STEP,
	);
});
