// Engines on the fake API, for the engine's tests (PLAN-E2E-CLIENTES.md, «El motor»): each one a device of a user, with
// its own core (host-bun.ts), session, gateway connection and record, so a test runs as many as it needs in one process.
// The fake answers fetch while a test runs (useFake), as the API answers the app's requests.
import { afterAll, afterEach, mock, spyOn } from "bun:test";
import { rmSync } from "node:fs";
import { sessionApi } from "$lib/api/api";
import { e2eApi, type E2eApi } from "$lib/api/e2e";
import type { EngineEvent } from "../events";
import type { CoreHost } from "../host";
import { E2EEngine, type Clock, type EngineState } from "../engine/engine";
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

/** A clock a test moves on by hand: what's due runs as it passes, in order. */
export class TestClock implements Clock {
	#now = 0;
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
	});
	const states: EngineState[] = [];
	engine.onState((state) => states.push(state));
	connect(null);
	return { engine, host, user, token, api, store, clock, heard, registered, states, connect };
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

/** Waits until `holds` is true, as an engine's work after an event ends in its own time: past `ms`, it fails. */
export async function until(holds: () => boolean | Promise<boolean>, ms = 60_000): Promise<void> {
	const end = Date.now() + ms;
	while (!(await holds())) {
		if (Date.now() > end) throw new Error("what the test waited for never came");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
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
