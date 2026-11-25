// The live tests (PLAN-E2E-CLIENTES.md, Task 11): the app's own code against a real API and gateway, which the API's
// suite clients-desktop starts and names: E2E_LIVE_API and E2E_LIVE_WS, its seeded accounts (E2E_LIVE_ACCOUNTS, JSON:
// each one's id and email) and their password (E2E_LIVE_PASSWORD). Outside that suite, as in the app's own run, they're
// skipped. Each engine task adds its cases here, on the core the desktop carries (native/core).
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import api, { sessionApi } from "$lib/api/api";
import type { DirectMessage } from "$lib/api/conversations";
import { logIn } from "$lib/api/auth";
import { e2eApi } from "$lib/api/e2e";
import { identifyData } from "$lib/api/ws/identify";
import { getWSHostURL } from "$lib/common/common";
import { deviceName } from "../client";
import { E2EEngine, systemClock } from "../engine/engine";
import type { EngineEvent, EngineEvents } from "../events";
import { memoryStore } from "./engines";
import { BunCoreHost } from "./host-bun";

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
	const engine = new E2EEngine({
		...{ host, api: routes, events: socket.events, clock: systemClock, user: who.id },
		store: memoryStore(),
		deviceName: deviceName(),
		registered: (id) => {
			registered.push(id);
			socket.connect(id);
		},
	});
	socket.connect(null);
	const end = async () => {
		await engine.stop();
		socket.close();
		rmSync(host.folder, { recursive: true, force: true });
	};
	return { client, routes, socket, host, registered, engine, end };
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
/** Carol's and Dave's devices and their DM, which the groups' case leaves to the messages' case after it. */
let carolAndDave: { c: Device; d: Device; dm: string } | null = null;
afterAll(async () => {
	if (carolAndDave) await Promise.all([carolAndDave.c.end(), carolAndDave.d.end()]);
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
		} finally {
			await Promise.all([a.end(), b.end()]);
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
			for (const device of [c, d]) {
				await device.engine.start();
				await device.engine.makeIdentity();
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
});
