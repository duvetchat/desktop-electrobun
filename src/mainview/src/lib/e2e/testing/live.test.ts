// The live tests (PLAN-E2E-CLIENTES.md, Task 11): the app's own code against a real API and gateway, which the API's
// suite clients-desktop starts and names: E2E_LIVE_API and E2E_LIVE_WS, its seeded accounts (E2E_LIVE_ACCOUNTS, JSON:
// each one's id and email) and their password (E2E_LIVE_PASSWORD). Outside that suite, as in the app's own run, they're
// skipped. Each engine task adds its cases here, on the core the desktop carries (native/core).
import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import api, { sessionApi } from "$lib/api/api";
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

	// The engine's start (PLAN-E2E-CLIENTES.md, Task 12): a first device, from its registration to its key packages.
	test("a device registers, binds its session and publishes its identity", async () => {
		if (!live) throw new Error("no stack");
		const bob = account(1);
		const session = await logIn({ email: bob.email, password: live.password });
		const routes = e2eApi(sessionApi({ token: session.token, sessionToken: session.session_token ?? null }));
		const socket = gateway(session.token);
		const host = new BunCoreHost();
		const registered: string[] = [];
		const engine = new E2EEngine({
			...{ host, api: routes, events: socket.events, clock: systemClock, user: bob.id },
			store: memoryStore(),
			deviceName: deviceName(),
			registered: (device) => {
				registered.push(device);
				socket.connect(device);
			},
		});
		socket.connect(null);
		try {
			await engine.start();
			expect(engine.state).toEqual({ name: "first_device", recoveryKey: null, finishing: false });
			const [device] = registered;
			expect(await routes.devices()).toMatchObject([{ id: device, listed: false, current: true }]);

			await engine.makeIdentity();
			const shown = engine.state;
			expect(shown.name === "first_device" && shown.recoveryKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{48}$/);
			await engine.keySaved();
			expect(engine.state).toEqual({ name: "ready" });

			// The API has the identity the core made, with this device listed as its one device.
			const status = await host.handle<{ identity_key: string; certificate: string }>({ cmd: "status" });
			const identity = await routes.identity(bob.id);
			expect(identity).toMatchObject({ identity_key: status.identity_key, device_list_version: 1 });
			expect(identity.certificates).toEqual([status.certificate]);
			expect(await routes.devices()).toMatchObject([{ id: device, listed: true, current: true }]);
			// The gateway took an identify naming the device: its session hands the device its own events.
			const deadline = Date.now() + 15_000;
			while (!socket.readies.includes(device!) && Date.now() < deadline) await Bun.sleep(50);
			expect(socket.readies).toContain(device!);
		} finally {
			await engine.stop();
			socket.close();
			rmSync(host.folder, { recursive: true, force: true });
		}
	}, 120_000);
});
