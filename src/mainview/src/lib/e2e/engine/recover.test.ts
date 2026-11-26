import { describe, expect, spyOn, test } from "bun:test";
import { listDevices } from "../cbor";
import { CoreError } from "../errors";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	approvedDevice,
	memoryStore,
	rejection,
	restarted,
	shownKey,
	testDevice,
	testHost,
	turnEnded,
	useFake,
	watchedHost,
	type TestDevice,
} from "../testing/engines";
import type { EngineStore } from "./store";

// A new device set up with the recovery key (PLAN-E2E-CLIENTES.md, Task 26; decisions 22 and 24): the key as the person
// types it, a mistyped one caught before the API is asked, then what the API keeps for recovery opened, and this device
// listed with its certificate, confirmed only after the API took its list, on real cores through the fake API.
const SLOW = 180_000;
const LIST = { method: "PUT", path: "/api/users/@me/device-list" };
const BACKUP = "GET /api/users/@me/identity/backup";

const said = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const deviceOf = (device: TestDevice) => device.registered.at(-1)!;
/** The key as a person may type it: in its groups of four, spaces and dashes between them. */
const typed = (key: string) => key.match(/.{4}/g)!.join(" - ");
const statusOf = (device: TestDevice) =>
	device.host.handle<{ device_id: string; certificate: string; device_list: string }>({ cmd: "status" });

/** A first device of the user's, and the recovery key it showed before it was saved. */
async function withKey(fake: FakeApi, user: string) {
	const device = testDevice(fake, user);
	await device.engine.start();
	await device.engine.makeIdentity();
	const key = shownKey(device.engine.state)!;
	await device.engine.keySaved();
	return { device, key };
}

/** Another device of the user's, on a session of its own: a new device, as its start leaves it. */
async function newDevice(fake: FakeApi, user: string, given: Parameters<typeof testDevice>[2] = {}) {
	const device = testDevice(fake, user, given);
	await device.engine.start();
	expect(device.engine.state).toEqual({ name: "new_device" });
	return device;
}

describe.skipIf(!coreLibrary)("a new device and the recovery key", () => {
	test(
		"the recovery key is read with spaces and dashes, and a mistyped one is caught before the server is asked",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const requests: string[] = [];
			useFake(fake, (request) => requests.push(said(request)));
			const { device: a, key } = await withKey(fake, ana);
			const b = await newDevice(fake, ana);
			// One character off: the core's check catches it, and the API is asked for nothing.
			const at = 17;
			const mistyped = key.slice(0, at) + (key[at] === "2" ? "3" : "2") + key.slice(at + 1);
			const refused = await rejection(b.engine.recover(typed(mistyped)));
			expect(refused).toBeInstanceOf(CoreError);
			expect(refused).toMatchObject({ code: "bad_command", field: "recovery_key" });
			expect(requests).not.toContain(BACKUP);
			expect(b.engine.state).toEqual({ name: "new_device" });

			// As the person types it, in groups with spaces and dashes: it opens the identity, and this device is set up.
			await b.engine.recover(typed(key));
			expect(requests.filter((request) => request === BACKUP)).toHaveLength(1);
			expect(b.engine.state).toEqual({ name: "ready" });
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// Review Focus 11: a list confirmed without its upload lets another list of its version in.
	test(
		"recovering lists this device, uploads its certificate with the list, and confirms it",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const timeline: string[] = [];
			const lists: Promise<unknown>[] = [];
			useFake(fake, (request) => {
				timeline.push(said(request));
				if (said(request) === `${LIST.method} ${LIST.path}`) lists.push(request.json());
			});
			const { device: a, key } = await withKey(fake, ana);
			const b = await newDevice(fake, ana, { host: watchedHost(testHost(), timeline) });
			await b.engine.recover(key);
			expect(b.engine.state).toEqual({ name: "ready" });

			// One list, this device's own with its certificate, on top of the version it read.
			const status = await statusOf(b);
			expect(await Promise.all(lists)).toEqual([
				{ device_list: status.device_list, base_version: 1, certificate: status.certificate },
			]);
			const served = await b.api.identity(ana);
			expect(listDevices(served.device_list)?.sort()).toEqual([deviceOf(a), status.device_id].sort());
			expect(served.certificates).toContain(status.certificate);
			expect((await b.api.devices()).find(({ current }) => current)).toMatchObject({
				id: status.device_id,
				listed: true,
			});
			// Confirmed once the API answered, never before; then this device's key packages.
			const put = timeline.indexOf(`${LIST.method} ${LIST.path}`);
			expect(timeline.indexOf("recover")).toBeLessThan(put);
			expect(timeline.indexOf("device_list_uploaded")).toBeGreaterThan(put);
			expect(timeline.lastIndexOf("PUT /api/users/@me/devices/@me/key-packages")).toBeGreaterThan(put);
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// Review Focus 3: the app dies between the core's recover and the API's answer to the list.
	test(
		"a recovery cut before its list's answer is finished by the next start, and confirmed only after a 200",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const { device: a, key } = await withKey(fake, ana);
			const log: string[] = [];
			const b = await newDevice(fake, ana, { host: watchedHost(testHost(), log) });
			// The list never reaches the API: nothing is confirmed, and the device waits to finish.
			fake.cutRequest(LIST);
			expect(await rejection(b.engine.recover(key))).toBeInstanceOf(TypeError);
			expect(log).not.toContain("device_list_uploaded");
			expect(b.engine.state).toEqual({ name: "new_device", setup: { way: "finishing" } });
			// The app starts again: the same list goes up at the start, with no tap (there's nothing to ask), and it's set up.
			const again = await restarted(fake, b);
			expect(again.engine.state).toEqual({ name: "ready" });
			expect(listDevices((await again.api.identity(ana)).device_list)).toContain(deviceOf(again));

			// Its answer lost this time: the API took it, so the next start finds the device listed and sends nothing.
			const c = await newDevice(fake, ana, { host: watchedHost(testHost(), log) });
			fake.loseAnswer(LIST);
			log.length = 0;
			expect(await rejection(c.engine.recover(key))).toBeInstanceOf(TypeError);
			expect(log).not.toContain("device_list_uploaded");
			const back = await restarted(fake, c);
			expect(back.engine.state).toEqual({ name: "ready" });
			await Promise.all([a.engine.stop(), again.engine.stop(), back.engine.stop()]);
		},
		SLOW,
	);

	// Step 3's closing review: a new password's remove_devices leaves the signed list naming devices the API took away,
	// which a list naming them can't go up with (400 `the list names device …`).
	test(
		"a recovered device's first list leaves out the devices the API took away",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const { device: a, key } = await withKey(fake, ana);
			const b = await approvedDevice(fake, a);
			await Promise.all([a.engine.stop(), b.engine.stop()]);
			// A new password, its devices removed: both are gone from the API, and still on the signed list.
			fake.dropDevice(deviceOf(a));
			fake.dropDevice(deviceOf(b));
			const removed: unknown[][] = [];
			const host = watchedHost(testHost(), [], (cmd, command) => {
				if (cmd === "sign_device_list" && Array.isArray(command.remove)) removed.push(command.remove);
				return null;
			});
			const c = await newDevice(fake, ana, { host });
			await c.engine.recover(key);
			expect(c.engine.state).toEqual({ name: "ready" });
			// On top of recover's list, a list without them, which Bun asks the person for on the desktop.
			expect(removed).toHaveLength(1);
			expect(removed[0]?.toSorted()).toEqual([deviceOf(a), deviceOf(b)].sort());
			const served = await c.api.identity(ana);
			expect(listDevices(served.device_list)).toEqual([deviceOf(c)]);
			expect(served.certificates).toEqual([(await statusOf(c)).certificate]);
			await c.engine.stop();
		},
		SLOW,
	);

	test(
		"a first list that needs Bun's box waits for the person: refused, or at a start, it goes on their Finish",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const { device: a, key } = await withKey(fake, ana);
			await a.engine.stop();
			fake.dropDevice(deviceOf(a));
			const log: string[] = [];
			let refusals = 1;
			const host = watchedHost(testHost(), log, (cmd) =>
				cmd === "sign_device_list" && refusals-- > 0 ? new CoreError("refused", "the person didn't confirm it") : null,
			);
			const b = await newDevice(fake, ana, { host });
			// The person's no in Bun's box: the identity is on this device, and its list waits for Finish.
			await b.engine.recover(key);
			expect(b.engine.state).toEqual({ name: "new_device", setup: { way: "finishing" } });
			// The app starts again: nothing asks the person by itself, and the list still waits.
			const again = await restarted(fake, b);
			expect(again.engine.state).toEqual({ name: "new_device", setup: { way: "finishing" } });
			expect(log.filter((cmd) => cmd === "sign_device_list")).toHaveLength(1);
			// Their Finish asks again, and with a yes the device is set up.
			await again.engine.finishSetup();
			expect(again.engine.state).toEqual({ name: "ready" });
			expect(listDevices((await again.api.identity(ana)).device_list)).toEqual([deviceOf(again)]);
			await again.engine.stop();
		},
		SLOW,
	);

	test(
		"the recovery key reaches no record, log or request: only the core",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const bodies: Promise<string>[] = [];
			useFake(fake, (request) => bodies.push(request.text()));
			const { device: a, key } = await withKey(fake, ana);
			const printed: string[] = [];
			for (const method of ["log", "info", "warn", "error", "debug"] as const) {
				spyOn(console, method).mockImplementation((...args: unknown[]) => void printed.push(Bun.inspect(args)));
			}
			const kept = memoryStore();
			const writes: string[] = [];
			const store: EngineStore = {
				read: (name) => kept.read(name),
				write: (name, value) => {
					writes.push(JSON.stringify([name, value]));
					kept.write(name, value);
				},
			};
			const commands: string[] = [];
			const host = watchedHost(testHost(), [], (cmd, command) => {
				commands.push(JSON.stringify(command));
				return null;
			});
			const b = await newDevice(fake, ana, { host, store });
			bodies.length = 0;
			const mistyped = `${key.slice(0, 47)}${key.endsWith("2") ? "3" : "2"}`;
			await rejection(b.engine.recover(typed(mistyped)));
			await b.engine.recover(typed(key));
			await turnEnded(b);
			expect(b.engine.state).toEqual({ name: "ready" });
			const sent = await Promise.all(bodies);
			for (const form of [key, typed(key), mistyped]) {
				for (const where of [sent, printed, writes]) expect(where.join("\n")).not.toContain(form);
			}
			// Where it goes: recover's commands alone.
			const carrying = commands.filter((command) => command.includes(typed(key)));
			expect(carrying.length).toBeGreaterThan(0);
			expect(carrying.every((command) => JSON.parse(command).cmd === "recover")).toBe(true);
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);
});
