import { describe, expect, test } from "bun:test";
import { CoreError } from "../errors";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import { rejection, shownKey, testDevice, testHost, useFake, watchedHost } from "../testing/engines";

// The first device of a user (PLAN-E2E-CLIENTES.md, Task 12): its identity made from the person's tap, its recovery key
// shown and saved (decision 23), and only then published and confirmed, on real cores through the fake API.
const RECOVERY_KEY = /^[1-9A-HJ-NP-Za-km-z]{48}$/;
const IDENTITY = { method: "PUT", path: "/api/users/@me/identity" };
const SLOW = 180_000;

const said = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;

describe.skipIf(!coreLibrary)("the first device", () => {
	test(
		"a first device makes its identity, shows the key, and uploads it once it's saved",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const requests: string[] = [];
			useFake(fake, (request) => requests.push(said(request)));
			const a = testDevice(fake, ana);
			await a.engine.start();
			// The user has no identity: the device waits for the person, its session bound to it.
			expect(a.engine.state).toEqual({ name: "first_device", recoveryKey: null, finishing: false });
			const [device] = a.registered;
			expect(await a.api.devices()).toMatchObject([{ id: device, name: "Duvet for Windows", current: true }]);

			await a.engine.makeIdentity();
			const key = shownKey(a.engine.state);
			expect(key).toMatch(RECOVERY_KEY);
			expect(a.engine.state).toEqual({ name: "first_device", recoveryKey: key, finishing: false });
			// Nothing goes up before the person says they saved it.
			expect(requests).not.toContain("PUT /api/users/@me/identity");
			expect(await rejection(a.api.identity(ana))).toMatchObject({ response: { status: 404 } });

			await a.engine.keySaved();
			expect(a.engine.state).toEqual({ name: "ready" });
			expect(requests.filter((request) => request === "PUT /api/users/@me/identity")).toHaveLength(1);
			// Published and confirmed: the API has it with this device listed, and the core keeps no copy for an upload.
			const status = await a.host.handle<{ identity_key: string; waiting_upload?: string }>({ cmd: "status" });
			expect(status.waiting_upload).toBeUndefined();
			expect((await a.api.identity(ana)).identity_key).toBe(status.identity_key);
			expect(await a.api.devices()).toMatchObject([{ id: device, listed: true, current: true }]);
			// Then the device's key packages, at once.
			expect(requests).toContain("PUT /api/users/@me/devices/@me/key-packages");
			await a.engine.stop();
		},
		SLOW,
	);

	test(
		"on the desktop, a create_identity the person refused in Bun's box is not yet, and their next tap makes it",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			let refusals = 1;
			const log: string[] = [];
			const host = watchedHost(testHost(), log, (cmd) =>
				cmd === "create_identity" && refusals-- > 0 ? new CoreError("refused", "the person didn't confirm it") : null,
			);
			const a = testDevice(fake, ana, { host });
			await a.engine.start();
			await a.engine.makeIdentity();
			expect(a.engine.state).toEqual({ name: "first_device", recoveryKey: null, finishing: false });
			await a.engine.makeIdentity();
			expect(shownKey(a.engine.state)).toMatch(RECOVERY_KEY);
			// The engine never runs it by itself: twice, both times on the person's tap.
			expect(log.filter((cmd) => cmd === "create_identity")).toHaveLength(2);
			await a.engine.stop();
		},
		SLOW,
	);

	// Review Focus 3: the app dies between the core's command and the API's answer.
	test(
		"an identity cut before its upload goes up again",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const sent: Promise<string>[] = [];
			useFake(fake, (request) => {
				if (said(request) === "PUT /api/users/@me/identity") sent.push(request.text());
			});
			const a = testDevice(fake, ana);
			await a.engine.start();
			await a.engine.makeIdentity();
			const key = shownKey(a.engine.state);
			fake.loseAnswer(IDENTITY);
			// The API took it, but the answer never came: nothing is confirmed, and the key still shows.
			expect(await rejection(a.engine.keySaved())).toBeInstanceOf(TypeError);
			expect(a.engine.state).toEqual({ name: "first_device", recoveryKey: key, finishing: false });
			await a.engine.stop();

			// The app starts again on the same database: the core still waits for the upload, so the sheet comes back.
			const again = testDevice(fake, ana, { host: a.host, store: a.store, token: a.token });
			await again.engine.start();
			expect(again.engine.state).toEqual({ name: "first_device", recoveryKey: null, finishing: true });
			await again.engine.makeIdentity();
			expect(shownKey(again.engine.state)).toBe(key);
			await again.engine.keySaved();
			expect(again.engine.state).toEqual({ name: "ready" });
			// The same bytes went up again, which the API took as the identity it has.
			const [first, second] = await Promise.all(sent);
			expect(sent).toHaveLength(2);
			expect(second).toBe(first!);
			expect(again.registered).toEqual(a.registered);
			await again.engine.stop();
		},
		SLOW,
	);

	// Review Focus 11: a list confirmed without its upload lets another list of its version in.
	test(
		"a list is confirmed only after its 200",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const log: string[] = [];
			useFake(fake, (request) => {
				if (said(request) === "PUT /api/users/@me/identity") log.push("PUT identity");
			});
			const a = testDevice(fake, ana, { host: watchedHost(testHost(), log) });
			await a.engine.start();
			await a.engine.makeIdentity();
			const confirmations = () => log.filter((step) => step === "identity_uploaded" || step === "device_list_uploaded");

			// Refused: nothing is confirmed.
			fake.refuse(IDENTITY, 500, { error: "internal server error" });
			expect(await rejection(a.engine.keySaved())).toMatchObject({ response: { status: 500 } });
			// Taken, but its answer lost: the client never saw the 200, so nothing is confirmed either.
			fake.loseAnswer(IDENTITY);
			expect(await rejection(a.engine.keySaved())).toBeInstanceOf(TypeError);
			expect(confirmations()).toEqual([]);
			expect(await a.host.handle({ cmd: "status" })).toMatchObject({ waiting_upload: "create_identity" });

			await a.engine.keySaved();
			expect(confirmations()).toEqual(["identity_uploaded", "device_list_uploaded"]);
			// Both after the third upload, the one that got its 200.
			expect(log.indexOf("identity_uploaded")).toBeGreaterThan(log.lastIndexOf("PUT identity"));
			expect(log.filter((step) => step === "PUT identity")).toHaveLength(3);
			await a.engine.stop();
		},
		SLOW,
	);

	// Ruling 26: the core can't undo an identity, so the device that lost starts over as a new one.
	test(
		"two first devices at once: the one that loses starts over as a new device",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const [a, b] = [testDevice(fake, ana), testDevice(fake, ana)];
			await Promise.all([a.engine.start(), b.engine.start()]);
			await Promise.all([a.engine.makeIdentity(), b.engine.makeIdentity()]);
			await a.engine.keySaved();
			expect(a.engine.state).toEqual({ name: "ready" });

			await b.engine.keySaved();
			expect(b.engine.state).toEqual({ name: "new_device" });
			// A new device, its session bound to it, and its first one's registration deleted.
			const [first, now] = b.registered;
			expect(b.registered).toHaveLength(2);
			expect(now).not.toBe(first);
			expect((await b.api.devices()).map(({ id, listed, current }) => ({ id, listed, current }))).toEqual(
				expect.arrayContaining([
					{ id: a.registered[0]!, listed: true, current: false },
					{ id: now!, listed: false, current: true },
				]),
			);
			expect((await b.api.devices()).map(({ id }) => id)).not.toContain(first);
			// Its database is a new one: the identity it made is gone with the old one.
			expect(await b.host.handle({ cmd: "status" })).toMatchObject({ device_id: now, has_identity: false });
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);
});
