import { describe, expect, test } from "bun:test";
import type { InboxMessage } from "$lib/api/e2e";
import { base64Bytes } from "$lib/activity-thumbnail";
import { asBytes, asMap, cbor, listDevices } from "../cbor";
import { approvalFrameMessage, readApprovalFrame } from "../conventions";
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
	await approver.engine.approveDevice(deviceOf(fresh));
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
				step: "asked",
			});
			await a.engine.approveDevice(deviceOf(n));
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
			await again.engine.approveDevice(deviceOf(n));
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

			// The approving device's own attempt ends ten minutes after its offer: its question says so (M1).
			await n.engine.useCode();
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			await a.engine.approveDevice(deviceOf(n));
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
			await a.engine.approveDevice(deviceOf(n));
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
			await a.engine.approveDevice(deviceOf(n));
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
			await again.engine.approveDevice(deviceOf(n));
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
			await a.engine.approveDevice(deviceOf(n));
			expect(log).not.toContain("approval_offer");
			expect(approvalOf(a.engine.state)?.step).toBe("asked");
			// Its identity the API's again: the yes offers.
			replaced = false;
			await a.engine.approveDevice(deviceOf(n));
			expect(log).toContain("approval_offer");
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);
});
