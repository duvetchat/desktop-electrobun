import { describe, expect, test } from "bun:test";
import { listDevices } from "../cbor";
import { CoreError } from "../errors";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	firstDevice,
	groupOf,
	rejection,
	restarted,
	sameGroup,
	testDevice,
	testHost,
	until,
	useFake,
	watchedHost,
	type TestDevice,
} from "../testing/engines";
import type { EngineState } from "./engine";

// Starting over (PLAN-E2E-CLIENTES.md, Task 26; decision 47): a new device without the recovery key or another device
// makes a new identity for the user, its recovery key shown until it's saved, uploaded in the place of the one before
// (`reset`), and comes back into its conversations once another member commits the removal of the devices before.
const SLOW = 180_000;
const RECOVERY_KEY = /^[1-9A-HJ-NP-Za-km-z]{48}$/;
const IDENTITY = { method: "PUT", path: "/api/users/@me/identity" };

const said = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const deviceOf = (device: TestDevice) => device.registered.at(-1)!;
/** The new recovery key starting over shows, or null. */
const resetKey = (state: EngineState) =>
	state.name === "new_device" && state.setup?.way === "reset" ? state.setup.recoveryKey : null;

/** Another device of the user's, on a session of its own: a new device, as its start leaves it. */
async function newDevice(fake: FakeApi, user: string, given: Parameters<typeof testDevice>[2] = {}) {
	const device = testDevice(fake, user, given);
	await device.engine.start();
	expect(device.engine.state).toEqual({ name: "new_device" });
	return device;
}

/**
 * The member's device takes out the leaves of `user`'s devices before they started over, by hand, its engine stopped:
 * it observes their new identity and commits what's pending, as the API's removals proposal leads it to (the fake
 * proposes none).
 */
async function commitTheirRemoval(member: TestDevice, conversation: string, user: string, memberUser: string) {
	await member.engine.stop();
	await member.host.open(memberUser);
	const observe = async (users: string[]) => {
		for (const { user_id, identity_key, device_list, certificates } of await member.api.identities(users)) {
			await member.host.handle({ cmd: "observe_user", user_id, identity_key, device_list, certificates });
		}
	};
	await observe([user]);
	const { generation, epoch } = (await groupOf(member, conversation))!;
	const pending = () =>
		member.host.handle<{ commit: string; group_info: string }>({
			cmd: "commit_pending",
			conversation_id: conversation,
		});
	// The core asks for the identities it needs first, as the engine's withIdentities answers.
	const made = await pending().catch(async (error: unknown) => {
		if (!(error instanceof CoreError && error.code === "needs_identities" && error.users)) throw error;
		await observe(error.users);
		return pending();
	});
	const taken = await member.api.commit(conversation, { generation, epoch, ...made });
	await member.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: true, seq: taken.seq });
}

describe.skipIf(!coreLibrary)("starting over", () => {
	test(
		"starting over makes a new identity and waits for another member's commit to rejoin",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const identities: Promise<unknown>[] = [];
			useFake(fake, (request) => {
				if (said(request) === `${IDENTITY.method} ${IDENTITY.path}`) identities.push(request.json());
			});
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const [a, b] = [await firstDevice(fake, ana), await firstDevice(fake, bo)];
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			// Ana's only device is gone, and with it what would set up another: a new device starts over.
			await a.engine.stop();
			const before = await b.api.identity(ana);
			identities.length = 0;
			const n = await newDevice(fake, ana);
			await n.engine.resetIdentity();
			const key = resetKey(n.engine.state);
			expect(key).toMatch(RECOVERY_KEY);
			expect(n.engine.state).toEqual({
				name: "new_device",
				setup: { way: "reset", recoveryKey: key, finishing: false },
			});
			// Nothing goes up before the person saved the new key.
			expect(identities).toEqual([]);

			await n.engine.keySaved();
			expect(n.engine.state.name).toBe("ready");
			const after = await n.api.identity(ana);
			expect(after.identity_key).not.toBe(before.identity_key);
			expect(listDevices(after.device_list)).toEqual([deviceOf(n)]);
			expect(await Promise.all(identities)).toEqual([
				expect.objectContaining({ reset: true, replaces: before.identity_key, identity_key: after.identity_key }),
			]);
			expect((await n.api.devices()).find(({ id }) => id === deviceOf(a))).toMatchObject({ listed: false });

			// The DM waits: its group still has the leaf of the device before, which only another member's commit takes out.
			await until(() => n.engine.conversationState(conversation)?.name === "wait_rejoin");
			await commitTheirRemoval(b, conversation, ana, bo);
			const back = await restarted(fake, b);
			await until(() => n.engine.conversationState(conversation) === null);
			await sameGroup([n, back], conversation);
			await Promise.all([n.engine.stop(), back.engine.stop()]);
		},
		SLOW,
	);

	test(
		"starting over's recovery key shows until it's saved, and a start over cut before its upload finishes with it",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			await a.engine.stop();
			const log: string[] = [];
			let refusals = 1;
			const host = watchedHost(testHost(), log, (cmd) =>
				cmd === "reset_identity" && refusals-- > 0 ? new CoreError("refused", "the person didn't confirm it") : null,
			);
			const n = await newDevice(fake, ana, { host });
			// On the desktop Bun asks first: its no changes nothing, here or at the next start.
			await n.engine.resetIdentity();
			expect(n.engine.state).toEqual({ name: "new_device" });
			const unasked = await restarted(fake, n);
			expect(unasked.engine.state).toEqual({ name: "new_device" });

			await unasked.engine.resetIdentity();
			const key = resetKey(unasked.engine.state);
			expect(key).toMatch(RECOVERY_KEY);
			// Its upload cut: the key still shows, then waits for Finish once the sheet closes.
			fake.cutRequest(IDENTITY);
			expect(await rejection(unasked.engine.keySaved())).toBeInstanceOf(TypeError);
			expect(resetKey(unasked.engine.state)).toBe(key);
			await unasked.engine.uploadLater();
			expect(unasked.engine.state).toEqual({
				name: "new_device",
				setup: { way: "reset", recoveryKey: null, finishing: true },
			});
			// The app starts again: still a start over of its own, never a first device's race lost.
			const again = await restarted(fake, unasked);
			expect(again.engine.state).toEqual({
				name: "new_device",
				setup: { way: "reset", recoveryKey: null, finishing: true },
			});
			await again.engine.finishSetup();
			expect(resetKey(again.engine.state)).toBe(key);
			await again.engine.keySaved();
			expect(again.engine.state.name).toBe("ready");
			expect(listDevices((await again.api.identity(ana)).device_list)).toEqual([deviceOf(again)]);
			expect(log.filter((cmd) => cmd === "reset_identity")).toHaveLength(3);
			await again.engine.stop();
		},
		SLOW,
	);
});
