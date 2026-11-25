import { afterEach, describe, expect, test } from "bun:test";
import type { EnginePlatform } from "./engine.svelte";
import { toEngine } from "./events";
import type { CoreHost } from "./host";
import { shownKey, testDevice, testHost, until, useFake } from "./testing/engines";
import { FakeApi } from "./testing/fake-api";
import { FakeHub, FakeLocks } from "./testing/fake-tabs";
import { coreLibrary } from "./testing/host-bun";
import { BrowserTabs, lockName } from "./web/tabs";

// The engine's module and the stores it reaches are .svelte.ts modules whose $state only Svelte's compiler knows: here
// it's the value itself, set before they load.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const page = await import("./engine.svelte");
const { logout } = await import("$lib/api/auth");

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
});
