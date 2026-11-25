// The encryption engine (PLAN-E2E-CLIENTES.md, «El motor»): it carries what the core makes to the API and what the API
// hands out to the core, never opening or making anything itself. A class with its parts given to it, so the app has
// one (lib/e2e/engine.svelte.ts) and a test as many as it needs, each with its own core, session and gateway connection.
//
// Its work goes one flow at a time, in the order it came: the start («Arranque», steps 1 to 7, here without the
// conversations), the person's taps, and what the gateway's events ask for. bootstrap.ts, identity.ts, key-packages.ts
// and inbox.ts hold the steps; this class keeps the state the views read, and what's due later.
import { FetchError, UpdateRequiredError } from "$lib/api/api";
import type { E2eApi } from "$lib/api/e2e";
import { CoreError } from "../errors";
import type { EngineEvent, EngineEvents } from "../events";
import type { CoreHost, HostOpened } from "../host";
import { bindSession, ownDevice } from "./bootstrap";
import { identityState, publishIdentity, type IdentityMade } from "./identity";
import { takeInbox } from "./inbox";
import { uploadKeyPackages } from "./key-packages";
import { DEVICE_RECORD, type EngineStore } from "./store";

/** What the engine waits with: the system's timers in the app, a test's clock in its tests. */
export interface Clock {
	/** Runs `run` once `ms` have passed; what it gives calls it off. */
	later(ms: number, run: () => void): () => void;
}

export const systemClock: Clock = {
	later(ms, run) {
		const timer = setTimeout(run, ms);
		return () => clearTimeout(timer);
	},
};

export interface EngineParts {
	host: CoreHost;
	/** The routes, for the session the engine works for. */
	api: E2eApi;
	/** The gateway's events of that session. */
	events: EngineEvents;
	store: EngineStore;
	clock: Clock;
	/** The session's user. */
	user: string;
	/** This installation's name among the user's devices (client.ts's deviceName). */
	deviceName: string;
	/** The session is bound to this device, which every identify names from now on (Ruling 30). */
	registered(deviceId: string): void;
}

/**
 * What the views show (PLAN-E2E-CLIENTES.md, «El motor», its states). A first device waits for the person's tap to
 * make its identity, then shows its recovery key (`recoveryKey`) until it's saved; `finishing` when an identity it made
 * before the app closed still waits for its upload. `failed` with `lostKey` is a database its key no longer opens.
 */
export type EngineState =
	| { name: "starting" }
	| { name: "first_device"; recoveryKey: string | null; finishing: boolean }
	| { name: "new_device" }
	| { name: "ready" }
	| { name: "removed" }
	| { name: "locked" }
	| { name: "unsupported" }
	| { name: "failed"; lostKey: boolean }
	| { name: "update"; minimum: string | null };

const DAY = 24 * 3600 * 1000;
/** A start that failed goes again after 2 s, then twice as long each time, up to a minute apart. */
const RETRY_MS = 2_000;
const RETRY_MOST_MS = 60_000;

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);

export class E2EEngine {
	state: EngineState = { name: "starting" };
	readonly #parts: EngineParts;
	readonly #listeners = new Set<(state: EngineState) => void>();
	/** The flow under way: each one waits for the one before. */
	#turn: Promise<void> = Promise.resolve();
	#stopped = false;
	#unlisten: (() => void) | null = null;
	/** A start that failed and goes again (calls it off), and the uploads every day. */
	#retry: (() => void) | null = null;
	#retries = 0;
	#daily: (() => void) | null = null;
	/** The device this session is bound to, once it is. */
	#device: string | null = null;
	/** What create_identity answered, until it's uploaded: never kept elsewhere, as the core gives it again. */
	#made: IdentityMade | null = null;

	constructor(parts: EngineParts) {
		this.#parts = parts;
	}

	/** Each state the engine goes to, as it goes. */
	onState(listener: (state: EngineState) => void): () => void {
		this.#listeners.add(listener);
		return () => void this.#listeners.delete(listener);
	}

	/** Starts: hears the gateway's events, then runs «Arranque». It settles when the start's flow ended, whatever state. */
	start(): Promise<void> {
		this.#unlisten ??= this.#parts.events.listen((event) => this.#heard(event));
		return this.#queue(() => this.#boot());
	}

	/** Stops hearing and waiting, lets the flow under way end, and closes the core: its database stays (decision 13). */
	async stop(): Promise<void> {
		this.#stopped = true;
		this.#unlisten?.();
		this.#unlisten = null;
		this.#retry?.();
		this.#daily?.();
		await this.#turn;
		await this.#parts.host.close();
	}

	/**
	 * The person's tap on a first device: create_identity, whose recovery key the views show next. On the desktop Bun
	 * asks in its own box first (Ruling 6), and a no (`refused`) means not yet: nothing changes.
	 */
	makeIdentity(): Promise<void> {
		return this.#queue(async () => {
			const { state } = this;
			if (state.name !== "first_device") return;
			try {
				this.#made = await this.#parts.host.handle<IdentityMade>({ cmd: "create_identity" });
			} catch (error) {
				if (error instanceof CoreError && error.code === "refused") return;
				throw error;
			}
			this.#set({ name: "first_device", recoveryKey: this.#made.recovery_key, finishing: state.finishing });
		});
	}

	/**
	 * The person saved the recovery key: the identity goes up, and only once the API took it is it confirmed. A refusal or
	 * a lost answer rejects, the key still shown, and the same bytes go next time; another first device's identity there
	 * (409) has this one start over as a new device (Ruling 26).
	 */
	keySaved(): Promise<void> {
		return this.#queue(async () => {
			const made = this.#made;
			if (!made || this.state.name !== "first_device") return;
			if (!(await publishIdentity(this.#parts, made))) return this.#startOver();
			// Published and confirmed: the key's sheet is done with, and the start's last steps follow.
			this.#made = null;
			this.#set({ name: "starting" });
			await this.#settle().catch((error: unknown) => this.#failed(error));
		});
	}

	/** This installation starts again as a new device: what a removed device, or one whose key is lost, does on the
	 * person's word. */
	startOver(): Promise<void> {
		return this.#queue(() => this.#startOver());
	}

	#set(state: EngineState) {
		this.state = state;
		for (const listener of this.#listeners) listener(state);
	}

	/** Runs `work` once the flow before it ended (nothing once stopped). What it throws rejects this call alone. */
	#queue(work: () => Promise<void>): Promise<void> {
		const run = this.#turn.then(() => (this.#stopped ? undefined : work()));
		this.#turn = run.catch((error: unknown) => console.error("[e2e] The engine's work failed:", error));
		return run;
	}

	/** Work an event asks for: what fails is logged, and goes again with the next event that asks for it. */
	#soon(work: () => Promise<void>) {
		this.#queue(work).catch(() => {});
	}

	#heard(event: EngineEvent) {
		const own = (device: string) => device === this.#device;
		switch (event.type) {
			case "READY":
				// A new gateway session: a start that failed goes again now, and the inbox may have filled meanwhile.
				if (this.#retry) {
					this.#retry();
					this.#retry = null;
					this.#soon(() => this.#boot());
				} else if (this.#device) this.#soon(() => this.#inbox());
				break;
			case "DEVICE_MESSAGE":
				if (own(event.data.device_id)) this.#soon(() => this.#inbox());
				break;
			case "KEY_PACKAGES_LOW":
				if (own(event.data.device_id)) this.#soon(() => this.#keyPackages());
				break;
			case "DEVICE_REMOVE":
				if (own(event.data.device_id)) this.#set({ name: "removed" });
				break;
			case "IDENTITY_UPDATE":
				// The user's own: another device changed the list or the keys, which may leave this one off it.
				if (event.data.user_id === this.#parts.user && this.state.name === "ready") {
					this.#soon(async () => this.#set(await this.#identity()));
				}
				break;
		}
	}

	/** Step 5, with the inbox for a rotation's transfer this device may need first. */
	#identity(): Promise<EngineState> {
		return identityState(this.#parts, () => takeInbox(this.#parts));
	}

	/** The inbox; once it brought a rotation's transfer, the own user observed, which may change what this device is. */
	async #inbox(): Promise<void> {
		if (await takeInbox(this.#parts)) this.#set(await this.#identity());
	}

	/** «Arranque»: the API's configuration, the user's database, this installation's device and the session bound to it. */
	async #boot(): Promise<void> {
		const parts = this.#parts;
		try {
			await parts.api.config();
			const opened = await parts.host.open(parts.user);
			if (opened.state !== "ready") return this.#closed(opened);
			const { status, keys } = await ownDevice(parts);
			const device = status.device_id;
			if (!device || !(await bindSession(parts, device, keys))) return this.#set({ name: "removed" });
			this.#device = device;
			parts.registered(device);
			this.#retries = 0;
			// An identity made before the app closed, still waiting for its upload: the same command gives it again, its
			// recovery key with it, from the person's tap as the first time (step 4).
			if (status.waiting_upload === "create_identity") {
				return this.#set({ name: "first_device", recoveryKey: null, finishing: true });
			}
			await this.#settle();
		} catch (error) {
			this.#failed(error);
		}
	}

	/** A start that failed: a client too old waits for its update; anything else goes again later. */
	#failed(error: unknown) {
		if (error instanceof UpdateRequiredError) return this.#set({ name: "update", minimum: error.minimum });
		console.error("[e2e] The engine didn't start:", error);
		this.#later();
	}

	/** Steps 5 to 7: what the user's identity makes of this device, the inbox, and a listed device's key packages. */
	async #settle(): Promise<void> {
		const state = await this.#identity();
		this.#set(state);
		await this.#inbox();
		if (this.state.name !== "ready") return;
		await this.#keyPackages();
		this.#daily ??= this.#everyDay();
	}

	/** Uploads the key packages: nothing while this device isn't on the list, which the API refuses (e2eListed). */
	async #keyPackages(): Promise<void> {
		if (this.state.name === "ready") await uploadKeyPackages(this.#parts);
	}

	#everyDay(): () => void {
		return this.#parts.clock.later(DAY, () => {
			this.#daily = this.#everyDay();
			this.#soon(() => this.#keyPackages());
		});
	}

	/** The core didn't open: unsupported for good, a lost key until the person starts over, anything else again later. */
	#closed(opened: HostOpened) {
		if (opened.state === "unsupported") return this.#set({ name: "unsupported" });
		const lostKey = opened.state === "failed" && opened.reason === "bad_key";
		this.#set(opened.state === "locked" ? { name: "locked" } : { name: "failed", lostKey });
		if (!lostKey) this.#later();
	}

	/** The start goes again after a while, or at the next READY. */
	#later() {
		const ms = Math.min(RETRY_MOST_MS, RETRY_MS * 2 ** this.#retries++);
		this.#retry = this.#parts.clock.later(ms, () => {
			this.#retry = null;
			this.#soon(() => this.#boot());
		});
	}

	/**
	 * This installation as a new device (Ruling 26): its database destroyed with its key, then a new device registered,
	 * which this session binds to, and only then the old one's registration deleted, as deleting it ends its sessions.
	 * A device still on the list can't be deleted (409): another device of the user's takes it off.
	 */
	async #startOver(): Promise<void> {
		const { api, host, user, store } = this.#parts;
		const old = (await api.devices()).find((device) => device.current)?.id ?? null;
		await host.destroy(user);
		for (const key of DEVICE_RECORD) store.write(key, null);
		this.#made = null;
		this.#device = null;
		this.#daily?.();
		this.#daily = null;
		this.#set({ name: "starting" });
		await this.#boot();
		// Not before the session is bound to the new device: it would end with the old one.
		if (!old || !this.#device || old === this.#device) return;
		await api.deleteDevice(old).catch((error: unknown) => {
			const status = statusOf(error);
			if (status !== 404 && status !== 409) throw error;
		});
	}
}
