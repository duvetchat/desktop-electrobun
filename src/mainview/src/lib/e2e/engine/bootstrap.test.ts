import { describe, expect, test } from "bun:test";
import { base64Bytes } from "$lib/activity-thumbnail";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import { firstDevice, testDevice, testHost, until, useFake, watchedHost } from "../testing/engines";
import type { IdentityMade } from "./identity";

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

			// Another of Ana's devices starts over (Task 26 does it from the app): a new identity, listing that device alone.
			const made = await b.host.handle<IdentityMade>({ cmd: "reset_identity" });
			const { identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key } = made;
			const replaces = (await b.api.identity(ana)).identity_key;
			const published = await b.api.putIdentity({
				...{ identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key },
				...{ replaces, reset: true },
			});
			await b.host.handle({ cmd: "identity_uploaded" });
			await b.host.handle({ cmd: "device_list_uploaded", version: published.device_list_version });

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

			// macOS's and Linux's app carry no core: the host says so, and nothing more is asked.
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
});
