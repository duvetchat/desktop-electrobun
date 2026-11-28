import { describe, expect, test } from "bun:test";
import { base64Bytes } from "$lib/activity-thumbnail";
import { CoreError } from "../errors";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	answeringHost,
	firstDevice,
	resetFrom,
	testDevice,
	testHost,
	until,
	useFake,
	watchedHost,
} from "../testing/engines";
import type { CoreStatus } from "./bootstrap";
import { DEVICE_KEYS } from "./store";

// The engine's start (PLAN-E2E-CLIENTES.md, «El motor», «Arranque»): the API's configuration, the user's database,
// this installation's device and the session bound to it, and what the user's identity makes of the device.
const SLOW = 180_000;
const MINUTE = 60_000;

describe.skipIf(!coreLibrary)("the engine's start", () => {
	test(
		"the same installation signs in again and is the same device",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			await a.engine.stop();

			// A new sign-in: a session the device isn't bound to yet, on the same database and record.
			const again = testDevice(fake, ana, { host: a.host, store: a.store });
			await again.engine.start();
			expect(again.engine.state).toEqual({ name: "ready" });
			// Its keys registered again: the same device, now this session's, and no new one announced.
			expect(again.registered).toEqual(a.registered);
			expect(await again.api.devices()).toMatchObject([{ id: a.registered[0], listed: true, current: true }]);
			expect(again.heard.filter((event) => event.type === "DEVICE_ADD")).toEqual([]);
			await again.engine.stop();
		},
		SLOW,
	);

	test(
		"a record that keeps nothing still registers a new device",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			// localStorage that refuses every write: the keys the device was just made with register it all the same.
			const a = testDevice(fake, ana, { store: { read: () => null, write: () => {} } });
			await a.engine.start();
			expect(a.engine.state).toEqual({ name: "first_device", recoveryKey: null, finishing: false });
			expect(await a.api.devices()).toMatchObject([{ id: a.registered[0], current: true }]);
			await a.engine.stop();
		},
		SLOW,
	);

	test(
		"a device taken off its list says so",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const b = testDevice(fake, ana);
			await b.engine.start();
			expect(b.engine.state).toEqual({ name: "new_device" });

			await resetFrom(b);

			// The first device hears its user's identity changed, and finds no transfer for itself: it's off the list.
			await until(() => a.engine.state.name === "removed");
			await a.engine.stop();
			// And so says its next start.
			const again = testDevice(fake, ana, { host: a.host, store: a.store, token: a.token });
			await again.engine.start();
			expect(again.engine.state).toEqual({ name: "removed" });
			await again.engine.stop();

			// Taken away for good (its sessions end with it), a sign-in again finds its ID refused.
			await b.api.deleteDevice(a.registered[0]!);
			const later = testDevice(fake, ana, { host: a.host, store: a.store });
			await later.engine.start();
			expect(later.engine.state).toEqual({ name: "removed" });
			// Set up again: a new device of Ana's, which waits for her key or another device.
			await later.engine.startOver();
			expect(later.engine.state).toEqual({ name: "new_device" });
			// Its first device was refused, so the new one is the first it registered.
			const [now] = later.registered;
			expect(later.registered).toHaveLength(1);
			expect(now).not.toBe(a.registered[0]);
			expect((await later.api.devices()).find((device) => device.current)?.id).toBe(now);
			await Promise.all([b.engine.stop(), later.engine.stop()]);
		},
		SLOW,
	);

	test(
		"a database another instance holds is locked until it lets go",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const host = testHost();
			const a = await firstDevice(fake, ana, { host });
			const second = testDevice(fake, ana, {
				host: testHost({ folder: host.folder, key: base64Bytes(host.key) }),
				store: a.store,
				token: a.token,
			});
			await second.engine.start();
			expect(second.engine.state).toEqual({ name: "locked" });
			await a.engine.stop();
			// It tries again later, and opens once the first let go.
			second.clock.advance(MINUTE);
			await until(() => second.engine.state.name === "ready");
			expect(second.registered).toEqual(a.registered);
			await second.engine.stop();
		},
		SLOW,
	);

	test(
		"a database whose key is lost can't open again, and the device starts over as a new one",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const host = testHost();
			const a = await firstDevice(fake, ana, { host });
			await a.engine.stop();
			const log: string[] = [];
			const lost = watchedHost(testHost({ folder: host.folder, key: new Uint8Array(32) }), log);
			const again = testDevice(fake, ana, { host: lost, store: a.store, token: a.token });
			await again.engine.start();
			expect(again.engine.state).toEqual({ name: "failed", lostKey: true });
			// Not a passing failure: nothing tries again by itself.
			again.clock.advance(10 * MINUTE);
			await again.engine.makeIdentity();
			expect(again.engine.state).toEqual({ name: "failed", lostKey: true });
			expect(log).toEqual([]);

			// Its data deleted on the person's word, a new device: the user has an identity, which it waits to be given.
			await again.engine.startOver();
			expect(again.engine.state).toEqual({ name: "new_device" });
			expect(again.registered).toHaveLength(1);
			expect(again.registered[0]).not.toBe(a.registered[0]);
			await again.engine.stop();
		},
		SLOW,
	);

	test(
		"a failure on the way is tried again; a host without the core, or a client too old, isn't",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			fake.refuse({ method: "GET", path: "/api/e2e" }, 502, { error: "bad gateway" });
			const a = testDevice(fake, ana);
			await a.engine.start();
			expect(a.engine.state).toEqual({ name: "starting" });
			a.clock.advance(MINUTE);
			await until(() => a.engine.state.name === "first_device");
			await a.engine.stop();

			// A build that carries no core (an Intel Mac's): the host says so, and nothing more is asked.
			const log: string[] = [];
			const none = watchedHost(testHost(), log);
			const bare = testDevice(fake, ana, {
				host: new Proxy(none, {
					get: (target, name) => (name === "open" ? async () => ({ state: "unsupported" }) : Reflect.get(target, name)),
				}),
			});
			await bare.engine.start();
			expect(bare.engine.state).toEqual({ name: "unsupported" });
			bare.clock.advance(10 * MINUTE);
			expect(log).toEqual([]);
			await bare.engine.stop();

			// A client below its platform's minimum: the API says which version, or none where the platform has no encryption.
			fake.minClients = { "desktop-windows": "1.2.0", web: "99.0.0" };
			const old = testDevice(fake, ana);
			await old.engine.start();
			expect(old.engine.state).toEqual({ name: "update", minimum: "99.0.0" });
			await old.engine.stop();
			fake.minClients = { "desktop-windows": "1.2.0" };
			const elsewhere = testDevice(fake, ana);
			await elsewhere.engine.start();
			expect(elsewhere.engine.state).toEqual({ name: "update", minimum: null });
			await elsewhere.engine.stop();
		},
		SLOW,
	);

	// I3: a stale tap (a bar of another tab's, or from before) never destroys a database in use.
	test(
		"starting over is only for a removed device or a lost key",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const b = testDevice(fake, ana);
			await b.engine.start();
			for (const device of [a, b]) {
				const before = await device.host.handle<object>({ cmd: "status" });
				const state = device.engine.state;
				await device.engine.startOver();
				expect(device.engine.state).toEqual(state);
				expect(device.registered).toHaveLength(1);
				expect(await device.host.handle<object>({ cmd: "status" })).toEqual(before);
			}
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// M7: the record's keys are a device's, by its ID; a registration's 409 is no answer about the device yet.
	test(
		"keys the record kept for another device aren't sent, and a refused registration binds by the bind route",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const registrations: string[] = [];
			useFake(fake, (request) => {
				const { pathname } = new URL(request.url);
				if (request.method === "POST" && pathname === "/api/users/@me/devices") registrations.push(pathname);
			});
			const a = await firstDevice(fake, ana);
			await a.engine.stop();
			const b = testDevice(fake, ana);
			await b.engine.start();
			const others = b.store.read<Record<string, string>>(DEVICE_KEYS)!;

			// The record holds another device's keys, as when the database was made again and the record wasn't.
			a.store.write(DEVICE_KEYS, others);
			registrations.length = 0;
			const again = testDevice(fake, ana, { host: a.host, store: a.store });
			await again.engine.start();
			expect(again.engine.state).toEqual({ name: "ready" });
			expect(again.registered).toEqual(a.registered);
			expect(registrations).toEqual([]);
			await again.engine.stop();

			// Under this device's ID, keys that aren't its own: the API refuses them (409), and the bind route binds it.
			a.store.write(DEVICE_KEYS, { ...others, device_id: a.registered[0]! });
			const later = testDevice(fake, ana, { host: a.host, store: a.store });
			await later.engine.start();
			expect(later.engine.state).toEqual({ name: "ready" });
			expect(later.registered).toEqual(a.registered);
			expect(registrations).toHaveLength(1);
			await Promise.all([b.engine.stop(), later.engine.stop()]);
		},
		SLOW,
	);

	test(
		"a binding the API refuses for good ends the tries with the failed bar",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			fake.refuse({ method: "POST", path: "/api/users/@me/devices" }, 400, { error: "invalid device" });
			const log: string[] = [];
			const a = testDevice(fake, ana, { host: watchedHost(testHost(), log) });
			await a.engine.start();
			expect(a.engine.state).toEqual({ name: "failed", lostKey: false });
			const asked = log.length;
			// Neither the time nor a new gateway session brings it back: the API would refuse it again.
			a.clock.advance(10 * MINUTE);
			a.connect(null);
			await a.engine.makeIdentity();
			expect(a.engine.state).toEqual({ name: "failed", lostKey: false });
			expect(log).toHaveLength(asked);
			await a.engine.stop();
		},
		SLOW,
	);

	// desktop-electrobun#558: the desktop asks before it opens an account's database it never opened; #611: a no is
	// asked again on the person's Try again, never by itself.
	test(
		"a no to opening this account's database waits for the person's Try again, which asks again",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const answers = [false, true];
			let asked = 0;
			const host = new Proxy(testHost(), {
				get(target, name) {
					if (name === "open") {
						return async (userId: string) => {
							asked++;
							if (!answers.shift()) throw new CoreError("refused", "the person didn't confirm it");
							return target.open(userId);
						};
					}
					const value = Reflect.get(target, name);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			const a = testDevice(fake, ana, { host });
			await a.engine.start();
			expect(a.engine.state).toEqual({ name: "failed", lostKey: false, refused: true });
			// Neither the time nor a new gateway session asks again: the person said no.
			a.clock.advance(10 * MINUTE);
			a.connect(null);
			await a.engine.makeIdentity();
			expect(a.engine.state).toEqual({ name: "failed", lostKey: false, refused: true });
			expect(asked).toBe(1);
			// Their Try again asks again, and the yes opens it.
			await a.engine.tryAgain();
			expect(asked).toBe(2);
			expect(a.engine.state).toEqual({ name: "first_device", recoveryKey: null, finishing: false });
			// Nothing waits for another Try again.
			await a.engine.tryAgain();
			expect(asked).toBe(2);
			await a.engine.stop();
		},
		SLOW,
	);

	// PLAN-E2E-PLATAFORMAS.md, Task 4 (Review Focus 4): a keyring that didn't open (a locked Secret Service, a Keychain
	// that refused) is the core's `storage`: a failure another open may get past, never a lost key. It goes again by
	// itself, and the person's Try again opens it now.
	test(
		"a keyring that didn't open says so, and Try again opens it now",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			let [refusals, opens] = [1, 0];
			const host = new Proxy(testHost(), {
				get(target, name) {
					if (name === "open") {
						return async (userId: string) => {
							opens++;
							return refusals-- > 0 ? { state: "failed", reason: "storage" } : target.open(userId);
						};
					}
					const value = Reflect.get(target, name);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			const a = testDevice(fake, ana, { host });
			await a.engine.start();
			expect(a.engine.state).toEqual({ name: "failed", lostKey: false, storage: true });
			// Now, before the time its next try waits for.
			await a.engine.tryAgain();
			expect(a.engine.state).toEqual({ name: "first_device", recoveryKey: null, finishing: false });
			expect(opens).toBe(2);
			// That next try was called off, and with nothing waiting to go again, Try again opens nothing.
			a.clock.advance(10 * MINUTE);
			await a.engine.tryAgain();
			expect(opens).toBe(2);
			await a.engine.stop();
		},
		SLOW,
	);

	// M10: what tells a running device it was taken away, when nothing else did first.
	test(
		"a device taken away while it runs hears so",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			// It hears no IDENTITY_UPDATE, which would find it off the list first.
			const a = await firstDevice(fake, ana, { hears: (event) => event.type !== "IDENTITY_UPDATE" });
			const b = testDevice(fake, ana);
			await b.engine.start();
			await resetFrom(b);
			expect(a.engine.state).toEqual({ name: "ready" });
			await b.api.deleteDevice(a.registered[0]!);
			await until(() => a.engine.state.name === "removed");
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// The Android app's reading (step 5's mobile attacker report): removed would offer a start-over on a reading no real
	// core gives, which reports its list with every identity.
	test(
		"a list the core holds that doesn't read says nothing of the device, which stays ready",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			await a.engine.stop();
			for (const unread of [{ device_list: "not a device list" }, { device_list: undefined }]) {
				const host = answeringHost(a.host, (command) =>
					command.cmd === "status"
						? a.host.handle<CoreStatus>({ cmd: "status" }).then((status) => ({ ...status, ...unread }))
						: undefined,
				);
				const again = testDevice(fake, ana, { host, store: a.store, token: a.token });
				await again.engine.start();
				expect(again.engine.state).toEqual({ name: "ready" });
				await again.engine.stop();
			}
		},
		SLOW,
	);
});
