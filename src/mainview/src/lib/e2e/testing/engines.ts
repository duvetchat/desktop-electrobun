// Engines on the fake API, for the engine's tests (PLAN-E2E-CLIENTES.md, «El motor»): each one a device of a user, with
// its own core (host-bun.ts), session, gateway connection and record, so a test runs as many as it needs in one process.
// The fake answers fetch while a test runs (useFake), as the API answers the app's requests.
import { afterAll, afterEach, mock, spyOn } from "bun:test";
import { rmSync } from "node:fs";
import { sessionApi } from "$lib/api/api";
import type { DirectMessage } from "$lib/api/conversations";
import { e2eApi, type E2eApi } from "$lib/api/e2e";
import { bytesBase64 } from "$lib/staged-images";
import type { EnvelopeFile } from "../conventions";
import { CoreError } from "../errors";
import type { EngineEvent } from "../events";
import type { CoreHost } from "../host";
import { E2EEngine, type BackupShown, type Clock, type EngineParts, type EngineState } from "../engine/engine";
import { shownFile, type ShownFile } from "../engine/files";
import type { IdentityMade } from "../engine/identity";
import { keepMade } from "../engine/legacy";
import type { EngineStore } from "../engine/store";
import type { FakeApi, GatewayEvent } from "./fake-api";
import { BunCoreHost } from "./host-bun";

const folders = new Set<string>();
afterAll(() => {
	for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** The fake answers every request a test's engines make, until the test ends; `seen` hears each request first. */
export function useFake(fake: FakeApi, seen?: (request: Request) => void) {
	spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		seen?.(request.clone());
		return fake.fetch(request);
	}) as typeof fetch);
}
afterEach(() => mock.restore());

/** What each device the running test made holds, which a wait that gives up tells. */
const shown: (() => Promise<string>)[] = [];
afterEach(() => void shown.splice(0));

/** A clock a test moves on by hand: what's due runs as it passes, in order. Its time is the wall clock's, ahead by what
 * the test moved it on. */
export class TestClock implements Clock {
	#now = 0;

	now() {
		return Date.now() + this.#now;
	}
	#timers = new Set<{ at: number; run: () => void }>();

	later(ms: number, run: () => void) {
		const timer = { at: this.#now + ms, run };
		this.#timers.add(timer);
		return () => void this.#timers.delete(timer);
	}

	/** Time moves on by ms. */
	advance(ms: number) {
		const end = this.#now + ms;
		for (;;) {
			const next = [...this.#timers].filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
			if (!next) break;
			this.#timers.delete(next);
			this.#now = next.at;
			next.run();
		}
		this.#now = end;
	}
}

/** A record in memory, one for each device: a test's in place of the page's localStorage, which every device shares. */
export function memoryStore(): EngineStore {
	const items = new Map<string, string>();
	return {
		read: (key) => {
			const kept = items.get(key);
			return kept === undefined ? null : JSON.parse(kept);
		},
		write: (key, value) => void (value === null ? items.delete(key) : items.set(key, JSON.stringify(value))),
	};
}

/** A record whose storage refuses `key`, as the page's does when it's full: the write goes nowhere, and nothing throws. */
export function refusingStore(store: EngineStore, key: string): EngineStore {
	return {
		read: (name) => store.read(name),
		write: (name, value) => {
			if (name !== key) store.write(name, value);
		},
	};
}

/** A core of its own for a device, in a folder of its own, which the same folder and key open again after a restart. */
export function testHost(given?: { folder: string; key: Uint8Array }): BunCoreHost {
	const host = new BunCoreHost(given);
	folders.add(host.folder);
	return host;
}

export interface TestDevice {
	engine: E2EEngine;
	host: CoreHost;
	user: string;
	token: string;
	/** The routes, for this device's session. */
	api: E2eApi;
	store: EngineStore;
	clock: TestClock;
	/** What its connection to the gateway heard. */
	heard: GatewayEvent[];
	/** Each device the engine said it registered or bound this session to. */
	registered: string[];
	/** States the engine went through. */
	states: EngineState[];
	/** What its encrypted backup showed, each change of it. */
	backups: BackupShown[];
	/** Connects to the gateway again, identified with `device`: its READY comes first. */
	connect(device: string | null): void;
}

/**
 * A device of the user on the fake: an engine with its core (`host`, a new one unless given), a session of its own (a
 * sign-in's, unless `token` names one), its record and its clock. It connects to the gateway with no device, then again
 * with the one the engine registers, as the app's one reopen does (Ruling 30).
 */
export function testDevice(
	fake: FakeApi,
	user: string,
	given: {
		host?: CoreHost;
		store?: EngineStore;
		token?: string;
		/** Which events reach the engine: all of them unless this says no. */
		hears?: (event: GatewayEvent) => boolean;
		/** The conversation as its page draws it (EngineParts' shown): the engine's own listing unless given. */
		shown?: EngineParts["shown"];
	} = {},
): TestDevice {
	const host = given.host ?? testHost();
	const store = given.store ?? memoryStore();
	const token = given.token ?? fake.signIn(user).token;
	const clock = new TestClock();
	const listeners = new Set<(event: EngineEvent) => void>();
	const heard: GatewayEvent[] = [];
	const registered: string[] = [];
	let end = () => {};
	const connect = (device: string | null) => {
		end();
		end = fake.connect(token, device, (event) => {
			heard.push(event);
			if (given.hears && !given.hears(event)) return;
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake's events are the API's, as the gateway hands them on
			for (const listener of listeners) listener(event as EngineEvent);
		});
	};
	const api = e2eApi(sessionApi({ token, sessionToken: null }));
	const engine = new E2EEngine({
		host,
		api,
		events: {
			listen(listener) {
				listeners.add(listener);
				return () => void listeners.delete(listener);
			},
		},
		store,
		clock,
		user,
		deviceName: "Duvet for Windows",
		registered: (device) => {
			registered.push(device);
			if (device !== registered.at(-2)) connect(device);
		},
		...(given.shown ? { shown: given.shown } : {}),
	});
	const states: EngineState[] = [];
	engine.onState((state) => states.push(state));
	const backups: BackupShown[] = [];
	engine.onBackup(() => backups.push(engine.backup()));
	connect(null);
	const device = { engine, host, user, token, api, store, clock, heard, registered, states, backups, connect };
	shown.push(() => heldBy(fake, device));
	return device;
}

/**
 * What a device holds, as a wait that gave up tells it: its engine's state, then for each conversation of the fake, the
 * group its core holds and what the conversation says.
 */
async function heldBy(fake: FakeApi, device: TestDevice): Promise<string> {
	const lines = [`${device.user}: ${device.engine.state.name}`];
	for (const id of fake.conversationIds()) {
		const held = await device.host.handle<HeldGroup>({ cmd: "group", conversation_id: id }).then(
			(group) => `generation ${group.generation}, epoch ${group.epoch}${group.blocked ? ", blocked" : ""}`,
			(error: unknown) =>
				error instanceof CoreError && error.code === "not_found" ? "no group" : `its group not read (${String(error)})`,
		);
		lines.push(`  conversation ${id}: ${held}; ${JSON.stringify(device.engine.conversationState(id) ?? "no notice")}`);
	}
	return lines.join("\n");
}

/** A device through the first device's flow: its identity made, its key saved, both published; the engine ready. */
export async function firstDevice(fake: FakeApi, user: string, given: Parameters<typeof testDevice>[2] = {}) {
	const device = testDevice(fake, user, given);
	await device.engine.start();
	await device.engine.makeIdentity();
	await device.engine.keySaved();
	if (device.engine.state.name !== "ready") throw new Error(`the first device ended ${device.engine.state.name}`);
	return device;
}

/** The recovery key a first device's state shows, or null. */
export const shownKey = (state: EngineState) => (state.name === "first_device" ? state.recoveryKey : null);

/** What a promise rejects with: it must. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("it didn't reject");
}

/**
 * Waits for the work the device's engine took on until now, as what an event asks for runs in the engine's turn: a tap
 * that does nothing on a device whose key's sheet is closed, which waits its turn after them; then for the sends and
 * catch-ups that work started, whose requests run outside the turn, and the turn they hand back to.
 */
export async function turnEnded(device: TestDevice) {
	await device.engine.uploadLater();
	await device.engine.sendsSettled();
	// What they handed back to the turn (a catch-up's confirmation), which comes after them.
	await device.engine.uploadLater();
}

/**
 * Waits until `holds` is true, as an engine's work after an event ends in its own time: past `ms` (a minute unless
 * `wait` says), it fails, telling `what` it waited for and what each of the test's devices holds.
 */
export async function until(
	holds: () => boolean | Promise<boolean>,
	wait: number | { ms?: number; what?: string } = 60_000,
): Promise<void> {
	const { ms = 60_000, what } = typeof wait === "number" ? { ms: wait, what: undefined } : wait;
	const end = Date.now() + ms;
	while (!(await holds())) {
		if (Date.now() > end) {
			const held = await Promise.all(shown.map((tell) => tell()));
			throw new Error([`what the test waited for never came${what ? `: ${what}` : ""}`, ...held].join("\n"));
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** What the core's `group` answers: the group as a device holds it. */
export interface HeldGroup {
	generation: number;
	epoch: number;
	authenticator: string;
	blocked: boolean;
	/** Its members, those with no device in it among them. */
	members: { user_id: string }[];
	devices: { user_id: string; device_id: string }[];
}

/** The conversation's group as the device's core holds it, or null without one. */
export const groupOf = (device: TestDevice, conversation: string): Promise<HeldGroup | null> =>
	device.host.handle<HeldGroup>({ cmd: "group", conversation_id: conversation }).catch(() => null);

/**
 * The conversation was made on this device, as the person's createConversation makes one (#574): its record is its
 * people as the API lists them now, which the group this device founds holds. A test's conversation the fake made
 * stands for one its owner's device made.
 */
export async function madeHere(device: TestDevice, conversation: string): Promise<void> {
	const conv = (await device.api.conversations()).find(({ id }) => id === conversation);
	if (!conv) throw new Error(`${device.user} isn't in ${conversation}`);
	const members = conv.members.map((member) => member.user_id);
	keepMade(device.store, conv.id, conv.type === 2 ? { owner: conv.owner_id, members } : { members });
}

/** Waits until every device holds the conversation's group at one generation and epoch, with one authenticator. */
export async function sameGroup(devices: TestDevice[], conversation: string, ms = 60_000): Promise<HeldGroup> {
	let held: HeldGroup | null = null;
	await until(
		async () => {
			const groups = await Promise.all(devices.map((device) => groupOf(device, conversation)));
			const [first] = groups;
			held = first ?? null;
			return groups.every(
				(group) =>
					group &&
					first &&
					group.generation === first.generation &&
					group.epoch === first.epoch &&
					group.authenticator === first.authenticator,
			);
		},
		{ ms, what: "one group, at one generation and epoch, on every device" },
	);
	return held!;
}

/**
 * A commit of the device's own, made and sent by hand, with its engine stopped (its core open): its leaf's renewal,
 * posted, and the API's answer told to the core.
 */
export async function commitByHand(device: TestDevice, conversation: string) {
	const { generation, epoch } = (await groupOf(device, conversation))!;
	const made = await device.host.handle<{ commit: string; group_info: string }>({
		cmd: "refresh",
		conversation_id: conversation,
	});
	const taken = await device.api.commit(conversation, { generation, epoch, ...made });
	await device.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: true, seq: taken.seq });
	return taken;
}

/** The device again after its app restarted: a new engine on the same core, record and session, started. */
export async function restarted(fake: FakeApi, device: TestDevice, given: Parameters<typeof testDevice>[2] = {}) {
	await device.engine.stop();
	const again = testDevice(fake, device.user, {
		...{ host: device.host, store: device.store, token: device.token },
		...given,
	});
	await again.engine.start();
	return again;
}

/**
 * Another device of the first one's user, set up by the first one's approval by QR (Task 26 does it in the app) and on
 * the user's list: its engine started and ready, hearing what `given` says once it is.
 */
export async function approvedDevice(
	fake: FakeApi,
	first: TestDevice,
	given: Pick<NonNullable<Parameters<typeof testDevice>[2]>, "hears"> = {},
): Promise<TestDevice> {
	const fresh = testDevice(fake, first.user);
	await fresh.engine.start();
	if (fresh.engine.state.name !== "new_device") throw new Error(`the new device is ${fresh.engine.state.name}`);
	await fresh.engine.stop();
	await fresh.host.open(first.user);
	const { qr } = await fresh.host.handle<{ qr: string }>({ cmd: "approval_begin" });
	const approved = await first.host.handle<Record<string, string>>({ cmd: "approval_from_qr", qr });
	await fresh.host.handle({ cmd: "approval_receive", transfer: approved.transfer });
	const served = await fresh.api.identity(first.user);
	const { version } = await fresh.api.putDeviceList({
		...{ device_list: approved.device_list!, certificate: approved.certificate },
		base_version: served.device_list_version,
	});
	await fresh.host.handle({ cmd: "device_list_uploaded", version });
	const again = testDevice(fake, first.user, { ...given, host: fresh.host, store: fresh.store, token: fresh.token });
	await again.engine.start();
	if (again.engine.state.name !== "ready") throw new Error(`the approved device is ${again.engine.state.name}`);
	return again;
}

/** A host whose first open finds the database locked, as another instance holds it: the core opens after. */
export function lockedOnce(host: CoreHost): CoreHost {
	let locked = true;
	return new Proxy(host, {
		get(target, name) {
			if (name === "open") {
				return async (user: string) => (locked ? ((locked = false), { state: "locked" }) : target.open(user));
			}
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/** A host whose answer to a command is `answer`'s, when it gives one: the core's otherwise. */
export function answeringHost(host: CoreHost, answer: (command: Record<string, unknown>) => unknown): CoreHost {
	return new Proxy(host, {
		get(target, name) {
			if (name === "handle") {
				return async (command: { cmd: string } & Record<string, unknown>) => answer(command) ?? target.handle(command);
			}
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/**
 * A host that tells what it's asked (each command's name, in order) and fails a command when `fail`, which sees the
 * whole command, gives an error.
 */
export function watchedHost(
	host: CoreHost,
	log: string[],
	fail: (cmd: string, command: Record<string, unknown>) => Error | null = () => null,
): CoreHost {
	return new Proxy(host, {
		get(target, name) {
			if (name === "handle") {
				return async (command: { cmd: string } & Record<string, unknown>) => {
					log.push(command.cmd);
					const error = fail(command.cmd, command);
					if (error) throw error;
					return target.handle(command);
				};
			}
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/** The device's files of a message, once its core holds the message, as a view reads them. */
export async function filesOn(device: TestDevice, conversation: string, id: string): Promise<ShownFile[]> {
	let files: ShownFile[] = [];
	await until(async () => {
		const [row] = await device.engine.messages(conversation, [id]);
		if (row?.status !== "ok") return false;
		files = row.attachments.map(shownFile).filter((file): file is ShownFile => file !== null);
		return true;
	});
	return files;
}

/**
 * A file as another client could send it, its envelope written by hand: the core seals it and encrypts what it's told,
 * and nothing checks what the sender says of it. Sent beside the device's engine, which is idle.
 */
export async function sendWritten(
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
		sealed.push(await device.host.sealFile(key, id, new Blob([new Uint8Array(bytes)])));
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

/** Another device of the user starts over (Task 26 does it from the app): a new identity, listing that device alone. */
export async function resetFrom({ host, api, user }: TestDevice) {
	const made = await host.handle<IdentityMade>({ cmd: "reset_identity" });
	const { identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key } = made;
	const replaces = (await api.identity(user)).identity_key;
	const published = await api.putIdentity({
		...{ identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key },
		...{ replaces, reset: true },
	});
	await host.handle({ cmd: "identity_uploaded" });
	await host.handle({ cmd: "device_list_uploaded", version: published.device_list_version });
}
