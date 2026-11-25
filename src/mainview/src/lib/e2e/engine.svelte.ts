// The app's encryption engine (PLAN-E2E-CLIENTES.md, «El motor»): one for the page, started once the app has a session
// and knows whose (its READY), on the page's one host. In the desktop app that's Bun's core, through one host for the
// page, as each host hears every reply of Bun's for good. On the web it's the worker of the tab that leads, which runs
// the engine and serves the user's other tabs (web/tabs.ts, Ruling 16): they show its state, and ask it for the
// person's taps. `encryption.state` is what the views read. The hosts load with the engine's start, never with a page.
import { onSignOut } from "$lib/api/auth";
import { e2eApi } from "$lib/api/e2e";
import { deviceRegistered } from "$lib/api/ws/connection";
import { isElectrobunWindow } from "$lib/electrobun-rpc";
import { deviceName } from "./client";
import { E2EEngine, systemClock, type EngineState } from "./engine/engine";
import { pageStore } from "./engine/store";
import { engineEvents } from "./events";
import type { CoreHost } from "./host";
import { missingInPage } from "./web/support";
import { BrowserTabs, type BrowserTabsOptions } from "./web/tabs";

export const encryption = $state<{ state: EngineState }>({ state: { name: "starting" } });

/** What the page's engine runs on: the page's own, or a test's (a host of its own, task 8's locks and channel). */
export interface EnginePlatform {
	desktop: boolean;
	desktopHost(): Promise<CoreHost | null>;
	webHost(): Promise<CoreHost>;
	/** What the web lacks for encrypted conversations (web/support.ts). */
	missing(): readonly string[];
	tabs?: Pick<BrowserTabsOptions, "locks" | "channel">;
	persist(): Promise<unknown> | undefined;
}

const pagePlatform = (): EnginePlatform => ({
	desktop: isElectrobunWindow(),
	desktopHost: () => import("./host-desktop").then(({ desktopCoreHost }) => desktopCoreHost()),
	webHost: () => import("./host-web").then(({ WebCoreHost }) => new WebCoreHost()),
	missing: missingInPage,
	persist: () => navigator.storage?.persist?.(),
});

let started = false;
let engine: E2EEngine | null = null;
let tabs: BrowserTabs | null = null;
let persisted = false;

function engineFor(userId: string, host: CoreHost, platform: EnginePlatform): E2EEngine {
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
	made.onState((state) => {
		encryption.state = state;
		// On the web, once the device is set up: clearing the site's data would make this browser a new device.
		if (state.name !== "ready" || persisted || platform.desktop) return;
		persisted = true;
		platform.persist()?.catch((error: unknown) => console.error("[e2e] Storage wasn't made to last:", error));
	});
	return made;
}

/** Starts the page's engine for the session's user, once until it stops: its core closes as the user signs out. */
export async function startEngine(userId: string, platform: EnginePlatform = pagePlatform()): Promise<void> {
	if (started) return;
	started = true;
	onSignOut(stopEngine);
	if (platform.desktop) {
		const host = await platform.desktopHost();
		if (!host) return;
		engine = engineFor(userId, host, platform);
		return engine.start();
	}
	if (platform.missing().length) {
		encryption.state = { name: "unsupported" };
		return;
	}
	tabs = new BrowserTabs({
		userId,
		...platform.tabs,
		methods: {
			state: () => engine?.state ?? encryption.state,
			makeIdentity: () => engine?.makeIdentity(),
			keySaved: () => engine?.keySaved(),
			uploadLater: () => engine?.uploadLater(),
			startOver: () => engine?.startOver(),
		},
		lead: async () => {
			engine = engineFor(userId, await platform.webHost(), platform);
			await engine.start();
		},
		onLeader: () => void follow(),
	});
	if (typeof document !== "undefined") {
		document.addEventListener("visibilitychange", () => {
			if (!document.hidden) void follow();
		});
	}
	void follow();
}

/** A tab that doesn't lead shows the leader's state: asked as a leader starts, and as the tab shows again. */
async function follow(): Promise<void> {
	if (!tabs || tabs.leader) return;
	encryption.state = await tabs.call<EngineState>("state").catch(() => encryption.state);
}

type Tap = "makeIdentity" | "keySaved" | "uploadLater" | "startOver";

/** One of the person's taps, run by the engine of this tab or of the one that leads: it settles with its state shown. */
function tap(method: Tap): Promise<void> {
	if (tabs) return tabs.call<void>(method).finally(follow);
	return engine?.[method]() ?? Promise.resolve();
}

export const makeIdentity = () => tap("makeIdentity");
export const keySaved = () => tap("keySaved");
export const uploadLater = () => tap("uploadLater");
export const startOver = () => tap("startOver");

/** Stops the engine and closes its core, whose database stays; on the web, this tab leaves the user's tabs after. */
export async function stopEngine(): Promise<void> {
	const stopping = engine;
	engine = null;
	started = false;
	await stopping?.stop();
	tabs?.close();
	tabs = null;
}
