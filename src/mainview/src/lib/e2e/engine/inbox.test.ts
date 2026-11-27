import { describe, expect, spyOn, test } from "bun:test";
import { FetchError } from "$lib/api/api";
import type { InboxMessage } from "$lib/api/e2e";
import { certificateDevice } from "../cbor";
import { approvalFrameMessage } from "../conventions";
import { CoreError } from "../errors";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import { firstDevice, memoryStore, testDevice, testHost, until, useFake, watchedHost } from "../testing/engines";
import type { EngineParts } from "./engine";
import { takeInbox } from "./inbox";
import { pageStore } from "./store";

// #555 (found by step 5's fuzzing of the Android app, mobile#362): a server serving one full page of the inbox whatever
// `after` is asked kept the round reading it for good, and the engine's one turn with it. A page that doesn't go past
// where its read began ends the round, as a queue page does (#546), and the next round reads the inbox again.
describe("the inbox's pages", () => {
	test("a full page served again whatever after is asked ends the round", async () => {
		const [user, other] = ["0193a4b2-0000-7000-8000-00000000a0a0", "0193a4b2-0000-7000-8000-00000000b0b0"];
		const page: InboxMessage[] = Array.from({ length: 100 }, (_, i) => ({
			id: `0193a4b2-0000-7000-8000-${String(i + 1).padStart(12, "0")}`,
			...{ from_user_id: other, from_device_id: other, message: "bWVzc2FnZQ==", created_at: "2026-11-26T10:00:00Z" },
		}));
		const asked: (string | undefined)[] = [];
		const cleared: string[] = [];
		let handled = 0;
		const noIdentity = new FetchError(
			"no identity",
			{},
			{
				...{ data: { error: "identity not found" }, status: 404, statusText: "Not Found", headers: new Headers() },
			},
		);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the parts the inbox reads, and nothing else
		const parts = {
			user,
			store: memoryStore(),
			api: {
				inbox: async (after?: string) => {
					if (asked.push(after) > 10) throw new Error("the inbox was read for good");
					return page;
				},
				clearInbox: async (through: string) => void cleared.push(through),
				identity: async () => Promise.reject(noIdentity),
			},
			host: { handle: async () => (handled++, { type: "direct" }) },
		} as unknown as EngineParts;
		await takeInbox(parts, new Map());
		expect(asked).toEqual([undefined, page.at(-1)!.id]);
		expect(cleared).toEqual([page.at(-1)!.id]);
		expect(handled).toBe(100);
	});
});

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
			// Their DEVICE_MESSAGE events wait for good: here the reads are READY's, one at a time. Its steps are its core's
			// commitments, as only one naming the device that sent it is asked about (task 27's review, M6).
			const commitment = async () =>
				(await other.host.handle<{ commitment: string }>({ cmd: "approval_begin" })).commitment;
			const frame = (data: string) => approvalFrameMessage({ duvet: "approval", step: "commitment", data });
			const [first, second] = [await commitment(), await commitment()];
			fake.holdEvents();
			const sent: string[] = [];
			for (const message of [frame(first), btoa("not the core's"), btoa("kept for later"), frame(second)]) {
				sent.push((await other.api.sendToDevice(device, message)).id);
			}
			const [firstFrame, , kept, lastFrame] = sent;
			expect(sent).toHaveLength(4);
			// The first round keeps the frame, then stops at the cut call: only the frame is deleted.
			a.connect(device);
			await until(() => log.includes("receive_direct"));
			await until(async () => (await a.api.inbox()).length === 3);
			expect((await a.api.inbox()).map((message) => message.id)).toEqual(sent.slice(1));

			// The next READY reads it again: what the core can't read is dropped, the transfer kept, the frame kept. Of a
			// device's commitments the approval's flow keeps the newest (Task 26): one sent again replaces the one before,
			// in the take that follows the inbox's round in the engine's turn, once the inbox is empty (#533).
			a.connect(device);
			await until(async () => (await a.api.inbox()).length === 0);
			await a.engine.uploadLater(); // the engine's turn after the inbox's
			expect(firstFrame).toBeDefined();
			expect((a.store.read<{ id: string }[]>("approvals") ?? []).map((message) => message.id)).toEqual([lastFrame!]);
			expect((a.store.read<{ id: string }[]>("transfers") ?? []).map((message) => message.id)).toEqual([kept!]);
			await Promise.all([a.engine.stop(), other.engine.stop()]);
		},
		SLOW,
	);

	// I4: a history or catch-up key is checked against the device that sent it (Tasks 22 and 30), whose certificate the
	// inbox hands the core from its user's identity as served; one the core refuses for a field its task gives is kept.
	test(
		"a message goes to the core with its sender's certificate, and one its task takes is kept for it",
		async () => {
			const fake = new FakeApi();
			const [ana, bob] = [fake.addUser(), fake.addUser()];
			fake.addConversation({ type: "dm", members: [ana, bob] });
			useFake(fake);
			const received: Record<string, unknown>[] = [];
			const [first, second] = [btoa("not the core's"), btoa("a history key")];
			// The core can't take the second yet, whenever it's asked: each round asks again (Task 30).
			const host = watchedHost(testHost(), [], (cmd, command) => {
				if (cmd !== "receive_direct") return null;
				received.push(command);
				return command.message === second
					? new CoreError("bad_command", "a field is missing", { field: "group_info" })
					: null;
			});
			const a = await firstDevice(fake, ana, { host });
			const b = await firstDevice(fake, bob);
			for (const message of [first, second]) await b.api.sendToDevice(a.registered[0]!, message);
			await until(async () => (await a.api.inbox()).length === 0);

			const certificate = (await a.api.identity(bob)).certificates.find(
				(one) => certificateDevice(one) === b.registered[0],
			);
			expect(certificate).toBeString();
			expect(received.length).toBeGreaterThanOrEqual(2);
			expect(received.every((command) => command.from_certificate === certificate)).toBe(true);
			expect(received.filter((command) => command.message === first)).toHaveLength(1);
			expect((a.store.read<{ message: string }[]>("later") ?? []).map(({ message }) => message)).toEqual([second]);
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// M3: an approval is between a user's own devices: another user's step has no flow here to go to.
	test(
		"an approval's step from another user is dropped, never kept",
		async () => {
			const fake = new FakeApi();
			const [ana, bob] = [fake.addUser(), fake.addUser()];
			fake.addConversation({ type: "dm", members: [ana, bob] });
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const b = await firstDevice(fake, bob);
			const frame = approvalFrameMessage({ duvet: "approval", step: "commitment", data: "AAAA" });
			await b.api.sendToDevice(a.registered[0]!, frame);
			await until(async () => (await a.api.inbox()).length === 0);
			expect(a.store.read("approvals")).toBeNull();
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// M4: a call cut round after round: past five, nothing will change for the message, and it would hold up the rest.
	test(
		"a message whose call is cut five rounds running goes",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const log: string[] = [];
			const host = watchedHost(testHost(), log, (cmd) =>
				cmd === "receive_direct" ? new CoreError("internal", "the call was cut") : null,
			);
			const a = await firstDevice(fake, ana, { host });
			const other = testDevice(fake, ana);
			await other.engine.start();
			const device = a.registered[0]!;
			// Its DEVICE_MESSAGE waits for good: each round is a READY's.
			fake.holdEvents();
			await other.api.sendToDevice(device, btoa("cut every time"));
			const tries = () => log.filter((cmd) => cmd === "receive_direct").length;
			for (let round = 1; round <= 5; round++) {
				expect(await a.api.inbox()).toHaveLength(1);
				a.connect(device);
				await until(() => tries() === round);
			}
			await until(async () => (await a.api.inbox()).length === 0, 20_000);
			await Promise.all([a.engine.stop(), other.engine.stop()]);
		},
		SLOW,
	);

	// #502: the page's record logs a write its storage refuses (full, or refused), and goes on; a message the inbox keeps
	// there for its task (a catch-up's key is sent once) must then stay in the API's inbox, as one the core couldn't take.
	test(
		"an inbox message the record couldn't keep stays in the inbox",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			// The page's record, whose storage refuses the kept transfers while it's full.
			let full = true;
			const setItem = localStorage.setItem.bind(localStorage);
			spyOn(localStorage, "setItem").mockImplementation((key: string, value: string) => {
				if (full && key === `duvet.e2e.${ana}.transfers`) {
					throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
				}
				setItem(key, value);
			});
			const log: string[] = [];
			// The core keeps every message for later: a transfer whose approval's code wasn't accepted yet.
			const later = new CoreError("not_found", "no approval accepted its code", { what: "code" });
			const host = watchedHost(testHost(), log, (cmd) => (cmd === "receive_direct" ? later : null));
			const a = await firstDevice(fake, ana, { host, store: pageStore(ana) });
			const other = testDevice(fake, ana);
			await other.engine.start();
			const { id } = await other.api.sendToDevice(a.registered[0]!, btoa("a transfer for later"));

			// The round reads it, and the record refuses it: it stays in the inbox, for the next round.
			await until(() => log.includes("receive_direct"));
			await a.engine.uploadLater(); // the engine's turn after the inbox's
			expect((await a.api.inbox()).map((message) => message.id)).toEqual([id]);

			// With room again, the next round keeps it, then deletes it.
			full = false;
			a.connect(a.registered[0]!);
			await until(async () => (await a.api.inbox()).length === 0);
			expect((pageStore(ana).read<{ id: string }[]>("transfers") ?? []).map((message) => message.id)).toEqual([id]);
			await Promise.all([a.engine.stop(), other.engine.stop()]);
		},
		SLOW,
	);
});
