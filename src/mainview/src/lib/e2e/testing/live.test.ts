// The live tests (PLAN-E2E-CLIENTES.md, Task 11): the app's own code against a real API and gateway, which the API's
// suite clients-desktop starts and names: E2E_LIVE_API and E2E_LIVE_WS, its seeded accounts (E2E_LIVE_ACCOUNTS, JSON:
// each one's id and email) and their password (E2E_LIVE_PASSWORD). Outside that suite, as in the app's own run, they're
// skipped. Each engine task adds its cases here, on the core the desktop carries (native/core).
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { base64Bytes } from "$lib/activity-thumbnail";
import api, { sessionApi } from "$lib/api/api";
import type { DirectMessage } from "$lib/api/conversations";
import { logIn } from "$lib/api/auth";
import { e2eApi } from "$lib/api/e2e";
import { identifyData } from "$lib/api/ws/identify";
import { getWSHostURL } from "$lib/common/common";
import { listDevices } from "../cbor";
import { deviceName } from "../client";
import { E2EEngine, systemClock } from "../engine/engine";
import { openSealed, sealedSize, shownFile, type ShownFile } from "../engine/files";
import type { EngineEvent, EngineEvents } from "../events";
import { memoryStore } from "./engines";
import { BunCoreHost } from "./host-bun";
import { useXHR } from "./xhr";

interface Account {
	id: string;
	email: string;
}

const env = process.env;
const accounts: unknown = JSON.parse(env.E2E_LIVE_ACCOUNTS ?? "[]");
const live = env.E2E_LIVE_API
	? { accounts: Array.isArray(accounts) ? accounts : [], password: env.E2E_LIVE_PASSWORD ?? "" }
	: null;
// The app reaches the API and the gateway at VITE_API_URL and VITE_WS_URL, which the preload points nowhere.
if (live) Object.assign(globalThis, { VITE_API_URL: env.E2E_LIVE_API, VITE_WS_URL: env.E2E_LIVE_WS ?? "" });
// A message's files go up as a form, through the XMLHttpRequest Bun lacks.
useXHR();

/** The stack's nth seeded account. */
function account(n: number): Account {
	const found: unknown = live?.accounts[n];
	if (typeof found === "object" && found !== null && "id" in found && "email" in found) {
		const { id, email } = found;
		if (typeof id === "string" && typeof email === "string") return { id, email };
	}
	throw new Error(`the stack names no account ${n}`);
}

/** Identifies on the gateway with the session's access token, as the app does, and gives READY's data. */
function ready(token: string): Promise<{ user: { id: string } }> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(`${getWSHostURL()}/gateway?token=${encodeURIComponent(token)}`);
		const end = (settle: () => void) => {
			clearTimeout(timer);
			socket.close();
			settle();
		};
		const timer = setTimeout(() => end(() => reject(new Error("no READY within 15 s"))), 15_000);
		socket.onopen = () => socket.send(JSON.stringify({ type: "identify", data: identifyData(token, null) }));
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data));
			if (message.event === "payload" && message.d?.type === "READY") end(() => resolve(message.d.data));
			else if (message.event === "close-with-reason") {
				end(() => reject(new Error(`the gateway closed with ${message.code}: ${message.reason}`)));
			}
		};
		socket.onerror = () => end(() => reject(new Error("the gateway's socket failed")));
	});
}

/**
 * A connection to the gateway for an engine, as the app's: identified with no device, then again with the one the
 * engine registers (Ruling 30's reopen). Its events go to the engine; `readies` says which device each READY came for.
 */
function gateway(token: string) {
	const listeners = new Set<(event: EngineEvent) => void>();
	const readies: (string | null)[] = [];
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
			if (message.d.type === "READY") readies.push(device);
			for (const listener of listeners) listener(message.d);
		};
	};
	const events: EngineEvents = {
		listen(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
	};
	return { events, connect, readies, close: () => socket?.close() };
}

/**
 * An account's device as the app makes one, not started: a session of its own, its routes, its connection to the
 * gateway, its core and its engine; `end` stops them and deletes the core's folder.
 */
async function deviceOf(who: Account) {
	if (!live) throw new Error("no stack");
	const session = await logIn({ email: who.email, password: live.password });
	const client = sessionApi({ token: session.token, sessionToken: session.session_token ?? null });
	const routes = e2eApi(client);
	const socket = gateway(session.token);
	const host = new BunCoreHost();
	const registered: string[] = [];
	const store = memoryStore();
	/** An engine on the device's core, session and connection: a new one is the app's next start. */
	const engineOn = () =>
		new E2EEngine({
			...{ host, api: routes, events: socket.events, clock: systemClock, user: who.id },
			store,
			deviceName: deviceName(),
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
	return device;
}

/** Waits until `holds` is true, as another device's work after an event ends in its own time: past `ms`, it fails. */
async function eventually(holds: () => Promise<boolean>, ms = 30_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!(await holds())) {
		if (Date.now() > deadline) throw new Error("what the test waited for never came");
		await Bun.sleep(100);
	}
}

type Device = Awaited<ReturnType<typeof deviceOf>>;

/**
 * Another device of the account's, set up by `first`'s approval by QR (Task 26 does it in the app) and on its list:
 * its engine started again, as the app's next start, and ready.
 */
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
/** Carol's and Dave's devices and their DM, which the groups' case leaves to the messages' case after it. */
let carolAndDave: { c: Device; d: Device; dm: string } | null = null;
/** The recovery key each account's first device showed in the groups' case, by the account's ID: a test's own copy. */
const recoveryKeys = new Map<string, string>();
/** Alice's and Bob's devices, which the start's case leaves to the members' case. */
let aliceAndBob: { a: Device; b: Device } | null = null;
afterAll(async () => {
	if (carolAndDave) await Promise.all([carolAndDave.c.end(), carolAndDave.d.end()]);
	if (aliceAndBob) await Promise.all([aliceAndBob.a.end(), aliceAndBob.b.end()]);
});

describe.skipIf(!live)("live, against the API's stack", () => {
	test("the client reaches the stack", async () => {
		if (!live) throw new Error("no stack");
		const alice = account(0);
		const session = await logIn({ email: alice.email, password: live.password });
		expect((await api.get<{ id: string }>("/api/users/@me")).data.id).toBe(alice.id);
		// A route of encryption's, which takes only a client whose X-Duvet-Client meets its platform's minimum.
		expect(await e2eApi().devices()).toEqual([]);
		expect((await ready(session.token)).user.id).toBe(alice.id);
	}, 30_000);

	// The engine's start (PLAN-E2E-CLIENTES.md, Task 12): a first device, from its registration to its key packages,
	// which a friend's device claims.
	test("a device registers, binds its session, publishes its identity and its key packages", async () => {
		const [alice, bob] = [account(0), account(1)];
		const b = await deviceOf(bob);
		const a = await deviceOf(alice);
		try {
			await b.engine.start();
			expect(b.engine.state).toEqual({ name: "first_device", recoveryKey: null, finishing: false });
			const [made] = b.registered;
			expect(await b.routes.devices()).toMatchObject([{ id: made, listed: false, current: true }]);

			await b.engine.makeIdentity();
			const shown = b.engine.state;
			expect(shown.name === "first_device" && shown.recoveryKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{48}$/);
			await b.engine.keySaved();
			expect(b.engine.state).toEqual({ name: "ready" });

			// The API has the identity the core made, with this device listed as its one device.
			const status = await b.host.handle<{ identity_key: string; certificate: string }>({ cmd: "status" });
			const identity = await b.routes.identity(bob.id);
			expect(identity).toMatchObject({ identity_key: status.identity_key, device_list_version: 1 });
			expect(identity.certificates).toEqual([status.certificate]);
			expect(await b.routes.devices()).toMatchObject([{ id: made, listed: true, current: true }]);
			// The gateway took an identify naming the device: its session hands the device its own events.
			const deadline = Date.now() + 15_000;
			while (!b.socket.readies.includes(made!) && Date.now() < deadline) await Bun.sleep(50);
			expect(b.socket.readies).toContain(made!);

			// Alice's first device, set up the same way, has its key packages up: Bob, her friend, claims one for it.
			await a.engine.start();
			await a.engine.makeIdentity();
			await a.engine.keySaved();
			expect(a.engine.state).toEqual({ name: "ready" });
			const request = await b.client.post<{ id: string }>("/api/users/@me/friends/requests", { user_id: alice.id });
			await a.client.post(`/api/users/@me/friends/requests/${request.data.id}/accept`);
			const { key_packages } = await b.routes.claimKeyPackages(alice.id);
			expect(key_packages.map(({ device_id }) => device_id)).toEqual([a.registered[0]!]);
			aliceAndBob = { a, b };
		} finally {
			if (!aliceAndBob) await Promise.all([a.end(), b.end()]);
		}
	}, 120_000);

	// Conversation groups (PLAN-E2E-CLIENTES.md, Task 14): a DM's group, which one of its members makes as they open it,
	// through the API's validator, and the other's device joins by its welcome. Carol and Dave, whom the case above left
	// without identities.
	test("two users' devices reach the same epoch and authenticator", async () => {
		const [carol, dave] = [account(2), account(3)];
		const c = await deviceOf(carol);
		const d = await deviceOf(dave);
		const groupOf = (host: BunCoreHost, id: string) =>
			host
				.handle<{ generation: number; epoch: number; authenticator: string }>({ cmd: "group", conversation_id: id })
				.catch(() => null);
		try {
			for (const [device, who] of [
				[c, carol],
				[d, dave],
			] as const) {
				await device.engine.start();
				await device.engine.makeIdentity();
				const shown = device.engine.state;
				if (shown.name === "first_device" && shown.recoveryKey) recoveryKeys.set(who.id, shown.recoveryKey);
				await device.engine.keySaved();
				expect(device.engine.state).toEqual({ name: "ready" });
			}
			// Friends, and a DM Carol starts, which Dave opens first: either member of a DM makes its group.
			const request = await c.client.post<{ id: string }>("/api/users/@me/friends/requests", { user_id: dave.id });
			await d.client.post(`/api/users/@me/friends/requests/${request.data.id}/accept`);
			const dm = await c.client.post<{ id: string }>("/api/users/@me/conversations", { type: 1, user_id: dave.id });
			await d.engine.openConversation(dm.data.id);
			expect(d.engine.conversationState(dm.data.id)).toBeNull();

			// Carol's device hears the welcome and comes in: both hold the group at one epoch, with one authenticator.
			const deadline = Date.now() + 30_000;
			let held: { carol: unknown; dave: unknown } = { carol: null, dave: null };
			while (Date.now() < deadline) {
				held = { carol: await groupOf(c.host, dm.data.id), dave: await groupOf(d.host, dm.data.id) };
				if (held.carol && Bun.deepEquals(held.carol, held.dave)) break;
				await Bun.sleep(100);
			}
			expect(held.dave).toMatchObject({ generation: 0, epoch: 1 });
			expect(held.carol).toEqual(held.dave);
			carolAndDave = { c, d, dm: dm.data.id };
		} finally {
			if (!carolAndDave) await Promise.all([c.end(), d.end()]);
		}
	}, 120_000);

	// Encrypted messages (PLAN-E2E-CLIENTES.md, Task 16): Carol's and Dave's devices, in the DM the case above left them,
	// send, answer, edit and delete through the API, which never holds their text.
	test("two users converse, edit and delete", async () => {
		const pair = carolAndDave;
		if (!pair) throw new Error("the case before left no conversation");
		const { c, d, dm } = pair;
		const carol = account(2);
		const textOn = async (device: Device, id: string) => (await device.engine.messages(dm, [id]))[0]?.text ?? null;

		// Carol's message: Dave's device opens it.
		const sent = (await c.engine.sendMessage({ conversation_id: dm, nonce: crypto.randomUUID(), text: "hello Dave" }))!;
		await eventually(async () => (await textOn(d, sent.id)) === "hello Dave");
		// Dave answers it, mentioning her: hers opens it.
		const reply = (await d.engine.sendMessage({
			...{ conversation_id: dm, nonce: crypto.randomUUID(), text: `hi <@${carol.id}>` },
			message_reference: { type: 0, message_id: sent.id },
		}))!;
		await eventually(async () => (await textOn(c, reply.id)) === `hi <@${carol.id}>`);
		// The API holds their ciphertexts, whom the reply mentions and what it answers, and none of their text.
		const listed = (await c.client.get<DirectMessage[]>(`/api/users/@me/conversations/${dm}/messages`)).data;
		const [first, answer] = [listed.find((m) => m.id === sent.id), listed.find((m) => m.id === reply.id)];
		expect(first).toMatchObject({ ciphertext: expect.any(String) });
		expect(answer).toMatchObject({ mentions: [carol.id], referenced_message: { message_id: sent.id } });
		expect(JSON.stringify(listed)).not.toContain("hello Dave");

		// Carol edits hers: Dave's device shows the edit. Dave deletes his answer: it's gone from both, and from the API.
		await c.engine.editMessage(dm, sent.id, "hello again");
		await eventually(async () => (await textOn(d, sent.id)) === "hello again");
		await d.engine.deleteMessage(dm, reply.id);
		await eventually(async () => (await c.engine.messages(dm, [reply.id])).length === 0);
		const after = (await c.client.get<DirectMessage[]>(`/api/users/@me/conversations/${dm}/messages`)).data;
		expect(after.map((m) => m.id)).not.toContain(reply.id);
	}, 120_000);

	// Encrypted attachments (PLAN-E2E-CLIENTES.md, Task 18): a file Carol's device seals and sends with the ID it gave
	// it, which the API keeps as bytes it can't open, and Dave's device downloads from its signed URL and opens.
	test("a file crosses between two users", async () => {
		const pair = carolAndDave;
		if (!pair) throw new Error("the case before left no conversation");
		const { c, d, dm } = pair;
		const picture = new Uint8Array(150_000);
		crypto.getRandomValues(picture.subarray(0, 65_536));
		picture.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const sent = (await c.engine.sendMessage({
			...{ conversation_id: dm, nonce: crypto.randomUUID(), text: "a picture" },
			files: [{ file: new Blob([picture]), name: "cat.png", width: 1, height: 1 }],
		}))!;
		// The API keeps one file, under the ID the envelope names, sealed, named nothing of it.
		const listed = (await d.client.get<DirectMessage[]>(`/api/users/@me/conversations/${dm}/messages`)).data;
		const [kept] = listed.find((m) => m.id === sent.id)?.attachments ?? [];
		expect(kept).toMatchObject({
			...{ filename: "file", content_type: "application/octet-stream" },
			size_bytes: sealedSize(picture.length),
		});
		// Dave's device opens it from its signed URL: the same bytes, a picture by them.
		let file: ShownFile | null = null;
		await eventually(async () => {
			const [row] = await d.engine.messages(dm, [sent.id]);
			file = row?.status === "ok" ? shownFile(row.attachments[0]) : null;
			return file !== null;
		});
		expect(file).toMatchObject({ id: kept!.id, name: "cat.png", size: picture.length });
		const opened = await openSealed(file!, {
			download: (most, progress) => d.routes.sealedFile(kept!.url!, most, progress),
			open: (key, id, sealed, progress) => d.engine.openFile(key, id, sealed, progress),
		});
		expect(new Uint8Array(await opened.blob.arrayBuffer())).toEqual(picture);
		expect(opened.type).toBe("image/png");
	}, 120_000);

	// Devices in Settings (PLAN-E2E-CLIENTES.md, Task 24): Carol's device, which the cases above left set up, takes a
	// device of hers she lost off her account with new keys, which the device that stays takes from its transfer, then
	// takes that one off with a list: each through the API's own checks.
	test("a lost device goes with new keys, and another one with a list", async () => {
		const pair = carolAndDave;
		if (!pair) throw new Error("the case before left no device");
		const { c } = pair;
		const carol = account(2);
		const lost = await approvedOn(c, carol);
		const kept = await approvedOn(c, carol);
		const idOf = (device: Device) => device.registered.at(-1)!;
		const [own, gone, stays] = [idOf(c), idOf(lost), idOf(kept)];
		const devices = async () => (await c.routes.devices()).map(({ id }) => id).sort();
		const identityKey = async (device: Device) =>
			(await device.host.handle<{ identity_key: string }>({ cmd: "status" })).identity_key;
		try {
			expect(await devices()).toEqual([own, gone, stays].sort());
			const before = await c.routes.identity(carol.id);

			await c.engine.removeDevice(gone, { changeKeys: true });
			const shown = c.engine.state;
			expect(shown.name === "ready" && shown.rotation?.recoveryKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{48}$/);
			await c.engine.keySaved();
			expect(c.engine.state).toEqual({ name: "ready" });
			const after = await c.routes.identity(carol.id);
			expect(after.identity_key).not.toBe(before.identity_key);
			expect(after.identity_key).toBe(await identityKey(c));
			expect(await devices()).toEqual([own, stays].sort());
			await eventually(async () => lost.engine.state.name === "removed");
			await eventually(async () => (await identityKey(kept)) === after.identity_key);

			await c.engine.removeDevice(stays);
			expect(await devices()).toEqual([own]);
			await eventually(async () => kept.engine.state.name === "removed");
			expect(c.engine.state).toEqual({ name: "ready" });
		} finally {
			await Promise.all([lost.end(), kept.end()]);
		}
	}, 180_000);

	// Members (PLAN-E2E-CLIENTES.md, Task 22), through the API's validator: a group Carol makes, with its MLS group at
	// once; she adds Alice and Bob, one commit each, whose devices join by their welcomes, and removes Bob; Alice leaves
	// with her statement, and a member's commit, on the API's proposal, takes her out. Carol's and Dave's devices end at
	// one epoch and authenticator, holding no leaf of Alice's or Bob's.
	test("members are added, removed and leave", async () => {
		const [pair, both] = [carolAndDave, aliceAndBob];
		if (!pair || !both) throw new Error("the cases before left no devices");
		const { c, d } = pair;
		const { a, b } = both;
		const [alice, bob, carol, dave] = [account(0), account(1), account(2), account(3)];
		// Carol befriends Alice and Bob, whom she may then add.
		for (const [device, them] of [
			[a, alice],
			[b, bob],
		] as const) {
			const request = await c.client.post<{ id: string }>("/api/users/@me/friends/requests", { user_id: them.id });
			await device.client.post(`/api/users/@me/friends/requests/${request.data.id}/accept`);
		}
		const group = await c.engine.createConversation({ type: 2, name: "live members", user_ids: [dave.id] });
		const held = (device: Device) =>
			device.host
				.handle<{ epoch: number; authenticator: string; devices: { user_id: string }[] }>({
					...{ cmd: "group", conversation_id: group.id },
				})
				.catch(() => null);
		/** Whether these devices hold the group at one epoch and authenticator, with leaves of these users alone. */
		const together = async (devices: Device[], users: string[]) => {
			const groups = await Promise.all(devices.map(held));
			const [first] = groups;
			const leaves = [...new Set(first?.devices.map((leaf) => leaf.user_id))].sort();
			return (
				!!first &&
				groups.every((one) => one?.epoch === first.epoch && one.authenticator === first.authenticator) &&
				Bun.deepEquals(leaves, [...users].sort())
			);
		};
		// Made at once: Dave's device comes in by its welcome.
		await eventually(() => together([c, d], [carol.id, dave.id]));

		// Carol adds Alice, then Bob: one request each, their devices in by their welcomes.
		await c.engine.addMember(group.id, alice.id);
		await c.engine.addMember(group.id, bob.id);
		await eventually(() => together([c, d, a, b], [carol.id, dave.id, alice.id, bob.id]));

		// She removes Bob, and Alice leaves: the API proposes her leaf's removal, which a member's commit makes.
		await c.engine.removeMember(group.id, bob.id);
		await a.engine.leaveConversation(group.id);
		await eventually(() => together([c, d], [carol.id, dave.id]), 60_000);
		const listed = (
			await c.client.get<{ id: string; members: { user_id: string }[] }[]>("/api/users/@me/conversations")
		).data;
		expect(listed.find((conv) => conv.id === group.id)?.members.map((member) => member.user_id)).toEqual([
			carol.id,
			dave.id,
		]);
	}, 180_000);

	// A new device (PLAN-E2E-CLIENTES.md, Task 26): Dave's second device, set up with the recovery key his first showed
	// in the groups' case, goes into his DM with Carol by an external commit and reads what she sends after.
	test("a second device recovers with the key and reads what comes after", async () => {
		const pair = carolAndDave;
		if (!pair) throw new Error("the case before left no conversation");
		const { c, d, dm } = pair;
		const dave = account(3);
		const key = recoveryKeys.get(dave.id);
		if (!key) throw new Error("the groups' case kept no recovery key");
		const second = await deviceOf(dave);
		try {
			await second.engine.start();
			expect(second.engine.state).toEqual({ name: "new_device" });
			// As a person types it: in groups, spaces between.
			await second.engine.recover(key.match(/.{4}/g)!.join(" "));
			expect(second.engine.state).toEqual({ name: "ready" });
			const own = second.registered.at(-1)!;
			expect((await second.routes.devices()).find(({ current }) => current)).toMatchObject({ id: own, listed: true });
			expect(listDevices((await second.routes.identity(dave.id)).device_list)).toContain(own);

			await inOneGroup([c, d, second], dm);
			const text = "after you recovered";
			const sent = (await c.engine.sendMessage({ conversation_id: dm, nonce: crypto.randomUUID(), text }))!;
			await eventually(async () => (await second.engine.messages(dm, [sent.id]))[0]?.text === text);
		} finally {
			await second.end();
		}
	}, 180_000);

	// The encrypted backup (PLAN-E2E-CLIENTES.md, Task 32): what Carol sent before it, a device Dave recovers can't read
	// from its queue, so it comes from the backup. The API dates messages by its own clock, so no day of theirs has ended
	// for an engine to back up: Dave's first device seals today's by hand, as its engine seals a day, and the new device's
	// engine restores it, through the real API and storage.
	test("a recovered device restores what the first one backed up", async () => {
		const pair = carolAndDave;
		if (!pair) throw new Error("the case before left no conversation");
		const { c, d, dm } = pair;
		const dave = account(3);
		const key = recoveryKeys.get(dave.id);
		if (!key) throw new Error("the groups' case kept no recovery key");
		const text = "before your new device";
		const before = (await c.engine.sendMessage({ conversation_id: dm, nonce: crypto.randomUUID(), text }))!;
		await eventually(async () => (await d.engine.messages(dm, [before.id]))[0]?.text === text);
		const day = new Date(before.sent_at!).toISOString().slice(0, 10);
		const { ids: deleted } = await d.routes.deletedMessages(dm);
		const built = await d.host.handle<{ data: string; complete: boolean; version: number }>({
			...{ cmd: "backup_segment", conversation_id: dm, day, deleted },
		});
		await d.routes.putSegment(dm, day, new Blob([base64Bytes(built.data)]), null);
		const { complete, version } = built;
		await d.host.handle({ cmd: "backup_uploaded", conversation_id: dm, day, complete, version });
		expect((await d.routes.segments({ conversation_id: dm })).map((segment) => segment.day)).toContain(day);

		const fresh = await deviceOf(dave);
		try {
			await fresh.engine.start();
			expect(fresh.engine.state).toEqual({ name: "new_device" });
			await fresh.engine.recover(key);
			await eventually(async () => (await fresh.engine.messages(dm, [before.id]))[0]?.text === text);
			// Restored, it shows nothing more of its backup: up to date.
			await eventually(async () => fresh.engine.state.name === "ready" && !fresh.engine.state.backup);
		} finally {
			await fresh.end();
		}
	}, 180_000);

	// Carol's new device, approved by the one the cases above left her, by the code it shows: on the API's list, and in
	// her DM's group, where it reads what Dave sends.
	test("a device approved by code joins", async () => {
		const pair = carolAndDave;
		if (!pair) throw new Error("the case before left no conversation");
		const { c, d, dm } = pair;
		const carol = account(2);
		const fresh = await deviceOf(carol);
		const asked = () => (c.engine.state.name === "ready" ? c.engine.state.approval : undefined);
		try {
			await fresh.engine.start();
			expect(fresh.engine.state).toEqual({ name: "new_device" });
			await fresh.engine.beginApproval();
			await fresh.engine.useCode();
			const own = fresh.registered.at(-1)!;
			await eventually(async () => asked()?.step === "asked");
			expect(asked()).toMatchObject({ device: own, name: deviceName() });
			await c.engine.approveDevice(own);
			await eventually(async () => asked()?.step === "code");
			const { code } = asked()!;
			await eventually(async () => {
				const shown = fresh.engine.state;
				return shown.name === "new_device" && shown.setup?.way === "code" && shown.setup.offered;
			});
			await fresh.engine.acceptCode(code!);
			await c.engine.confirmApproval(own);
			await eventually(async () => fresh.engine.state.name === "ready");
			expect((await fresh.routes.devices()).find(({ current }) => current)).toMatchObject({ id: own, listed: true });
			await eventually(async () => asked() === undefined);

			await inOneGroup([c, d, fresh], dm);
			const text = "welcome, new device";
			const sent = (await d.engine.sendMessage({ conversation_id: dm, nonce: crypto.randomUUID(), text }))!;
			await eventually(async () => (await fresh.engine.messages(dm, [sent.id]))[0]?.text === text);
		} finally {
			await fresh.end();
		}
	}, 180_000);

	// Starting over (review M7): Bob's new device starts over, as one with neither his key nor another device of his
	// would, and his DM with Carol takes it back once Carol's engine commits the removal of his first device, which the
	// API's removals worker proposes as the groups' external sender. Last of all: it leaves Bob's first device removed.
	test("a device that started over is let back in by another member's engine", async () => {
		const pair = carolAndDave;
		if (!pair || !aliceAndBob) throw new Error("the cases before left no devices");
		const { c } = pair;
		const bob = account(1);
		const fresh = await deviceOf(bob);
		try {
			// Carol and Bob are friends since the members' case.
			const made = await c.client.post<{ id: string }>("/api/users/@me/conversations", { type: 1, user_id: bob.id });
			const dm = made.data.id;
			// Carol's device makes the DM's group, with Bob's first device in it, which the members' case left running.
			await c.engine.openConversation(dm);
			await eventually(async () => (await heldGroup(c, dm)) !== null);

			await fresh.engine.start();
			expect(fresh.engine.state).toEqual({ name: "new_device" });
			await fresh.engine.resetIdentity();
			await fresh.engine.keySaved();
			expect(fresh.engine.state.name).toBe("ready");
			await inOneGroup([c, fresh], dm);
			// Two commits past the group's first epoch: the removal, by Carol's device (no device commits its own removal,
			// and her other one no longer runs), then this device's join.
			expect((await heldGroup(fresh, dm))?.epoch).toBeGreaterThanOrEqual(3);
			const text = "welcome back";
			const sent = (await c.engine.sendMessage({ conversation_id: dm, nonce: crypto.randomUUID(), text }))!;
			await eventually(async () => (await fresh.engine.messages(dm, [sent.id]))[0]?.text === text);
		} finally {
			await fresh.end();
		}
	}, 180_000);

	// Contacts (PLAN-E2E-CLIENTES.md, Task 28): Carol and Dave compare their security number, the same 60 digits on both
	// sides, and Carol marks Dave verified, which marks nothing on his device. Dave changes his keys: Carol's device,
	// told by the gateway, shows the strong notice and holds her next message until she says yes, and the new number is
	// the same again on both sides. Last of all, after the case above: it leaves Dave with new keys.
	test("two users compare their security number, and a verified one's new keys wait for a yes", async () => {
		const pair = carolAndDave;
		if (!pair) throw new Error("the cases before left no conversation");
		const { c, d, dm } = pair;
		const [carol, dave] = [account(2), account(3)];
		const ours = await c.engine.safetyNumber(dave.id);
		expect(ours.digits).toMatch(/^(\d{5} ){11}\d{5}$/);
		expect(await d.engine.safetyNumber(carol.id)).toEqual(ours);
		expect(await c.engine.verifyContact(dave.id, ours.digits)).toBe(true);
		expect(await c.engine.contact(dave.id)).toBe(true);
		expect(await d.engine.contact(carol.id)).toBe(false);

		await d.engine.changeKeys();
		await d.engine.keySaved();
		expect(d.engine.state).toEqual({ name: "ready" });
		await eventually(async () => c.engine.contacts().changes[dave.id]?.verified === true);
		expect(await c.engine.contact(dave.id)).toBe(false);
		const nonce = crypto.randomUUID();
		const text = "is this still you?";
		const held = await c.engine.sendMessage({ conversation_id: dm, nonce, text }).then(
			() => null,
			(error: unknown) => error,
		);
		expect(held).toMatchObject({ code: "key_changed", users: [dave.id] });
		let went: DirectMessage | null = null;
		c.engine.onSent((_conversation, sent, message) => {
			if (sent === nonce) went = message;
		});
		// Her yes names the change she was shown.
		const change = c.engine.contacts().changes[dave.id]?.change ?? "";
		await c.engine.confirmKeyChanges([{ user: dave.id, change }]);
		await eventually(async () => went !== null);
		const id = (went as DirectMessage | null)?.id ?? "";
		await eventually(async () => (await d.engine.messages(dm, [id]))[0]?.text === text);
		const now = await c.engine.safetyNumber(dave.id);
		expect(now.digits).not.toBe(ours.digits);
		expect(await d.engine.safetyNumber(carol.id)).toEqual(now);
	}, 180_000);
});

/** The conversation's group as the device's core holds it, or null without one. */
const heldGroup = (device: Device, conversation: string) =>
	device.host
		.handle<{ generation: number; epoch: number; authenticator: string }>({
			cmd: "group",
			conversation_id: conversation,
		})
		.catch(() => null);

/** Waits until the devices hold the conversation's group at one generation and epoch, with one authenticator. */
async function inOneGroup(devices: Device[], conversation: string): Promise<void> {
	await eventually(async () => {
		const groups = await Promise.all(devices.map((device) => heldGroup(device, conversation)));
		const [first] = groups;
		return groups.every((group) => group !== null && first !== null && Bun.deepEquals(group, first));
	}, 60_000);
}
