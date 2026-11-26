import { describe, expect, test } from "bun:test";
import { sessionApi } from "$lib/api/api";
import { resetPassword } from "$lib/api/auth";
import { e2eApi } from "$lib/api/e2e";
import { listDevices } from "../cbor";
import { CoreError } from "../errors";
import type { CoreHost } from "../host";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	approvedDevice,
	firstDevice,
	rejection,
	shownKey,
	testDevice,
	testHost,
	until,
	useFake,
	watchedHost,
	type TestDevice,
} from "../testing/engines";
import { inactiveDevice, onlyDevice } from "./devices";
import type { DeviceNotice, EngineState } from "./engine";
import { LEGACY_RECORDS } from "./legacy";
import { DEVICE_RECORD, EXTERNAL_SENDER, TOLD_ADDED, TOLD_INACTIVE } from "./store";

// Devices in Settings (PLAN-E2E-CLIENTES.md, Task 24; decisions 13 and 52): the user's devices, those not seen in 45
// days, another one taken off the list, one lost taken off with new keys, and this one's data deleted, on real cores
// through the fake API.
const SLOW = 180_000;
const DAY = 24 * 3600 * 1000;
const RECOVERY_KEY = /^[1-9A-HJ-NP-Za-km-z]{48}$/;
const LIST = { method: "PUT", path: "/api/users/@me/device-list" };
const IDENTITY = { method: "PUT", path: "/api/users/@me/identity" };

const said = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
/** The new recovery key a rotation shows, or null. */
const rotationKey = (state: EngineState) => (state.name === "ready" ? (state.rotation?.recoveryKey ?? null) : null);
const deviceOf = (device: TestDevice) => device.registered.at(-1)!;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const statusOf = (device: TestDevice) =>
	device.host.handle<{ device_id?: string; identity_key?: string; waiting_upload?: string }>({ cmd: "status" });
const deviceIds = async (device: TestDevice) => (await device.api.devices()).map(({ id }) => id).sort();

describe.skipIf(!coreLibrary)("the user's devices", () => {
	test(
		"the list marks a device not seen in 45 days, and warns once for it",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const b = await approvedDevice(fake, a);
			await b.engine.stop();
			const phone = deviceOf(b);

			// The list marks it past 45 days, never this device, and not one seen within them.
			fake.lastSeen(phone, ago(46));
			const listed = await a.api.devices();
			expect(inactiveDevice(listed.find(({ id }) => id === phone)!)).toBe(true);
			expect(inactiveDevice(listed.find(({ current }) => current)!)).toBe(false);
			fake.lastSeen(phone, ago(44));
			expect(inactiveDevice((await a.api.devices()).find(({ id }) => id === phone)!)).toBe(false);
			fake.lastSeen(phone, ago(46));

			// The app warns once for it: at its next start, not again a day later, nor at the start after.
			await a.engine.stop();
			const notices: DeviceNotice[] = [];
			const again = testDevice(fake, ana, { host: a.host, store: a.store, token: a.token });
			again.engine.onDevice((notice) => notices.push(notice));
			await again.engine.start();
			expect(notices).toMatchObject([{ kind: "inactive", device: { id: phone, name: "Duvet for Windows" } }]);
			again.clock.advance(DAY);
			await again.engine.uploadLater();
			await again.engine.stop();
			const later = testDevice(fake, ana, { host: a.host, store: a.store, token: a.token });
			later.engine.onDevice((notice) => notices.push(notice));
			await later.engine.start();
			expect(notices).toHaveLength(1);
			await later.engine.stop();
		},
		SLOW,
	);

	// Review Focus 11: a list confirmed without its upload lets another list of its version in.
	test(
		"removing a device signs a list without it, and confirms it after its 200",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const log: string[] = [];
			useFake(fake, (request) => {
				if (said(request) === "PUT /api/users/@me/device-list") log.push("PUT list");
			});
			const a = await firstDevice(fake, ana, { host: watchedHost(testHost(), log) });
			const [b, c] = [await approvedDevice(fake, a), await approvedDevice(fake, a)];
			log.length = 0;
			const confirmed = () => log.filter((step) => step === "device_list_uploaded");

			// Refused: nothing is confirmed, and the device stays.
			fake.refuse(LIST, 500, { error: "internal server error" });
			expect(await rejection(a.engine.removeDevice(deviceOf(b)))).toMatchObject({ response: { status: 500 } });
			expect(log).toContain("sign_device_list");
			expect(confirmed()).toEqual([]);
			expect(await deviceIds(a)).toContain(deviceOf(b));

			// Again: the list without it goes up, and only its 200 confirms it.
			await a.engine.removeDevice(deviceOf(b));
			expect(confirmed()).toHaveLength(1);
			expect(log.indexOf("device_list_uploaded")).toBeGreaterThan(log.lastIndexOf("PUT list"));
			expect(await deviceIds(a)).toEqual([deviceOf(a), deviceOf(c)].sort());
			await until(() => b.engine.state.name === "removed");
			const served = await a.api.identity(ana);
			expect(listDevices(served.device_list)?.sort()).toEqual([deviceOf(a), deviceOf(c)].sort());

			// Taken, its answer lost: no 200 came, so nothing is confirmed, and the next try finds it off the list.
			log.length = 0;
			fake.loseAnswer(LIST);
			expect(await rejection(a.engine.removeDevice(deviceOf(c)))).toBeInstanceOf(TypeError);
			expect(confirmed()).toEqual([]);
			await a.engine.removeDevice(deviceOf(c));
			expect(log.filter((step) => step === "PUT list")).toHaveLength(1);
			expect(await deviceIds(a)).toEqual([deviceOf(a)]);
			expect(a.engine.state).toEqual({ name: "ready" });
			await Promise.all([a.engine.stop(), b.engine.stop(), c.engine.stop()]);
		},
		SLOW,
	);

	// The core's rule after a list: taken or not, the own user is observed before another is signed (N3).
	test(
		"a list that lost its race is observed and signed again",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			let puts = 0;
			useFake(fake, (request) => {
				if (said(request) === "PUT /api/users/@me/device-list") puts++;
			});
			const a = await firstDevice(fake, ana);
			const b = await approvedDevice(fake, a);
			const [c, d] = [await approvedDevice(fake, a), await approvedDevice(fake, a)];
			puts = 0;

			// Two of the user's devices each take another off at once: their lists meet, and one finds the other's first.
			fake.gather(LIST, 2);
			await Promise.all([a.engine.removeDevice(deviceOf(c)), b.engine.removeDevice(deviceOf(d))]);
			expect(puts).toBe(3);
			expect(await deviceIds(a)).toEqual([deviceOf(a), deviceOf(b)].sort());
			const served = await a.api.identity(ana);
			expect(listDevices(served.device_list)?.sort()).toEqual([deviceOf(a), deviceOf(b)].sort());
			// Both hold the list the API serves.
			for (const device of [a, b]) {
				expect(device.engine.state).toEqual({ name: "ready" });
				const held = (await device.host.handle<{ device_list: string }>({ cmd: "status" })).device_list;
				expect(held).toBe(served.device_list);
			}
			await Promise.all([a, b, c, d].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	test(
		"a device the user never set up goes by its registration",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const fresh = testDevice(fake, ana);
			await fresh.engine.start();
			expect(fresh.engine.state).toEqual({ name: "new_device" });
			await a.engine.removeDevice(deviceOf(fresh));
			expect(await deviceIds(a)).toEqual([deviceOf(a)]);
			await until(() => fresh.engine.state.name === "removed");
			await Promise.all([a.engine.stop(), fresh.engine.stop()]);
		},
		SLOW,
	);

	test(
		"removing this device deletes its database and its registration, and stops its engine",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const requests: string[] = [];
			useFake(fake, (request) => requests.push(said(request)));
			const a = await firstDevice(fake, ana);
			// A device the user never set up: the API takes its registration away.
			const fresh = testDevice(fake, ana);
			await fresh.engine.start();
			await fresh.engine.removeThisDevice();
			expect(await deviceIds(a)).toEqual([deviceOf(a)]);
			expect(fresh.engine.state).toEqual({ name: "starting" });
			// Its engine does nothing more: no start again, nothing a day later.
			requests.length = 0;
			fresh.clock.advance(DAY);
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(requests).toEqual([]);
			await fresh.host.open(ana);
			expect((await statusOf(fresh)).device_id).toBeUndefined();

			// A device on the list: its data goes, and its listing stays for the user's other devices to take off, as
			// the API takes no list without the session's device.
			const b = await approvedDevice(fake, a);
			// Its record goes with it (M4), and what the installation keeps stays: the external sender it pinned
			// (Ruling 32) and the first members it saw of its conversations from before the cutover (Ruling 14).
			const forgotten = [...DEVICE_RECORD, TOLD_INACTIVE, TOLD_ADDED];
			for (const key of forgotten) b.store.write(key, ["kept"]);
			b.store.write(LEGACY_RECORDS, { kept: true });
			const pinned = b.store.read(EXTERNAL_SENDER);
			expect(pinned).toEqual(expect.any(String));
			await b.engine.removeThisDevice();
			expect(forgotten.filter((key) => b.store.read(key) !== null)).toEqual([]);
			expect([b.store.read(EXTERNAL_SENDER), b.store.read(LEGACY_RECORDS)]).toEqual([pinned, { kept: true }]);
			expect(await deviceIds(a)).toEqual([deviceOf(a), deviceOf(b)].sort());
			await b.host.open(ana);
			expect((await statusOf(b)).device_id).toBeUndefined();
			await Promise.all([a.engine.stop(), fresh.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// M5: the database goes first, so a deletion that can't take it leaves the device as it was, its session too.
	test(
		"a deletion whose database can't go leaves the device, its registration and its session as they were",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			let refusals = 1;
			const host = testHost();
			const refusing: CoreHost = new Proxy(host, {
				get(target, name) {
					if (name === "destroy") {
						return async (user: string) => {
							if (refusals-- > 0) throw new CoreError("locked", "another instance holds the database");
							return target.destroy(user);
						};
					}
					const value = Reflect.get(target, name);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			const fresh = testDevice(fake, ana, { host: refusing });
			await fresh.engine.start();
			expect(await rejection(fresh.engine.removeThisDevice())).toMatchObject({ code: "locked" });
			expect(await deviceIds(a)).toContain(deviceOf(fresh));
			expect((await fresh.api.devices()).find(({ current }) => current)?.id).toBe(deviceOf(fresh));
			expect(fresh.engine.state).toEqual({ name: "new_device" });
			// Asked again, it goes: the database, then its registration.
			await fresh.engine.removeThisDevice();
			expect(await deviceIds(a)).toEqual([deviceOf(a)]);
			await Promise.all([a.engine.stop(), fresh.engine.stop()]);
		},
		SLOW,
	);

	test(
		"a lost device goes with new keys, and the new recovery key must be saved",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const requests: string[] = [];
			useFake(fake, (request) => requests.push(said(request)));
			const a = await firstDevice(fake, ana);
			const firstKey = a.states.map(shownKey).find(Boolean);
			const [lost, kept] = [await approvedDevice(fake, a), await approvedDevice(fake, a)];
			const before = await a.api.identity(ana);
			requests.length = 0;

			await a.engine.removeDevice(deviceOf(lost), { changeKeys: true });
			const key = rotationKey(a.engine.state);
			expect(key).toMatch(RECOVERY_KEY);
			expect(key).not.toBe(firstKey);
			// Nothing goes up before the person saved it: the API has the identity and the devices it had.
			expect(requests).not.toContain("PUT /api/users/@me/identity");
			expect((await a.api.identity(ana)).identity_key).toBe(before.identity_key);
			expect(await deviceIds(a)).toContain(deviceOf(lost));

			await a.engine.keySaved();
			expect(a.engine.state).toEqual({ name: "ready" });
			// The new identity is the API's, the core keeps no copy for an upload, and the lost device is gone.
			const status = await statusOf(a);
			expect(status.waiting_upload).toBeUndefined();
			const after = await a.api.identity(ana);
			expect(after.identity_key).toBe(status.identity_key!);
			expect(after.identity_key).not.toBe(before.identity_key);
			expect(await deviceIds(a)).toEqual([deviceOf(a), deviceOf(kept)].sort());
			await until(() => lost.engine.state.name === "removed");
			// The device that stays took the new identity from its transfer.
			await until(async () => (await statusOf(kept)).identity_key === after.identity_key);
			await until(() => kept.engine.state.name === "ready");
			await Promise.all([a, lost, kept].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	test(
		"changing the security keys with no device lost hands them to every device",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const b = await approvedDevice(fake, a);
			await a.engine.changeKeys();
			expect(rotationKey(a.engine.state)).toMatch(RECOVERY_KEY);
			await a.engine.keySaved();
			const after = await a.api.identity(ana);
			expect(after.identity_key).toBe((await statusOf(a)).identity_key!);
			expect(await deviceIds(a)).toEqual([deviceOf(a), deviceOf(b)].sort());
			await until(async () => (await statusOf(b)).identity_key === after.identity_key);
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// I1: another device takes off a device a waiting change keeps, which neither its upload nor its Finish can then
	// leave out (the core's same rotation). The page says so, until another device's change ends it.
	test(
		"a change of keys that can't finish says so, until this device's data goes",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const [b, kept] = [await approvedDevice(fake, a), await approvedDevice(fake, a)];
			await a.engine.changeKeys();
			expect(rotationKey(a.engine.state)).toMatch(RECOVERY_KEY);
			await b.engine.removeDevice(deviceOf(kept));
			// Its upload: the API refuses a transfer to a device it removed (400).
			await a.engine.keySaved();
			expect(a.engine.state).toEqual({ name: "ready", rotation: { recoveryKey: null, stuck: true } });

			// After a restart, its Finish can't run it either: the core has no certificate for that device.
			await a.engine.stop();
			const again = testDevice(fake, ana, { host: a.host, store: a.store, token: a.token });
			await again.engine.start();
			expect(again.engine.state).toEqual({ name: "ready", rotation: { recoveryKey: null } });
			await again.engine.changeKeys();
			expect(again.engine.state).toEqual({ name: "ready", rotation: { recoveryKey: null, stuck: true } });

			// Another device's change of keys doesn't end it: the core refuses its transfer while this change waits
			// (invalid_signature, duvetchat/e2e#49), and the inbox lets it go.
			await b.engine.changeKeys();
			await b.engine.keySaved();
			await until(async () => (await again.api.inbox()).length === 0);
			await again.engine.changeKeys();
			expect(again.engine.state).toEqual({ name: "ready", rotation: { recoveryKey: null, stuck: true } });
			expect((await statusOf(again)).waiting_upload).toBe("rotate_keys");
			// Deleting this device's data does.
			await again.engine.removeThisDevice();
			expect(again.engine.state).toEqual({ name: "starting" });
			await Promise.all([again.engine.stop(), b.engine.stop(), kept.engine.stop()]);
		},
		SLOW,
	);

	// I1: another device's change of keys went up first, whose transfer the core can't take while this change waits.
	test(
		"a change of keys another device's change went before says it can't finish",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const b = await approvedDevice(fake, a);
			await a.engine.changeKeys();
			expect(rotationKey(a.engine.state)).toMatch(RECOVERY_KEY);
			await b.engine.changeKeys();
			await b.engine.keySaved();
			// Its upload: the API holds the other device's keys (409), every time.
			await a.engine.keySaved();
			expect(a.engine.state).toEqual({ name: "ready", rotation: { recoveryKey: null, stuck: true } });

			// After a restart, its Finish can't run it either: the certificates served are signed by the other change.
			await a.engine.stop();
			const again = testDevice(fake, ana, { host: a.host, store: a.store, token: a.token });
			await again.engine.start();
			expect(again.engine.state).toEqual({ name: "ready", rotation: { recoveryKey: null } });
			await again.engine.changeKeys();
			expect(again.engine.state).toEqual({ name: "ready", rotation: { recoveryKey: null, stuck: true } });
			expect((await statusOf(again)).waiting_upload).toBe("rotate_keys");
			await Promise.all([again.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// M3: a list of this device's that the API never took holds a removal the next list or change takes along.
	test(
		"what an earlier removal that failed takes along is told before the next change",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const [b, c] = [await approvedDevice(fake, a), await approvedDevice(fake, a)];
			expect(await a.engine.alsoRemoved()).toEqual([]);
			fake.refuse(LIST, 500, { error: "internal server error" });
			await rejection(a.engine.removeDevice(deviceOf(b)));
			expect(await a.engine.alsoRemoved()).toEqual([deviceOf(b)]);
			// The next removal takes it along, and then nothing waits.
			await a.engine.removeDevice(deviceOf(c));
			expect(await deviceIds(a)).toEqual([deviceOf(a)]);
			expect(await a.engine.alsoRemoved()).toEqual([]);
			await Promise.all([a, b, c].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	// Review Focus 3: the app dies between the core's command and the API's answer.
	test(
		"a rotation cut before its upload runs again as the same rotation",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const sent: string[] = [];
			useFake(fake, (request) => sent.push(said(request)));
			const a = await firstDevice(fake, ana);
			const [lost, kept] = [await approvedDevice(fake, a), await approvedDevice(fake, a)];
			sent.length = 0;

			await a.engine.removeDevice(deviceOf(lost), { changeKeys: true });
			const key = rotationKey(a.engine.state);
			const made = (await statusOf(a)).identity_key;
			// The app closes before the key was saved: nothing went up, and the next start offers to finish.
			await a.engine.stop();
			const again = testDevice(fake, ana, { host: a.host, store: a.store, token: a.token });
			await again.engine.start();
			expect(again.engine.state).toEqual({ name: "ready", rotation: { recoveryKey: null } });
			expect(sent).not.toContain("PUT /api/users/@me/identity");

			// Finish: the same rotation, its key and identity, taking off the device it took off.
			await again.engine.changeKeys();
			expect(rotationKey(again.engine.state)).toBe(key);
			expect((await statusOf(again)).identity_key).toBe(made);
			await again.engine.keySaved();
			expect(again.engine.state).toEqual({ name: "ready" });
			expect((await again.api.identity(ana)).identity_key).toBe(made!);
			expect(await deviceIds(again)).toEqual([deviceOf(a), deviceOf(kept)].sort());
			await until(async () => (await statusOf(kept)).identity_key === made);

			// Cut after the API took it, its answer lost: the person saved its key before it went, and the next start
			// confirms it, with nothing shown and nothing sent again.
			await again.engine.changeKeys();
			const second = (await statusOf(again)).identity_key;
			fake.loseAnswer(IDENTITY);
			expect(await rejection(again.engine.keySaved())).toBeInstanceOf(TypeError);
			expect(rotationKey(again.engine.state)).toMatch(RECOVERY_KEY);
			await again.engine.stop();
			sent.length = 0;
			const third = testDevice(fake, ana, { host: a.host, store: a.store, token: a.token });
			await third.engine.start();
			expect(third.engine.state).toEqual({ name: "ready" });
			expect(sent).not.toContain("PUT /api/users/@me/identity");
			expect((await statusOf(third)).waiting_upload).toBeUndefined();
			expect((await third.api.identity(ana)).identity_key).toBe(second!);
			await Promise.all([third.engine.stop(), lost.engine.stop(), kept.engine.stop()]);
		},
		SLOW,
	);

	test(
		"resetting the password can remove every device",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const bodies: Promise<string>[] = [];
			useFake(fake, (request) => {
				if (said(request) === "POST /api/auth/reset-password") bodies.push(request.text());
			});
			const a = await firstDevice(fake, ana);
			const b = await approvedDevice(fake, a);
			const devicesNow = () => e2eApi(sessionApi({ token: fake.signIn(ana).token, sessionToken: null })).devices();

			// A new password alone ends the sessions: the devices stay, for a sign-in on each to bind again.
			await resetPassword(fake.resetToken(ana), "a new password");
			expect(await rejection(a.api.devices())).toMatchObject({ response: { status: 401 } });
			expect((await devicesNow()).map(({ id }) => id).sort()).toEqual([deviceOf(a), deviceOf(b)].sort());

			// With every device removed: none is left, and each one's engine is told.
			await resetPassword(fake.resetToken(ana), "another new password", true);
			expect(await devicesNow()).toEqual([]);
			await until(() => a.engine.state.name === "removed" && b.engine.state.name === "removed");
			const [first, second] = (await Promise.all(bodies)).map((body) => JSON.parse(body));
			expect(first).not.toHaveProperty("remove_devices");
			expect(second).toMatchObject({ remove_devices: true });
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// Step 3's closing review: a new password's remove_devices leaves the signed list naming devices the API took away,
	// which a list naming them again can't go up with (400 `the list names device …`).
	test(
		"a list this device signs drops the devices the API took away",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const [b, c, d] = [await approvedDevice(fake, a), await approvedDevice(fake, a), await approvedDevice(fake, a)];

			fake.dropDevice(deviceOf(c));
			await a.engine.removeDevice(deviceOf(b));
			expect(listDevices((await a.api.identity(ana)).device_list)?.sort()).toEqual([deviceOf(a), deviceOf(d)].sort());

			// A rotation too: the device it would hand the keys to has no certificate the API serves.
			fake.dropDevice(deviceOf(d));
			await a.engine.changeKeys();
			await a.engine.keySaved();
			const after = await a.api.identity(ana);
			expect(after.identity_key).toBe((await statusOf(a)).identity_key!);
			expect(listDevices(after.device_list)).toEqual([deviceOf(a)]);
			await Promise.all([a, b, c, d].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	test(
		"a new device of the user's is told once, never this one",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const notices: DeviceNotice[] = [];
			const a = testDevice(fake, ana);
			a.engine.onDevice((notice) => notices.push(notice));
			await a.engine.start();
			await a.engine.makeIdentity();
			await a.engine.keySaved();
			// A new device registers (DEVICE_ADD), then the list takes it (DEVICE_ADD again): told once.
			const b = await approvedDevice(fake, a);
			await until(() => notices.length > 0);
			await a.engine.uploadLater();
			expect(notices).toEqual([{ kind: "added", device: expect.objectContaining({ id: deviceOf(b) }) }]);
			expect(onlyDevice(await a.api.devices())).toBe(false);
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);
});

test("this device is the only one when no other device of the user's is on the list", () => {
	const device = (id: string, current: boolean, listed: boolean) => ({
		...{ id, name: "Duvet for Windows", client: "desktop-windows/1.2.0", listed, current },
		...{ created_at: ago(1), last_seen_at: ago(1) },
	});
	expect(onlyDevice([device("a", true, true)])).toBe(true);
	expect(onlyDevice([device("a", true, true), device("b", false, false)])).toBe(true);
	expect(onlyDevice([device("a", true, true), device("b", false, true)])).toBe(false);
	// Not set up itself, it holds nothing a recovery key would bring back.
	expect(onlyDevice([device("a", true, false)])).toBe(false);
	expect(onlyDevice([])).toBe(false);
});
