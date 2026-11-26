import { describe, expect, test } from "bun:test";
import type { InboxMessage } from "$lib/api/e2e";
import { listDevices } from "../cbor";
import { approvalFrameMessage, readApprovalFrame } from "../conventions";
import { CoreError } from "../errors";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
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

			// The approving device's own attempt ends ten minutes after its offer: its question goes.
			await n.engine.useCode();
			await until(() => approvalOf(a.engine.state)?.step === "asked");
			await a.engine.approveDevice(deviceOf(n));
			expect(approvalOf(a.engine.state)?.step).not.toBe("asked");
			a.clock.advance(10 * MINUTE);
			await turnEnded(a);
			expect(approvalOf(a.engine.state)).toBeNull();
			await Promise.all([a.engine.stop(), n.engine.stop()]);
		},
		SLOW,
	);

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
});
