import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { base64Bytes } from "$lib/activity-thumbnail";
import { sessionApi } from "$lib/api/api";
import { e2eApi } from "$lib/api/e2e";
import type { EnginePlatform } from "./engine.svelte";
import { toEngine, type EngineEvent } from "./events";
import type { CoreHost } from "./host";
import { notice } from "./notices";
import { firstDevice, groupOf, rejection, shownKey, testDevice, testHost, until, useFake } from "./testing/engines";
import { FakeApi } from "./testing/fake-api";
import { FakeHub, FakeLocks } from "./testing/fake-tabs";
import { BunCoreHost, coreLibrary } from "./testing/host-bun";
import { BrowserTabs, lockName } from "./web/tabs";

// The engine's module and the stores it reaches are .svelte.ts modules whose $state only Svelte's compiler knows: here
// it's the value itself, set before they load.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const page = await import("./engine.svelte");
const { logout } = await import("$lib/api/auth");
const { toastStore } = await import("$lib/stores/toast.svelte");

// The page's engine (lib/e2e/engine.svelte.ts): one for the page on the desktop's one host, and on the web the engine of
// the tab that leads, which the user's other tabs show and ask (Ruling 16), on task 8's tabs with a test's locks and
// channel; its core closed as the user signs out.
const SLOW = 180_000;
const RECOVERY_KEY = /^[1-9A-HJ-NP-Za-km-z]{48}$/;

/** A platform with nothing of its own but what a test gives it. */
const platform = (given: Partial<EnginePlatform>): EnginePlatform => ({
	desktop: false,
	desktopHost: () => Promise.reject(new Error("no desktop host here")),
	webHost: () => Promise.reject(new Error("no web host here")),
	missing: () => [],
	persist: () => undefined,
	...given,
});

/** A host that counts its closes. */
const counted = (host: CoreHost, closed: () => void): CoreHost =>
	new Proxy(host, {
		get(target, name) {
			if (name === "close") return () => (closed(), target.close());
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

/** The page's session: the user's, signed in on the fake. */
function signedIn(fake: FakeApi): string {
	const user = fake.addUser();
	localStorage.setItem("duvet_session_token", fake.signIn(user).token);
	return user;
}

/** Runs `go` with the page's window, there's none outside a browser: where the page went. */
async function withWindow(go: () => Promise<unknown>): Promise<string> {
	const location = { href: "" };
	Object.defineProperty(globalThis, "window", { value: { location }, configurable: true });
	try {
		await go();
	} finally {
		Reflect.deleteProperty(globalThis, "window");
	}
	return location.href;
}

/** The page's engine on the desktop, on `host`, through the first device's flow: ready. */
async function readyOnDesktop(user: string, host: BunCoreHost) {
	await page.startEngine(user, platform({ desktop: true, desktopHost: async () => host }));
	await page.makeIdentity();
	await page.keySaved();
	expect(page.encryption.state).toEqual({ name: "ready" });
	return host.handle<{ device_id: string; identity_key: string }>({ cmd: "status" });
}

/** The core's database in the host's folder, opened again with its key: what's left there. */
async function reopened(host: BunCoreHost, user: string) {
	const again = testHost({ folder: host.folder, key: base64Bytes(host.key) });
	await again.open(user);
	return { host: again, status: await again.handle<Record<string, unknown>>({ cmd: "status" }) };
}

afterEach(() => page.stopEngine());

describe.skipIf(!coreLibrary)("the page's engine", () => {
	test(
		"on the desktop, one engine on one host for the page, its core closed as the user signs out",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			let [hosts, closes] = [0, 0];
			const host = counted(testHost(), () => closes++);
			const desktop = platform({ desktop: true, desktopHost: async () => (hosts++, host) });
			await page.startEngine(ana, desktop);
			// The app page mounts again with every READY: the engine it started goes on.
			await page.startEngine(ana, desktop);
			expect(hosts).toBe(1);
			expect(page.encryption.state).toEqual({ name: "first_device", recoveryKey: null, finishing: false });
			await page.makeIdentity();
			expect(shownKey(page.encryption.state)).toMatch(RECOVERY_KEY);
			await page.keySaved();
			expect(page.encryption.state).toEqual({ name: "ready" });

			Object.defineProperty(globalThis, "window", { value: { location: { href: "" } }, configurable: true });
			try {
				await logout();
			} finally {
				Reflect.deleteProperty(globalThis, "window");
			}
			expect(closes).toBe(1);
		},
		SLOW,
	);

	test(
		"on the web, the tab that leads runs the engine, and makes the storage last once its device is set up",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			let [hosts, persisted] = [0, 0];
			const web = platform({
				tabs: { locks: new FakeLocks(), channel: new FakeHub().channel(lockName(ana)) },
				webHost: async () => (hosts++, testHost()),
				persist: async () => persisted++,
			});
			await page.startEngine(ana, web);
			await until(() => page.encryption.state.name === "first_device");
			// The person's taps go through the tabs, here to this tab's own engine.
			await page.makeIdentity();
			expect(shownKey(page.encryption.state)).toMatch(RECOVERY_KEY);
			await page.keySaved();
			expect(page.encryption.state).toEqual({ name: "ready" });
			expect(persisted).toBe(1);
			// Ready again, after the user's identity changed: the storage was made to last already.
			toEngine({ type: "IDENTITY_UPDATE", data: { user_id: ana, identity_key: "", device_list_version: 1 } });
			await page.makeIdentity();
			expect(page.encryption.state).toEqual({ name: "ready" });
			expect([hosts, persisted]).toEqual([1, 1]);
		},
		SLOW,
	);

	test(
		"on the web, a tab that doesn't lead shows the leader's state, its taps run there, and it opens no core",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const [locks, hub] = [new FakeLocks(), new FakeHub()];
			// The user's tab that leads: its engine, its session, its core.
			const leader = testDevice(fake, ana);
			const { engine } = leader;
			const leading = new BrowserTabs({
				...{ userId: ana, locks, channel: hub.channel(lockName(ana)) },
				methods: {
					state: () => engine.state,
					makeIdentity: () => engine.makeIdentity(),
					keySaved: () => engine.keySaved(),
					uploadLater: () => engine.uploadLater(),
					startOver: () => engine.startOver(),
				},
				lead: () => engine.start(),
			});
			await leading.leading;
			let hosts = 0;
			const web = platform({
				tabs: { locks, channel: hub.channel(lockName(ana)) },
				webHost: async () => (hosts++, testHost()),
			});
			await page.startEngine(ana, web);
			await until(() => page.encryption.state.name === "first_device");
			await page.makeIdentity();
			expect(shownKey(page.encryption.state)).toMatch(RECOVERY_KEY);
			expect(page.encryption.state).toEqual(engine.state);
			await page.keySaved();
			expect(page.encryption.state).toEqual({ name: "ready" });
			expect(engine.state).toEqual({ name: "ready" });
			expect(hosts).toBe(0);
			await page.stopEngine();
			await engine.stop();
			leading.close();
		},
		SLOW,
	);

	// Task 22's review, M7: on the web, the tab that leads has no engine (its host didn't load). A new conversation is
	// made by the API alone, as on a page without an engine, not refused as not ready; its group waits for a device that
	// can make it.
	test(
		"on the web, a conversation made while the leading tab has no engine is made by the API alone",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const bo = fake.addUser();
			fake.befriend(ana, bo);
			const [locks, hub] = [new FakeLocks(), new FakeHub()];
			const broken = () => Promise.reject(new Error("the worker didn't load"));
			await page.startEngine(ana, platform({ tabs: { locks, channel: hub.channel(lockName(ana)) }, webHost: broken }));
			const made = await page.createDM(bo);
			expect(made.members.map((member) => member.user_id).sort()).toEqual([ana, bo].sort());
			const api = e2eApi(sessionApi({ token: localStorage.getItem("duvet_session_token")!, sessionToken: null }));
			const listed = (await api.conversations()).find((conv) => conv.id === made.id);
			expect(listed?.mls ?? null).toBeNull();
		},
		SLOW,
	);

	// M6: a conversation's view opens it once. One that opened before the page had its engine (the desktop's host
	// still loading) is opened by the engine once it's ready.
	test(
		"a conversation opened before the page has its engine gets its group once the engine is ready",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const bo = fake.addUser();
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const b = await firstDevice(fake, bo);
			let loaded = () => {};
			const loading = new Promise<void>((resolve) => (loaded = resolve));
			const host = testHost();
			const starting = page.startEngine(
				ana,
				platform({ desktop: true, desktopHost: async () => (await loading, host) }),
			);
			await page.openConversation(conversation);
			loaded();
			await starting;
			await page.makeIdentity();
			await page.keySaved();
			expect(page.encryption.state).toEqual({ name: "ready" });
			// Ready, the engine opens it: Ana's device makes the DM's group, and Bo's comes in.
			const listed = (await b.api.conversations()).find((conv) => conv.id === conversation);
			expect(listed?.mls).toMatchObject({ generation: 0 });
			await until(async () => (await groupOf(b, conversation)) !== null);
		},
		SLOW,
	);

	// Decision 13: deleting a device's data is an act of its own, beside signing out.
	test(
		"removing this device deletes its data and signs out",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const token = localStorage.getItem("duvet_session_token")!;
			const host = testHost();
			const { device_id } = await readyOnDesktop(ana, host);
			// The device every identify names (lib/e2e/client.ts): it goes with the data (M4).
			expect(localStorage.getItem(`duvet.e2e.${ana}.device`)).toBe(device_id);

			const went = await withWindow(() => page.removeThisDevice());
			// Signed out: the page went to sign in, and the API ended its session.
			expect(went).toContain("sign-in");
			expect(localStorage.getItem("duvet_session_token")).toBeNull();
			expect(localStorage.getItem(`duvet.e2e.${ana}.device`)).toBeNull();
			const ended = e2eApi(sessionApi({ token, sessionToken: null })).devices();
			expect(await rejection(ended)).toMatchObject({ response: { status: 401 } });
			// Its data is gone: its folder holds a new database, of no device.
			const left = await reopened(host, ana);
			expect(left.status).not.toHaveProperty("device_id");
			await left.host.close();
		},
		SLOW,
	);

	// M9: the tab that leads deleted the data for another tab; its engine and its lock mustn't outlive the session.
	test(
		"on the web, the tab that leads signs out once it deleted its data for another tab, and lets the lock go",
		async () => {
			const fake = new FakeApi();
			// The leader's sign-out takes its request's round trip before it lets the lock go, as over a network: its
			// answer reaches the other tab first.
			spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
				const request = new Request(input, init);
				if (new URL(request.url).pathname === "/api/auth/logout") await Bun.sleep(50);
				return fake.fetch(request);
			}) as typeof fetch);
			const ana = signedIn(fake);
			const [locks, hub] = [new FakeLocks(), new FakeHub()];
			const host = testHost();
			await page.startEngine(
				ana,
				platform({ tabs: { locks, channel: hub.channel(lockName(ana)) }, webHost: async () => host }),
			);
			await until(() => page.encryption.state.name === "first_device");
			await page.makeIdentity();
			await page.keySaved();
			expect(page.encryption.state).toEqual({ name: "ready" });
			// Another tab of the user's, waiting for the lock this page holds, asks it to delete the device's data.
			const other = new BrowserTabs({
				...{ userId: ana, locks, channel: hub.channel(lockName(ana)) },
				methods: {},
				lead: async () => {},
			});
			const location = { href: "" };
			Object.defineProperty(globalThis, "window", { value: { location }, configurable: true });
			try {
				await other.call("removeThisDevice");
				await until(() => location.href !== "", 15_000);
				// Its tabs closed with its engine: the other tab takes the lock.
				await other.leading;
			} finally {
				Reflect.deleteProperty(globalThis, "window");
				other.close();
			}
			expect(location.href).toContain("sign-in");
			const left = await reopened(host, ana);
			expect(left.status).not.toHaveProperty("device_id");
			await left.host.close();
		},
		SLOW,
	);

	test(
		"signing out leaves the device and its database",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const host = testHost();
			const { device_id, identity_key } = await readyOnDesktop(ana, host);

			await withWindow(logout);
			// The session ended, nothing else: the database opens with its device and its identity…
			const left = await reopened(host, ana);
			expect(left.status).toMatchObject({ device_id, identity_key, has_identity: true });
			// …and the API keeps the device on the list: the next sign-in on this core binds it again, and it's ready.
			const next = testDevice(fake, ana, { host: left.host });
			await next.engine.start();
			expect(next.engine.state).toEqual({ name: "ready" });
			expect(next.registered).toEqual([device_id]);
			expect(await next.api.devices()).toMatchObject([{ id: device_id, listed: true, current: true }]);
			await next.engine.stop();
		},
		SLOW,
	);

	test(
		"what the engine tells of the user's devices shows in the notices' words",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			// The page's gateway connection, which hands the engine what it hears (connection.ts does it in the app).
			const token = localStorage.getItem("duvet_session_token")!;
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake's events are the API's, as the gateway hands them on
			fake.connect(token, null, (event) => toEngine(event as EngineEvent));
			const host = testHost();
			await readyOnDesktop(ana, host);
			const shown = (text: string) => toastStore.items.some(({ message }) => message === text);

			// Another device of the user's registers.
			const other = testDevice(fake, ana);
			await other.engine.start();
			await other.engine.stop();
			const name = "Duvet for Windows";
			await until(() => shown(notice("device_added", { name })));

			// Not seen in 45 days: the page's next engine warns of it.
			fake.lastSeen(other.registered[0]!, new Date(Date.now() - 46 * 24 * 3600 * 1000).toISOString());
			await page.stopEngine();
			await page.startEngine(ana, platform({ desktop: true, desktopHost: async () => host }));
			await until(() => shown(notice("inactive_warning", { device: name })));
		},
		SLOW,
	);
});
