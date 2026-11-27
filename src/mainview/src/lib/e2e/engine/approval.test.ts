import { describe, expect, test } from "bun:test";
import type { InboxMessage } from "$lib/api/e2e";
import { base64Bytes } from "$lib/activity-thumbnail";
import { asBytes, asMap, cbor, listDevices } from "../cbor";
import { approvalFingerprint, approvalFrameMessage, readApprovalFrame } from "../conventions";
import { CoreError } from "../errors";
import conventions from "../testing/e2e-conventions.json";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	answeringHost,
	approvedDevice,
	firstDevice,
	rejection,
	restarted,
	testDevice,
	testHost,
	turnEnded,
	until,
	useFake,
	watchedHost,
	type TestDevice,
} from "../testing/engines";
import { ATTEMPT_MS } from "./approval";
import { takenAway } from "./devices";
import type { DeviceApproval, DeviceSetup, EngineState } from "./engine";
import { KEPT_APPROVALS } from "./store";

// A new device approved by another device of the user's (PLAN-E2E-CLIENTES.md, Task 26; decision 24), on real cores
// through the fake API: the new device's QR, which Android scans, or its commitment and the code the approving device
// shows, which the person types into the new one; the approving device offers only on the person's tap and confirms
// only on their Confirm, which Bun asks about in its own box on the desktop.
const SLOW = 180_000;
const MINUTE = 60_000;
const FINGERPRINT = /^[0-9a-f]{4}( [0-9a-f]{4}){3}$/;

const deviceOf = (device: TestDevice) => device.registered.at(-1)!;
const setupOf = (state: EngineState): DeviceSetup | null =>
	state.name === "new_device" ? (state.setup ?? null) : null;
const approvalOf = (state: EngineState): DeviceApproval | null =>
	state.name === "ready" ? (state.approval ?? null) : null;
/** The question an approving device shows, which the person's yes answers. */
const questionOf = (device: TestDevice) => approvalOf(device.engine.state)?.question ?? "";
/** The new device's code's way, once an approving device's offer was taken. */
const offered = (device: TestDevice) => {
	const setup = setupOf(device.engine.state);
	return setup?.way === "code" && setup.offered;
};
const qrOf = (device: TestDevice) => {
	const setup = setupOf(device.engine.state);
	return setup?.way === "qr" ? setup.qr : null;
};
/** The approval frames the device's record keeps, by their step. */
const keptSteps = (device: TestDevice) =>
	(device.store.read<InboxMessage[]>(KEPT_APPROVALS) ?? []).map((kept) => readApprovalFrame(kept.message)?.step);

/** Another device of the user's, on a session of its own: a new device, as its start leaves it. */
async function newDevice(fake: FakeApi, user: string, given: Parameters<typeof testDevice>[2] = {}) {
	const device = testDevice(fake, user, given);
	await device.engine.start();
	expect(device.engine.state).toEqual({ name: "new_device" });
	return device;
}

/** The new device asks by its code, and the approving device, on the person's yes, shows the code: what it shows. */
async function toTheCode(approver: TestDevice, fresh: TestDevice): Promise<string> {
	await fresh.engine.beginApproval();
	await fresh.engine.useCode();
	await until(() => approvalOf(approver.engine.state)?.step === "asked");
	await approver.engine.approveDevice(deviceOf(fresh), questionOf(approver));
	await until(() => approvalOf(approver.engine.state)?.step === "code");
	await until(() => offered(fresh));
	return approvalOf(approver.engine.state)!.code!;
}

/** Another six digits than these. */
const otherThan = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe.skipIf(!coreLibrary)("a new device approved by another", () => {
	test(
		"approval by code: the new device takes only the approver's code, and the approver confirms after",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const n = await newDevice(fake, ana);
			// The new device shows its QR first; the code is the other way, an attempt of its own.
			await n.engine.beginApproval();
			expect(qrOf(n)).toEqual(expect.any(String));
			await n.engine.useCode();
			const setup = setupOf(n.engine.state);
			expect(setup).toEqual({
				way: "code",
				fingerprint: expect.stringMatching(FINGERPRINT),
				offered: false,
				accepted: false,
			});
			const fingerprint = setup?.way === "code" ? setup.fingerprint : "";

			// The approving device asks the person, naming the new device and showing the same fingerprint.
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			expect(approvalOf(a.engine.state)).toEqual({
				...{ device: deviceOf(n), name: "Duvet for Windows", fingerprint },
				...{ question: expect.any(String), step: "asked" },
			});
			await a.engine.approveDevice(deviceOf(n), questionOf(a));
			await until(() => approvalOf(a.engine.state)?.step === "code");
			const { code } = approvalOf(a.engine.state)!;
			expect(code).toMatch(/^\d{6}$/);
			await until(() => offered(n));

			// Any other code is refused, and the attempt goes on; the approver's is accepted.
			const wrong = await rejection(n.engine.acceptCode(otherThan(code!)));
			expect(wrong).toBeInstanceOf(CoreError);
			expect(wrong).toMatchObject({ code: "rule_violation", rule: "code_mismatch" });
			expect(setupOf(n.engine.state)).toEqual({ way: "code", fingerprint, offered: true, accepted: false });
			await n.engine.acceptCode(code!);
			expect(setupOf(n.engine.state)).toEqual({ way: "code", fingerprint, offered: true, accepted: true });

			// The approver confirms after: the new device takes the transfer, and goes on as with the recovery key.
			await a.engine.confirmApproval(deviceOf(n));
			await until(() => n.engine.state.name === "ready");
			const served = await n.api.identity(ana);
			expect(listDevices(served.device_list)?.sort()).toEqual([deviceOf(a), deviceOf(n)].sort());
			expect(served.certificates).toHaveLength(2);
			// Its list up, the approving device lets go of the approval.
			await until(() => approvalOf(a.engine.state) === null);
			expect(a.engine.state).toEqual({ name: "ready" });
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	test(
		"an offer is made only on the person's tap",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const log: string[] = [];
			let refusals = 1;
			const host = watchedHost(testHost(), log, (cmd) =>
				cmd === "approval_confirm" && refusals-- > 0 ? new CoreError("refused", "the person didn't confirm it") : null,
			);
			const a = await firstDevice(fake, ana, { host });
			const n = await newDevice(fake, ana);
			await n.engine.beginApproval();
			await n.engine.useCode();
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			await turnEnded(a);
			expect(log).not.toContain("approval_offer");
			// The person's no: nothing is offered, and the question goes.
			await a.engine.declineDevice(deviceOf(n));
			expect(approvalOf(a.engine.state)).toBeNull();
			expect(log).not.toContain("approval_offer");

			// The new device asks again, and the app starts again before the person answers: still nothing offered.
			await n.engine.useCode();
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			const again = await restarted(fake, a);
			await until(() => approvalOf(again.engine.state)?.step === "asked");
			expect(log).not.toContain("approval_offer");
			await again.engine.approveDevice(deviceOf(n), questionOf(again));
			expect(log.filter((cmd) => cmd === "approval_offer")).toHaveLength(1);

			// Confirm too runs on the person's tap alone, and on the desktop after Bun's box: its no keeps the code shown.
			await until(() => approvalOf(again.engine.state)?.step === "code");
			const { code } = approvalOf(again.engine.state)!;
			await turnEnded(again);
			expect(log).not.toContain("approval_confirm");
			await n.engine.acceptCode(code!);
			await again.engine.confirmApproval(deviceOf(n));
			expect(approvalOf(again.engine.state)).toMatchObject({ step: "code", code });
			await again.engine.confirmApproval(deviceOf(n));
			await until(() => n.engine.state.name === "ready");
			expect(log.filter((cmd) => cmd === "approval_confirm")).toHaveLength(2);
			await Promise.all([again.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	test(
		"the code's field is never filled in",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const n = await newDevice(fake, ana);
			const code = await toTheCode(a, n);
			await turnEnded(n);
			// The new device keeps its own code in its core alone: nothing it shows or keeps holds the approver's.
			expect(JSON.stringify(n.engine.state)).not.toContain(code);
			expect(JSON.stringify(n.store.read(KEPT_APPROVALS))).not.toContain(code);
			expect(setupOf(n.engine.state)).toEqual({
				way: "code",
				fingerprint: expect.stringMatching(FINGERPRINT),
				offered: true,
				accepted: false,
			});
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	test(
		"a transfer that came before the code is kept, and taken after it",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const n = await newDevice(fake, ana);
			const code = await toTheCode(a, n);
			// The person confirms on the approving device before they type the code into the new one.
			await a.engine.confirmApproval(deviceOf(n));
			await until(() => keptSteps(n).includes("transfer"));
			await turnEnded(n);
			expect(n.engine.state.name).toBe("new_device");
			expect(setupOf(n.engine.state)).toMatchObject({ way: "code", accepted: false });
			// Their code, typed: the kept transfer is taken, and the device is set up.
			await n.engine.acceptCode(code);
			await until(() => n.engine.state.name === "ready");
			expect(listDevices((await n.api.identity(ana)).device_list)).toContain(deviceOf(n));
			expect(keptSteps(n)).not.toContain("transfer");
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	test(
		"an attempt past ten minutes starts over",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const n = await newDevice(fake, ana);
			// The QR is made again before its attempt's ten minutes end.
			await n.engine.beginApproval();
			const first = qrOf(n);
			n.clock.advance(9 * MINUTE);
			await turnEnded(n);
			const renewed = qrOf(n);
			expect(renewed).toEqual(expect.any(String));
			expect(renewed).not.toBe(first);

			// By the code, an attempt not done in its ten minutes starts over, with a new QR.
			await n.engine.useCode();
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			n.clock.advance(10 * MINUTE);
			await turnEnded(n);
			const over = qrOf(n);
			expect(over).toEqual(expect.any(String));
			expect([first, renewed]).not.toContain(over);

			// The approving device's own attempt ends ten minutes after its offer: its question says so (M1). The yes is to
			// the new attempt's question, once it shows (desktop-electrobun#535).
			const before = questionOf(a);
			await n.engine.useCode();
			await until(() => approvalOf(a.engine.state)?.step === "asked" && questionOf(a) !== before);
			await a.engine.approveDevice(deviceOf(n), questionOf(a));
			expect(approvalOf(a.engine.state)?.step).not.toBe("asked");
			a.clock.advance(10 * MINUTE);
			await turnEnded(a);
			expect(approvalOf(a.engine.state)).toMatchObject({ step: "ended", ended: "over" });
			await a.engine.declineDevice(deviceOf(n));
			expect(approvalOf(a.engine.state)).toBeNull();
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	// Task 27's review: the conventions' approval_qr, which both apps' tests draw, is a QR the core writes: a CBOR map of
	// the fields a fresh approval_begin gives, each of its size.
	test("the conventions' approval QR has the fields of the core's", async () => {
		const fake = new FakeApi();
		const ana = fake.addUser();
		useFake(fake);
		const a = await firstDevice(fake, ana);
		const n = await newDevice(fake, ana);
		await n.engine.beginApproval();
		// Each field's name, with its byte string's length or its value.
		const fields = (qr: string) => {
			const map = asMap(cbor(base64Bytes(qr)));
			return map && Object.fromEntries([...map].map(([name, value]) => [name, asBytes(value)?.length ?? value]));
		};
		expect(fields(conventions.approval_qr.qr)).toEqual(fields(qrOf(n)!));
		expect(fields(qrOf(n)!)).toEqual({ v: 1, user: 16, device: 16, signature_key: 32, hpke_key: 32, key: 32 });
		await Promise.all([a.engine.stop(), n.engine.stop()]);
	});

	// #557's re-review, RM5: on the desktop the host takes Bun's box away as the attempt ends, which only it can tell.
	test("an attempt that ends tells the host", async () => {
		const fake = new FakeApi();
		const ana = fake.addUser();
		useFake(fake);
		const a = await firstDevice(fake, ana);
		let ended = 0;
		const host = new Proxy(testHost(), {
			get(target, name) {
				if (name === "endApproval") return async () => void ended++;
				const value = Reflect.get(target, name);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		const n = await newDevice(fake, ana, { host });
		await n.engine.beginApproval();
		expect(ended).toBe(0);
		await n.engine.endApproval();
		expect(ended).toBe(1);
		await Promise.all([a.engine.stop(), n.engine.stop()]);
	});

	test(
		"approval by QR needs no code",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const n = await newDevice(fake, ana);
			await n.engine.beginApproval();
			const qr = qrOf(n)!;
			// The device that scans it (Android, Task 27) approves from the QR, and its transfer goes to the new device.
			const approved = await a.host.handle<{ transfer: string }>({ cmd: "approval_from_qr", qr });
			await a.api.sendToDevice(
				deviceOf(n),
				approvalFrameMessage({ duvet: "approval", step: "transfer", data: approved.transfer }),
			);
			await until(() => n.engine.state.name === "ready");
			const served = await n.api.identity(ana);
			expect(listDevices(served.device_list)?.sort()).toEqual([deviceOf(a), deviceOf(n)].sort());
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	// Task 24's review, M2: until the new device's list goes up, it has no certificate of the identity, so it's no device
	// the API took away (GET …/devices still has it), and a list or a change of keys made meanwhile would leave it out.
	test(
		"a device this one approved isn't taken for one the API took away, and list and key changes wait for its list",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const b = await approvedDevice(fake, a);
			let reading = true;
			const n = await newDevice(fake, ana, { hears: (event) => reading || event.type !== "DEVICE_MESSAGE" });
			const code = await toTheCode(a, n);
			await n.engine.acceptCode(code);
			// The new device doesn't read its inbox for now: its transfer waits there.
			reading = false;
			await a.engine.confirmApproval(deviceOf(n));
			expect(approvalOf(a.engine.state)).toMatchObject({ device: deviceOf(n), step: "confirmed" });
			const held = listDevices((await a.host.handle<{ device_list: string }>({ cmd: "status" })).device_list)!;
			expect(held).toContain(deviceOf(n));
			expect(await takenAway(a.api, held, deviceOf(a))).toEqual([]);
			expect(await rejection(a.engine.removeDevice(deviceOf(b)))).toMatchObject({ code: "approval_waits" });
			expect(await rejection(a.engine.changeKeys())).toMatchObject({ code: "approval_waits" });

			// The new device reads its inbox at its next READY: its list goes up, and the approving device's changes go on.
			reading = true;
			n.connect(deviceOf(n));
			await until(() => n.engine.state.name === "ready");
			await until(() => approvalOf(a.engine.state) === null);
			await a.engine.removeDevice(deviceOf(b));
			const served = await a.api.identity(ana);
			expect(listDevices(served.device_list)?.sort()).toEqual([deviceOf(a), deviceOf(n)].sort());
			await Promise.all([a.engine.stop(), b.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	// Task 24's round 2: a change of keys under way makes the identity a new one the API doesn't have yet.
	test(
		"a device whose change of keys waits approves no device until it's done",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const log: string[] = [];
			const a = await firstDevice(fake, ana, { host: watchedHost(testHost(), log) });
			await a.engine.changeKeys();
			expect(a.engine.state).toMatchObject({ name: "ready", rotation: { recoveryKey: expect.any(String) } });
			const n = await newDevice(fake, ana);
			await n.engine.beginApproval();
			await n.engine.useCode();
			await until(() => keptSteps(a).includes("commitment"));
			expect(approvalOf(a.engine.state)).toBeNull();
			await a.engine.approveDevice(deviceOf(n), questionOf(a));
			expect(log).not.toContain("approval_offer");
			// The change done, the new device's question shows.
			await a.engine.keySaved();
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	// Review I1: approval_confirm put the new device on this device's list, and its transfer was never taken (the sheet
	// reopened, a Cancel after a failed send, the new device's restart): the core's way out is to take it off this list
	// and approve it again.
	test(
		"a confirmed approval whose transfer isn't taken: the device comes off the list, and a fresh approval completes",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const removed: unknown[][] = [];
			const host = watchedHost(testHost(), [], (cmd, command) => {
				if (cmd === "sign_device_list" && Array.isArray(command.remove)) removed.push(command.remove);
				return null;
			});
			const a = await firstDevice(fake, ana, { host });
			let reading = true;
			const n = await newDevice(fake, ana, { hears: (event) => reading || event.type !== "DEVICE_MESSAGE" });
			await toTheCode(a, n);
			// Confirmed before the code was typed, and the sheet reopened: the new attempt can't take that transfer.
			reading = false;
			await a.engine.confirmApproval(deviceOf(n));
			await n.engine.useCode();
			// The new attempt's question says the device is taken off this device's list first.
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			expect(approvalOf(a.engine.state)).toMatchObject({ device: deviceOf(n), unfinished: true });
			await a.engine.approveDevice(deviceOf(n), questionOf(a));
			expect(removed).toEqual([[deviceOf(n)]]);
			expect(listDevices((await a.host.handle<{ device_list: string }>({ cmd: "status" })).device_list)).toEqual([
				deviceOf(a),
			]);
			// Its changes no longer wait for it, and the fresh approval completes.
			reading = true;
			n.connect(deviceOf(n));
			await until(() => approvalOf(a.engine.state)?.step === "code");
			await until(() => offered(n));
			await n.engine.acceptCode(approvalOf(a.engine.state)!.code!);
			await a.engine.confirmApproval(deviceOf(n));
			await until(() => n.engine.state.name === "ready");
			expect(listDevices((await n.api.identity(ana)).device_list)?.sort()).toEqual([deviceOf(a), deviceOf(n)].sort());
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	// Step 5's review, I1 (desktop-electrobun#542): «unfinished» was read from the served list, raw, and the way out took
	// off what GET …/devices left out. A server that served a list from before one of the person's devices, and brought a
	// commitment under that device's ID, had the yes take it off the account.
	test(
		"a commitment under a listed device's ID, while the served list and GET …/devices leave it out, asks only «Is this device yours?», and its yes changes no list",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const puts: string[] = [];
			useFake(fake, (request) => {
				if (request.method === "PUT" && request.url.endsWith("/device-list")) puts.push(request.url);
			});
			const log: string[] = [];
			const a = await firstDevice(fake, ana, { host: watchedHost(testHost(), log) });
			const before = await a.api.identity(ana);
			// A device approved here by the code, whose list went up and was taken here.
			const n = await newDevice(fake, ana);
			await n.engine.acceptCode(await toTheCode(a, n));
			await a.engine.confirmApproval(deviceOf(n));
			await until(() => n.engine.state.name === "ready");
			await until(() => approvalOf(a.engine.state) === null);

			// The server serves the list from before it, lists the user's devices without it, and brings a commitment under
			// its ID and with its name, which a core of the server's own made.
			fake.servedAs = (view, _route, viewer) => (viewer === ana ? before : view);
			fake.devicesAs = (devices) => devices.filter(({ id }) => id !== deviceOf(n));
			const forger = testHost();
			await forger.open(ana);
			await forger.handle({ cmd: "create_device", user_id: ana, device_id: deviceOf(n) });
			const { commitment } = await forger.handle<{ commitment: string }>({ cmd: "approval_begin" });
			const frame = { duvet: "approval" as const, step: "commitment" as const, data: commitment };
			await n.api.sendToDevice(deviceOf(a), approvalFrameMessage({ ...frame, name: "Duvet for Windows" }));
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			expect(approvalOf(a.engine.state)).toEqual({
				...{ device: deviceOf(n), name: "Duvet for Windows", question: expect.any(String) },
				...{ fingerprint: await approvalFingerprint(base64Bytes(commitment)), step: "asked" },
			});

			// The yes changes no list: none signed, none put up, and the device stays on both.
			const asked = log.length;
			puts.length = 0;
			await a.engine.approveDevice(deviceOf(n), questionOf(a));
			expect(log.slice(asked)).not.toContain("sign_device_list");
			expect(puts).toEqual([]);
			const held = listDevices((await a.host.handle<{ device_list: string }>({ cmd: "status" })).device_list);
			expect(held).toContain(deviceOf(n));
			fake.servedAs = (view) => view;
			expect(listDevices((await a.api.identity(ana)).device_list)?.sort()).toEqual([deviceOf(a), deviceOf(n)].sort());
			await Promise.all([a.engine.stop(), n.engine.stop(), forger.close()]);
		},
		SLOW,
	);

	// desktop-electrobun#542: the way out took off, with the device approved here, every device GET …/devices left out.
	test(
		"the way out of an unfinished approval signs off that device alone, whatever GET …/devices leaves out",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const removed: unknown[][] = [];
			const host = watchedHost(testHost(), [], (cmd, command) => {
				if (cmd === "sign_device_list" && Array.isArray(command.remove)) removed.push(command.remove);
				return null;
			});
			const a = await firstDevice(fake, ana, { host });
			const b = await approvedDevice(fake, a);
			let reading = true;
			const n = await newDevice(fake, ana, { hears: (event) => reading || event.type !== "DEVICE_MESSAGE" });
			await toTheCode(a, n);
			// Confirmed before the code was typed, and the sheet reopened: the new attempt can't take that transfer.
			reading = false;
			await a.engine.confirmApproval(deviceOf(n));
			await n.engine.useCode();
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			expect(approvalOf(a.engine.state)).toMatchObject({ device: deviceOf(n), unfinished: true });
			// The server lists the user's devices without the other one.
			fake.devicesAs = (devices) => devices.filter(({ id }) => id !== deviceOf(b));
			await a.engine.approveDevice(deviceOf(n), questionOf(a));
			expect(removed).toEqual([[deviceOf(n)]]);
			expect(listDevices((await a.api.identity(ana)).device_list)?.sort()).toEqual([deviceOf(a), deviceOf(b)].sort());
			await Promise.all([a, b, n].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	// Review M1: a restart of the approving app while it shows the code, or of Bun's core worker, which forgets the offer
	// its box names (and refuses approval_confirm without asking until another offer).
	test(
		"the approving device still confirms after its app or its core worker started again at the code",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const log: string[] = [];
			let underWay = false;
			const host = watchedHost(testHost(), log, (cmd) => {
				if (cmd === "approval_offer") underWay = true;
				if (cmd === "approval_confirm" && !underWay) {
					return new CoreError("refused", "this device can't tell what it would approve");
				}
				return null;
			});
			const a = await firstDevice(fake, ana, { host });
			const n = await newDevice(fake, ana);
			const code = await toTheCode(a, n);
			// The app starts again: the question comes back, its yes offers again, and the kept reveal gives the same code.
			const again = await restarted(fake, a);
			await until(() => approvalOf(again.engine.state)?.step === "asked");
			await again.engine.approveDevice(deviceOf(n), questionOf(again));
			await until(() => approvalOf(again.engine.state)?.step === "code");
			expect(approvalOf(again.engine.state)?.code).toBe(code);
			// Then Bun's core worker starts again: the offer goes once more right before the confirmation.
			underWay = false;
			await n.engine.acceptCode(code);
			await again.engine.confirmApproval(deviceOf(n));
			await until(() => n.engine.state.name === "ready");
			expect(log[log.lastIndexOf("approval_confirm") - 1]).toBe("approval_offer");
			await Promise.all([again.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	// Review M2: the question ends with the new device's attempt, by the engine's clock.
	test(
		"«Is this device yours?» goes once the new device's attempt is over",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const n = await newDevice(fake, ana);
			await n.engine.beginApproval();
			await n.engine.useCode();
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			a.clock.advance(9 * MINUTE);
			await turnEnded(a);
			expect(approvalOf(a.engine.state)?.step).toBe("asked");
			a.clock.advance(MINUTE);
			await turnEnded(a);
			expect(approvalOf(a.engine.state)).toBeNull();
			expect(keptSteps(a)).not.toContain("commitment");
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	// Review M3: the code's attempt replaces the QR's in the core, so the QR on screen would open nothing.
	test(
		"a code attempt no device got shows a new QR",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const n = await newDevice(fake, ana);
			await n.engine.beginApproval();
			const first = qrOf(n);
			fake.cutRequest({ method: "POST", path: `/api/devices/${deviceOf(a)}/inbox` });
			expect(await rejection(n.engine.useCode())).toMatchObject({ code: "not_found", what: "approver" });
			const shown = qrOf(n);
			expect(shown).toEqual(expect.any(String));
			expect(shown).not.toBe(first);
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	// Review M5: between another device's change of keys and this one taking its transfer, an offer would certify the
	// new device under the identity it replaced.
	test(
		"the approving device offers nothing while the identity it holds was replaced",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const log: string[] = [];
			let replaced = false;
			const host = watchedHost(
				answeringHost(testHost(), (command) =>
					replaced && command.cmd === "observe_user" && command.user_id === ana
						? { state: "rejected", verified: true, reason: "not_own_identity" }
						: undefined,
				),
				log,
			);
			const a = await firstDevice(fake, ana, { host });
			const n = await newDevice(fake, ana);
			await n.engine.beginApproval();
			await n.engine.useCode();
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			replaced = true;
			await a.engine.approveDevice(deviceOf(n), questionOf(a));
			expect(log).not.toContain("approval_offer");
			expect(approvalOf(a.engine.state)?.step).toBe("asked");
			// Its identity the API's again: the yes offers.
			replaced = false;
			await a.engine.approveDevice(deviceOf(n), questionOf(a));
			expect(log).toContain("approval_offer");
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	// desktop-electrobun#535: the yes offered to the question's commitment while a newer attempt of the device's waited
	// in the record, before the take that keeps the newest alone; the new device then dropped the offer.
	test(
		"a yes to a question a newer attempt replaced offers nothing, and the newer one waits for its own yes",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const offers: unknown[] = [];
			const host = watchedHost(testHost(), [], (cmd, command) => {
				if (cmd === "approval_offer") offers.push(command.commitment);
				return null;
			});
			let reading = true;
			const a = await firstDevice(fake, ana, { host, hears: (event) => reading || event.type !== "DEVICE_MESSAGE" });
			const n = await newDevice(fake, ana);
			await n.engine.beginApproval();
			await n.engine.useCode();
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			const first = approvalOf(a.engine.state)!;
			// The new device begins again: its newer commitment is in the record, as an inbox's round keeps every frame, and
			// the take that asks of it hasn't run.
			reading = false;
			await n.engine.useCode();
			await until(async () => (await a.api.inbox()).length === 1);
			const [newer] = await a.api.inbox();
			a.store.write(KEPT_APPROVALS, [...(a.store.read<InboxMessage[]>(KEPT_APPROVALS) ?? []), newer]);
			await a.api.clearInbox(newer!.id);
			reading = true;

			// The person's yes to the question shown offers nothing, and the newer attempt is asked of.
			await a.engine.approveDevice(deviceOf(n), first.question!);
			expect(offers).toEqual([]);
			const second = approvalOf(a.engine.state)!;
			expect(second).toMatchObject({ device: deviceOf(n), step: "asked", question: newer!.id });
			expect(second.fingerprint).not.toBe(first.fingerprint);
			// Its own yes offers to it, and the new device takes that offer.
			await a.engine.approveDevice(deviceOf(n), second.question!);
			expect(offers).toHaveLength(1);
			await until(() => offered(n));
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	// desktop-electrobun#535, with step 5's review M1: a yes that met an identity this device doesn't hold read the
	// inbox, whose newer commitment of the device's replaced the question, and was tried again at once on that new
	// question: an offer to a fingerprint the person never saw.
	test(
		"a yes tried again after the inbox offers only to the question it answered: a newer one waits for its own yes",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const log: string[] = [];
			let replaced = false;
			const host = watchedHost(
				answeringHost(testHost(), (command) => {
					if (!replaced || command.cmd !== "observe_user" || command.user_id !== ana) return undefined;
					replaced = false;
					return { state: "rejected", verified: true, reason: "not_own_identity" };
				}),
				log,
			);
			let reading = true;
			const a = await firstDevice(fake, ana, { host, hears: (event) => reading || event.type !== "DEVICE_MESSAGE" });
			const n = await newDevice(fake, ana);
			await n.engine.beginApproval();
			await n.engine.useCode();
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			const first = approvalOf(a.engine.state)!;
			// The new device begins again, and its newer commitment waits in the inbox, which the yes reads.
			reading = false;
			await n.engine.useCode();
			await until(async () => (await a.api.inbox()).length === 1);
			reading = true;
			replaced = true;
			await a.engine.approveDevice(deviceOf(n), first.question!);
			expect(log).not.toContain("approval_offer");
			const second = approvalOf(a.engine.state)!;
			expect(second.step).toBe("asked");
			expect(second.fingerprint).not.toBe(first.fingerprint);
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	// Review 27's M4: once the hold is over, a device approved here that never took its transfer is on this device's list
	// with no certificate the API serves, which a first change of keys can't leave out. The page says that in the
	// removal's words (DevicesSettings' removalProblem), not as a connection to check.
	test(
		"a change of keys after an approval that never finished is refused for that device",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			let reading = true;
			const n = await newDevice(fake, ana, { hears: (event) => reading || event.type !== "DEVICE_MESSAGE" });
			await n.engine.acceptCode(await toTheCode(a, n));
			// The new device never reads its transfer, and the hold's ten minutes end.
			reading = false;
			await a.engine.confirmApproval(deviceOf(n));
			a.clock.advance(ATTEMPT_MS);
			await turnEnded(a);
			expect(approvalOf(a.engine.state)).toBeNull();
			expect(await rejection(a.engine.changeKeys())).toMatchObject({ code: "bad_command", field: "certificates" });
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

	// Review 27's M5: a second approval while the first one's hold lasts replaced it, its transfer carrying a list that
	// names the first device without its certificate.
	test(
		"while a device this one approved sets up, another new device's question waits, and approving it is refused",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const log: string[] = [];
			const a = await firstDevice(fake, ana, { host: watchedHost(testHost(), log) });
			let reading = true;
			const n = await newDevice(fake, ana, { hears: (event) => reading || event.type !== "DEVICE_MESSAGE" });
			await n.engine.acceptCode(await toTheCode(a, n));
			reading = false;
			await a.engine.confirmApproval(deviceOf(n));
			expect(approvalOf(a.engine.state)).toMatchObject({ device: deviceOf(n), step: "confirmed" });

			// Another new device asks meanwhile: its question waits, and a yes to it (a stale tap, another tab's) is refused.
			const m = await newDevice(fake, ana);
			await m.engine.beginApproval();
			await m.engine.useCode();
			await until(() => keptSteps(a).includes("commitment"));
			await turnEnded(a);
			expect(approvalOf(a.engine.state)).toMatchObject({ device: deviceOf(n), step: "confirmed" });
			const offers = log.filter((cmd) => cmd === "approval_offer").length;
			expect(await rejection(a.engine.approveDevice(deviceOf(m), questionOf(a)))).toMatchObject({
				code: "approval_waits",
			});
			expect(log.filter((cmd) => cmd === "approval_offer")).toHaveLength(offers);

			// The first one's list up, the hold ends, and the second one is asked about.
			reading = true;
			n.connect(deviceOf(n));
			await until(() => n.engine.state.name === "ready");
			await until(() => approvalOf(a.engine.state)?.device === deviceOf(m));
			expect(approvalOf(a.engine.state)).toMatchObject({ device: deviceOf(m), step: "asked" });
			await Promise.all([a, n, m].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	// Review 27's M6: the inbox's sender is what the API writes, and the device the core approved is approval_confirm's
	// (duvetchat/e2e#53). A server naming another sender routed the transfer, and the hold, elsewhere.
	test(
		"Confirm sends the transfer to, and holds, the device the core approved; a commitment its sender didn't write goes",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const posted: string[] = [];
			useFake(fake, (request) => {
				const path = new URL(request.url).pathname;
				if (request.method === "POST" && path.endsWith("/inbox")) posted.push(path);
			});
			const core = testHost();
			let approved: string | null = null;
			const host = answeringHost(core, (command) =>
				command.cmd === "approval_confirm" && approved
					? core
							.handle<Record<string, unknown>>({ ...command, cmd: "approval_confirm" })
							.then((reply) => ({ ...reply, device_id: approved }))
					: undefined,
			);
			const a = await firstDevice(fake, ana, { host });

			// A commitment that names another device than the one that sent it asks nothing, and goes.
			const other = await newDevice(fake, ana);
			await other.engine.stop();
			await other.host.open(ana);
			const { commitment } = await other.host.handle<{ commitment: string }>({ cmd: "approval_begin" });
			const m = await newDevice(fake, ana);
			const frame = approvalFrameMessage({ duvet: "approval", step: "commitment", data: commitment, name: "Bun" });
			await m.api.sendToDevice(deviceOf(a), frame);
			await until(async () => (await a.api.inbox()).length === 0);
			await turnEnded(a);
			expect(approvalOf(a.engine.state)).toBeNull();
			expect(keptSteps(a)).toEqual([]);

			// The transfer goes to the device approval_confirm names, which the hold then waits for.
			const n = await newDevice(fake, ana);
			await n.engine.acceptCode(await toTheCode(a, n));
			approved = deviceOf(m);
			posted.length = 0;
			await a.engine.confirmApproval(deviceOf(n));
			expect(posted).toEqual([`/api/devices/${deviceOf(m)}/inbox`]);
			expect(approvalOf(a.engine.state)).toMatchObject({ device: deviceOf(m), step: "confirmed" });
			await Promise.all([a, m, n].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	// Review 27's choice 3: the hold ended only at the user's IDENTITY_UPDATE, so a gateway down as it came held list and
	// key changes for the hold's ten minutes.
	test(
		"a hold whose list's IDENTITY_UPDATE never came ends at the inbox's next round, a READY's too",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			let deaf = false;
			const a = await firstDevice(fake, ana, { hears: (event) => !deaf || event.type !== "IDENTITY_UPDATE" });
			const b = await approvedDevice(fake, a);
			const n = await newDevice(fake, ana);
			await n.engine.acceptCode(await toTheCode(a, n));
			// The new device's list goes up while this device hears no IDENTITY_UPDATE.
			deaf = true;
			await a.engine.confirmApproval(deviceOf(n));
			await until(() => n.engine.state.name === "ready");
			await turnEnded(a);
			expect(approvalOf(a.engine.state)).toMatchObject({ device: deviceOf(n), step: "confirmed" });
			// A new gateway session: its READY reads the inbox, whose round ends the hold.
			deaf = false;
			a.connect(deviceOf(a));
			await until(() => approvalOf(a.engine.state) === null);
			await a.engine.removeDevice(deviceOf(b));
			expect(listDevices((await a.api.identity(ana)).device_list)?.sort()).toEqual([deviceOf(a), deviceOf(n)].sort());
			await Promise.all([a, b, n].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	// #550 (step 5's engines review, Minor 5): a send inside the person's act refused for a moment (a 429 whose
	// Retry-After asks a few seconds, as the per-user cap of 50 a second does) waits once, and the same frame goes again:
	// the commitment to the device it missed, the offer the core made, never a new one.
	test(
		"an approval's send refused for a moment goes once the API lets it",
		async () => {
			const { fake, to, bodiesTo } = inboxSends();
			const ana = fake.addUser();
			const a = await firstDevice(fake, ana);
			const n = await newDevice(fake, ana);
			await n.engine.beginApproval();
			const moment = { "Retry-After": "1" };
			const toA = `/api/devices/${deviceOf(a)}/inbox`;
			fake.refuse({ method: "POST", path: toA }, 429, { error: "too many requests, try again later" }, moment);
			await clockedOut(n, n.engine.useCode());
			expect(setupOf(n.engine.state)).toMatchObject({ way: "code", offered: false });
			const [commitment, again] = await bodiesTo(toA);
			expect(again).toBe(commitment!);
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			const toN = `/api/devices/${deviceOf(n)}/inbox`;
			fake.refuse({ method: "POST", path: toN }, 429, { error: "too many requests, try again later" }, moment);
			await clockedOut(a, a.engine.approveDevice(deviceOf(n), questionOf(a)));
			const [offer, resent] = await bodiesTo(toN);
			expect(resent).toBe(offer!);
			expect(to(toN)).toHaveLength(2);
			await until(() => offered(n));
			expect(approvalOf(a.engine.state)).toMatchObject({ step: "code" });
			await Promise.all([a, n].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	// #550: refused for longer than a moment (the inbox's own hundred an hour), the act stops at once, said as the rate
	// limit it is: never as no device that can approve, nor by leaving the device out without a word.
	test(
		"an approval's send refused for longer is said as the rate limit, not as no approver",
		async () => {
			const { fake, to } = inboxSends();
			const ana = fake.addUser();
			const a = await firstDevice(fake, ana);
			const n = await newDevice(fake, ana);
			await n.engine.beginApproval();
			const toA = `/api/devices/${deviceOf(a)}/inbox`;
			fake.refuse(
				{ method: "POST", path: toA },
				429,
				{ error: "too many requests, try again later" },
				{
					"Retry-After": "3600",
				},
			);
			expect(await rejection(n.engine.useCode())).toMatchObject({ response: { status: 429 } });
			expect(to(toA)).toHaveLength(1);
			// The QR its attempt replaced is made again, to show in its place.
			expect(qrOf(n)).toEqual(expect.any(String));
			await Promise.all([a, n].map((device) => device.engine.stop()));
		},
		SLOW,
	);
});

/** The fake, answering the test's requests; each send to a device's inbox, by its path, with its body. */
function inboxSends() {
	const fake = new FakeApi();
	const sent: { path: string; body: Promise<string> }[] = [];
	useFake(fake, (request) => {
		const path = new URL(request.url).pathname;
		if (request.method === "POST" && path.endsWith("/inbox")) sent.push({ path, body: request.text() });
	});
	const to = (path: string) => sent.filter((one) => one.path === path);
	const bodiesTo = (path: string) => Promise.all(to(path).map((one) => one.body));
	return { fake, to, bodiesTo };
}

/** The device's act, its clock moved on a quarter second at a time until it settles: a wait it asked for runs out. */
async function clockedOut<T>(device: TestDevice, act: Promise<T>): Promise<T> {
	let settled = false;
	void act.then(
		() => (settled = true),
		() => (settled = true),
	);
	await until(() => (device.clock.advance(250), settled));
	return act;
}
