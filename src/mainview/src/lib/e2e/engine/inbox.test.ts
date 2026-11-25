import { describe, expect, test } from "bun:test";
import { approvalFrameMessage } from "../conventions";
import { CoreError } from "../errors";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import { firstDevice, testDevice, testHost, until, useFake, watchedHost } from "../testing/engines";

// The inbox (PLAN-E2E-CLIENTES.md, «El buzón»): what other devices sent this one, read at start, at each READY and on
// DEVICE_MESSAGE; each message deleted only once it's handled.
const SLOW = 180_000;

describe.skipIf(!coreLibrary)("the inbox", () => {
	test(
		"a rotation's transfer is taken from the inbox, and the own user is observed after",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const b = testDevice(fake, ana);
			await b.engine.start();
			expect(b.engine.state).toEqual({ name: "new_device" });

			// Ana's first device approves her second by its QR, by hand (Task 26 does it in the app); the second lists itself.
			await a.engine.stop();
			await a.host.open(ana);
			const { qr } = await b.host.handle<{ qr: string }>({ cmd: "approval_begin" });
			const approved = await a.host.handle<Record<string, string>>({ cmd: "approval_from_qr", qr });
			await b.host.handle({ cmd: "approval_receive", transfer: approved.transfer });
			const { version } = await b.api.putDeviceList({
				...{ device_list: approved.device_list!, certificate: approved.certificate },
				base_version: 1,
			});
			await b.host.handle({ cmd: "device_list_uploaded", version });
			await b.engine.stop();
			const log: string[] = [];
			// It hears no IDENTITY_UPDATE, which observes the user too: what observes after the transfer is the inbox's rule.
			const second = testDevice(fake, ana, {
				...{ host: watchedHost(b.host, log), store: b.store, token: b.token },
				hears: (event) => event.type !== "IDENTITY_UPDATE",
			});
			await second.engine.start();
			expect(second.engine.state).toEqual({ name: "ready" });

			// The first device changes the keys, keeping the second: its transfer goes to the second's inbox.
			const served = await a.api.identity(ana);
			const { identity_key, device_list, certificates } = served;
			await a.host.handle({ cmd: "observe_user", user_id: ana, identity_key, device_list, certificates });
			const rotated = await a.host.handle<Record<string, any>>({
				cmd: "rotate_keys",
				remove: [],
				certificates: served.certificates,
			});
			const published = await a.api.putIdentity({
				...{ identity_key: rotated.identity_key, device_list: rotated.device_list, certificate: rotated.certificate },
				...{ encrypted_identity: rotated.encrypted_identity, wrapped_backup_key: rotated.wrapped_backup_key },
				...{ wrapped_previous_backup_keys: rotated.wrapped_previous_backup_keys, replaces: served.identity_key },
				transfers: rotated.transfers.map((t: Record<string, string>) => ({
					...{ device_id: t.device_id!, certificate: t.certificate!, message: t.transfer! },
				})),
			});
			await a.host.handle({ cmd: "identity_uploaded" });
			await a.host.handle({ cmd: "device_list_uploaded", version: published.device_list_version });

			// The second takes it on DEVICE_MESSAGE, then observes its own user: it holds the new identity, and stays ready.
			await until(async () => (await second.api.inbox()).length === 0);
			await until(() => log.lastIndexOf("observe_user") > log.lastIndexOf("receive_direct"), 20_000);
			expect(log).toContain("receive_direct");
			const status = await second.host.handle<{ identity_key: string }>({ cmd: "status" });
			expect(status.identity_key).toBe(rotated.identity_key);
			expect(second.engine.state).toEqual({ name: "ready" });
			await second.engine.stop();
			await a.host.close();
		},
		SLOW,
	);

	test(
		"an inbox message is deleted only once it's handled",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			let cut = true;
			let refusedByCode = 0;
			const log: string[] = [];
			const host = watchedHost(testHost(), log, (cmd) => {
				if (cmd !== "receive_direct") return null;
				// The first message the core reads is cut midway; the second after that is a transfer the core keeps for later.
				if (cut) return ((cut = false), new CoreError("internal", "the call was cut"));
				if (++refusedByCode === 2) return new CoreError("not_found", "no approval accepted its code", { what: "code" });
				return null;
			});
			const a = await firstDevice(fake, ana, { host });
			const other = testDevice(fake, ana);
			await other.engine.start();
			const device = a.registered[0]!;

			// Another device of Ana's writes to this one: a step of an approval, two messages of the core's, and another step.
			// Their DEVICE_MESSAGE events wait for good: here the reads are READY's, one at a time.
			const frame = (data: string) => approvalFrameMessage({ duvet: "approval", step: "commitment", data });
			fake.holdEvents();
			const sent: string[] = [];
			for (const message of [frame("AAAA"), btoa("not the core's"), btoa("kept for later"), frame("BBBB")]) {
				sent.push((await other.api.sendToDevice(device, message)).id);
			}
			const [firstFrame, , kept, lastFrame] = sent;
			expect(sent).toHaveLength(4);
			// The first round keeps the frame, then stops at the cut call: only the frame is deleted.
			a.connect(device);
			await until(() => log.includes("receive_direct"));
			await until(async () => (await a.api.inbox()).length === 3);
			expect((await a.api.inbox()).map((message) => message.id)).toEqual(sent.slice(1));

			// The next READY reads it again: what the core can't read is dropped, the transfer kept, the frame kept.
			a.connect(device);
			await until(async () => (await a.api.inbox()).length === 0);
			expect((a.store.read<{ id: string }[]>("approvals") ?? []).map((message) => message.id)).toEqual([
				firstFrame!,
				lastFrame!,
			]);
			expect((a.store.read<{ id: string }[]>("transfers") ?? []).map((message) => message.id)).toEqual([kept!]);
			await Promise.all([a.engine.stop(), other.engine.stop()]);
		},
		SLOW,
	);
});
