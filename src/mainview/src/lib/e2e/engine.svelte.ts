// The app's encryption engine (PLAN-E2E-CLIENTES.md, «El motor»): one for the page, started once the app has a session
// and knows whose (its READY), on the page's one host. In the desktop app that's Bun's core, through one host for the
// page, as each host hears every reply of Bun's for good. On the web it's the worker of the tab that leads, which runs
// the engine and serves the user's other tabs (web/tabs.ts, Ruling 16): they show its state, and ask it for the
// person's taps. `encryption.state` is what the views read.
import { onSignOut } from "$lib/api/auth";
import { e2eApi } from "$lib/api/e2e";
import { deviceRegistered } from "$lib/api/ws/connection";
import { isElectrobunWindow } from "$lib/electrobun-rpc";
import { deviceName } from "./client";
import { E2EEngine, systemClock, type EngineState } from "./engine/engine";
import { pageStore } from "./engine/store";
import { engineEvents } from "./events";
import type { CoreHost } from "./host";
import { desktopCoreHost } from "./host-desktop";
import { WebCoreHost } from "./host-web";
import { missingInPage } from "./web/support";
import { BrowserTabs } from "./web/tabs";

export const encryption = $state<{ state: EngineState }>({ state: { name: "starting" } });

let started = false;
let engine: E2EEngine | null = null;
let tabs: BrowserTabs | null = null;
let persisted = false;

function show(state: EngineState) {
	encryption.state = state;
	// On the web, once the device is set up: clearing the site's data would make this browser a new device.
	if (state.name !== "ready" || persisted || isElectrobunWindow()) return;
	persisted = true;
	navigator.storage?.persist?.().catch((error: unknown) => console.error("[e2e] Storage wasn't made to last:", error));
}

function engineFor(userId: string, host: CoreHost): E2EEngine {
	const made = new E2EEngine({
		host,
		api: e2eApi(),
		events: engineEvents,
		store: pageStore(userId),
		clock: systemClock,
		user: userId,
		deviceName: deviceName(),
		registered: (device) => deviceRegistered(userId, device),
	});
	made.onState(show);
	return made;
}

/** Starts the page's engine for the session's user, once a page: its core closes as the user signs out. */
export async function startEngine(userId: string): Promise<void> {
	if (started) return;
	started = true;
	onSignOut(stopEngine);
	if (isElectrobunWindow()) {
		const host = await desktopCoreHost();
		if (!host) return;
		engine = engineFor(userId, host);
		return engine.start();
	}
	if (missingInPage().length) return show({ name: "unsupported" });
	tabs = new BrowserTabs({
		userId,
		methods: {
			state: () => engine?.state ?? encryption.state,
			makeIdentity: () => engine?.makeIdentity(),
			keySaved: () => engine?.keySaved(),
			startOver: () => engine?.startOver(),
		},
		lead: async () => {
			engine = engineFor(userId, new WebCoreHost());
			await engine.start();
		},
		onLeader: () => void follow(),
	});
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) void follow();
	});
	void follow();
}

/** A tab that doesn't lead shows the leader's state: asked as a leader starts, and as the tab shows again. */
async function follow(): Promise<void> {
	if (!tabs || tabs.leader) return;
	encryption.state = await tabs.call<EngineState>("state").catch(() => encryption.state);
}

/** One of the person's taps, run by the engine of this tab or of the one that leads. */
function tap(method: "makeIdentity" | "keySaved" | "startOver"): Promise<void> {
	if (tabs) return tabs.call<void>(method).finally(() => void follow());
	return engine?.[method]() ?? Promise.resolve();
}

export const makeIdentity = () => tap("makeIdentity");
export const keySaved = () => tap("keySaved");
export const startOver = () => tap("startOver");

/** Stops the engine and closes its core, whose database stays; on the web, this tab leaves the user's tabs after. */
export async function stopEngine(): Promise<void> {
	const stopping = engine;
	engine = null;
	await stopping?.stop();
	tabs?.close();
	tabs = null;
}
