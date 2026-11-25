import { describe, expect, test } from "bun:test";
import { base64Bytes } from "$lib/activity-thumbnail";
import { bytesBase64 } from "$lib/staged-images";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	firstDevice,
	groupOf,
	restarted,
	sameGroup,
	testDevice,
	turnEnded,
	until,
	useFake,
	type TestDevice,
} from "../testing/engines";

// Joining and making a conversation's group (PLAN-E2E-CLIENTES.md, «Entrar a un grupo»), and a blocked group's restart:
// who makes a group, and how the others come into it.
const SLOW = 180_000;
const commits = (conversation: string) => `/api/users/@me/conversations/${conversation}/mls/commits`;

/** The fake and its requests (method and path). */
function setUp() {
	const fake = new FakeApi();
	const requests: string[] = [];
	useFake(fake, (request) => requests.push(`${request.method} ${new URL(request.url).pathname}`));
	return { fake, requests };
}

/** Ana's group with Bo and Cy, a device each: made by Ana's device, the others in by its welcome. */
async function groupOfThree() {
	const { fake, requests } = setUp();
	const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
	const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
	const [a, b, c] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, cy)];
	await a.engine.openConversation(conversation);
	const made = await sameGroup([a, b, c], conversation);
	return { fake, requests, ana, bo, cy, a, b, c, conversation, made };
}

/**
 * The same group, blocked by a commit no device can process, as a server that takes anything would let it in: Ana's
 * leaf renewal, one byte of its signature changed, sent under Bo's session (Ana's own renewal never went). Every device
 * says so, Ana's engine started again.
 */
async function blockedGroup() {
	const group = await groupOfThree();
	const { fake, ana, b, c, conversation, made } = group;
	let { a } = group;
	await a.engine.stop();
	await a.host.open(ana);
	const refresh = await a.host.handle<{ commit: string; group_info: string }>({
		cmd: "refresh",
		conversation_id: conversation,
	});
	const bytes = base64Bytes(refresh.commit);
	bytes[bytes.length - 1]! ^= 0xff;
	const { generation, epoch } = made;
	await b.api.commit(conversation, { generation, epoch, commit: bytesBase64(bytes), group_info: refresh.group_info });
	await a.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: false, invalid: true });
	a = await restarted(fake, a);
	await until(() => [a, b, c].every((d) => d.engine.conversationState(conversation)?.name === "blocked"));
	return { ...group, a };
}

/** The owner's removal of a member, by hand (Task 22 brings the flow), with the owner's engine stopped. */
async function removeByHand(owner: TestDevice, conversation: string, user: string) {
	const { generation, epoch } = (await groupOf(owner, conversation))!;
	const made = await owner.host.handle<{ commit: string; group_info: string }>({
		...{ cmd: "remove_members", conversation_id: conversation, users: [user] },
	});
	const taken = await owner.api.removeMember(conversation, user, { generation, epoch, ...made });
	await owner.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: true, seq: taken.seq });
	return taken;
}

/** The owner's addition of a user, by hand, with a key package of each of their devices, and its welcome. */
async function addByHand(owner: TestDevice, conversation: string, user: string, key_packages: { data: string }[]) {
	const { generation, epoch } = (await groupOf(owner, conversation))!;
	const made = await owner.host.handle<{ commit: string; group_info: string; welcome: string }>({
		...{ cmd: "add_members", conversation_id: conversation },
		users: [{ user_id: user, key_packages: key_packages.map((kp) => kp.data) }],
	});
	const { commit, group_info, welcome } = made;
	const added = await owner.api.addMember(conversation, user, { generation, epoch, commit, group_info, welcome });
	await owner.host.handle({
		...{ cmd: "commit_result", conversation_id: conversation },
		...{ accepted: true, seq: added.commit.seq },
	});
	return added;
}

describe.skipIf(!coreLibrary)("a conversation's group", () => {
	test(
		"the owner makes a new group and the others wait",
		async () => {
			const { fake, requests } = setUp();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			const [a, b, c] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, cy)];
			// Bo opens the group before its owner: he waits for her, and nothing is made.
			await b.engine.openConversation(conversation);
			expect(b.engine.conversationState(conversation)).toEqual({ name: "wait_owner", owner: ana });
			expect(requests).not.toContain(`POST ${commits(conversation)}`);
			expect(await groupOf(b, conversation)).toBeNull();

			// Ana opens it: she makes it, and the others come in by its welcome.
			await a.engine.openConversation(conversation);
			const held = await sameGroup([a, b, c], conversation);
			expect(held.devices.map((device) => device.user_id).sort()).toEqual([ana, bo, cy].sort());
			await until(() => b.engine.conversationState(conversation) === null);
			expect(a.engine.conversationState(conversation)).toBeNull();
		},
		SLOW,
	);

	test(
		"either member makes a DM's",
		async () => {
			const { fake } = setUp();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo], owner: ana });
			const [a, b] = [await firstDevice(fake, ana), await firstDevice(fake, bo)];
			// Bo, who isn't the one who started the DM, opens it first and makes its group.
			await b.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			const [creation] = (await a.api.queue(conversation, 0)).entries;
			expect(creation).toMatchObject({ kind: "commit", sender_user: bo, generation: 0, epoch: 0 });
			expect(b.engine.conversationState(conversation)).toBeNull();
		},
		SLOW,
	);

	test(
		"two members make a legacy group at once and end in the same one",
		async () => {
			const { fake } = setUp();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({
				...{ type: "group", members: [ana, bo, cy], owner: ana },
				legacy: true,
			});
			const [a, b, c] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, cy)];
			// Both open it at once: both make a group, and their creations reach the API together.
			fake.gather({ method: "POST", path: commits(conversation) }, 2);
			await Promise.all([a.engine.openConversation(conversation), b.engine.openConversation(conversation)]);
			await sameGroup([a, b, c], conversation);
			// One creation took epoch 0; the other's maker came in by the winner's welcome.
			const entries = (await a.api.queue(conversation, 0)).entries;
			expect(entries.filter((entry) => entry.kind === "commit" && entry.epoch === 0)).toHaveLength(1);
		},
		SLOW,
	);

	test(
		"a blocked group offers its restart to its owner, and everyone joins the next generation",
		async () => {
			const { ana, a, b, c, conversation } = await blockedGroup();
			// Every device finds the group blocked: its owner is offered the restart, the others wait for her.
			expect(a.engine.conversationState(conversation)).toEqual({ name: "blocked", restart: "mine", owner: ana });
			expect(b.engine.conversationState(conversation)).toEqual({ name: "blocked", restart: "owner", owner: ana });
			expect(c.engine.conversationState(conversation)).toEqual({ name: "blocked", restart: "owner", owner: ana });

			// Bo can't restart it; Ana can, and everyone joins the next generation, the notices gone.
			await b.engine.restartGroup(conversation);
			expect((await groupOf(b, conversation))!.generation).toBe(0);
			await a.engine.restartGroup(conversation);
			const after = await sameGroup([a, b, c], conversation);
			expect(after).toMatchObject({ generation: 1, blocked: false });
			await until(() => [a, b, c].every((d) => d.engine.conversationState(conversation) === null));
		},
		SLOW,
	);

	// I1: the restart's commit and its welcome come in two events of their own. A device whose turn for the commit ends
	// before the welcome's event comes reads the welcome from the queue, right after the commit: it races no external
	// commit for the next generation.
	test(
		"a restart's welcome brings every device in, though its event comes after the commit's turn",
		async () => {
			const { fake, ana, a, b, c, conversation } = await blockedGroup();
			fake.holdEvents();
			await a.engine.restartGroup(conversation);
			// Each device hears the restart's commit, and its turn ends; only then does the welcome's event come.
			fake.releaseEvents({ only: (event) => event.type === "MLS_COMMIT" });
			await Promise.all([a, b, c].map(turnEnded));
			fake.releaseEvents();
			const after = await sameGroup([a, b, c], conversation);
			expect(after).toMatchObject({ generation: 1, blocked: false });
			// No device came in by an external commit: the next generation has the restart's commit and its welcome.
			const entries = (await a.api.queue(conversation, 0)).entries.filter((entry) => entry.generation === 1);
			expect(entries.map(({ kind, sender_user }) => [kind, sender_user])).toEqual([
				["commit", ana],
				["welcome", ana],
			]);
		},
		SLOW,
	);

	// I2: a removal comes back to the removed device as `removed`. Its user out of the conversation, the device asks
	// for no way back in: no group info, now or as the minutes go by.
	test(
		"a removed user's device doesn't try to come back",
		async () => {
			const { requests, ana, cy, a, c, conversation } = await groupOfThree();
			await a.engine.stop();
			await a.host.open(ana);
			await removeByHand(a, conversation, cy);
			await until(async () => (await groupOf(c, conversation)) === null);
			await turnEnded(c);
			for (let minute = 0; minute < 3; minute++) {
				c.clock.advance(60_000);
				await turnEnded(c);
			}
			expect(requests.filter((request) => request.endsWith("/mls/group-info"))).toEqual([]);
			expect(c.engine.conversationState(conversation)).toBeNull();
		},
		SLOW,
	);

	// I1: a user removed and added back has a welcome waiting in the queue, after the addition's commit, which they
	// hear first: their device comes back by it, never by an external commit, whatever comes in between.
	test(
		"a user removed and added back comes in by the new welcome",
		async () => {
			const { fake, ana, cy, a, b, c, conversation } = await groupOfThree();
			// Key packages of Cy's, claimed while they share the group: Ana can't claim them once it's out of hers.
			const { key_packages } = await a.api.claimKeyPackages(cy);
			await a.engine.stop();
			await a.host.open(ana);
			const removal = await removeByHand(a, conversation, cy);
			await until(async () => (await groupOf(c, conversation)) === null);
			await turnEnded(c);

			// Ana adds Cy back. Cy's device hears nothing of it while minutes pass, then the addition's commit, and its
			// turn ends; then the welcome.
			fake.holdEvents();
			await addByHand(a, conversation, cy, key_packages);
			for (let minute = 0; minute < 3; minute++) {
				c.clock.advance(60_000);
				await turnEnded(c);
			}
			fake.releaseEvents({ only: (event) => event.type === "MLS_COMMIT" });
			await turnEnded(c);
			fake.releaseEvents();
			await until(async () => (await groupOf(c, conversation)) !== null);
			const since = (await b.api.queue(conversation, removal.seq)).entries.filter(({ kind }) => kind === "commit");
			expect(since.map((entry) => entry.sender_user)).toEqual([ana]);
			await sameGroup([a, b, c], conversation);
		},
		SLOW,
	);

	// C1: a group's creation whose request never reached the API, then the app closed: the API lists no group, and the
	// core still holds the creation. It's dropped and made again, and no open claims key packages for a creation that
	// can't go.
	test(
		"a group's creation cut before its answer is made again after a restart",
		async () => {
			const { fake, requests } = setUp();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const [a, b] = [await firstDevice(fake, ana), await firstDevice(fake, bo)];
			fake.cutRequest({ method: "POST", path: commits(conversation) });
			await a.engine.openConversation(conversation);
			const claims = () => requests.filter((request) => request.endsWith("/key-packages/claim")).length;
			const before = claims();

			// Started again, and opened twice, as its view would: the group is made once more, and only for that is
			// anything claimed, one key package of each member's.
			const again = await restarted(fake, a);
			await again.engine.openConversation(conversation);
			await again.engine.openConversation(conversation);
			const listed = (await again.api.conversations()).find((conv) => conv.id === conversation);
			expect({ generation: listed?.mls?.generation ?? null, claimed: claims() - before }).toEqual({
				generation: 0,
				claimed: 2,
			});
			await sameGroup([again, b], conversation);
			expect(again.engine.conversationState(conversation)).toBeNull();
		},
		SLOW,
	);

	// M6: what the person opens before the device is ready (here a first device, before its identity) happens once
	// it is.
	test(
		"a conversation opened before the device is ready gets its group once it is",
		async () => {
			const { fake } = setUp();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const b = await firstDevice(fake, bo);
			const a = testDevice(fake, ana);
			await a.engine.start();
			await a.engine.openConversation(conversation);
			await a.engine.makeIdentity();
			await a.engine.keySaved();
			expect(a.engine.state).toEqual({ name: "ready" });
			const listed = (await a.api.conversations()).find((conv) => conv.id === conversation);
			expect(listed?.mls).toMatchObject({ generation: 0 });
			await sameGroup([a, b], conversation);
		},
		SLOW,
	);
	// The review of task 16, I4: a member removed and added back has a new membership, after the rows of their absence,
	// which this device doesn't hold. Those give way to the notice, and the pages go on to what the device holds from
	// before (Ruling 15 hides rows; it doesn't end the list): they end only where it holds nothing older.
	test(
		"a member removed and added back pages on to the history the device holds",
		async () => {
			const { cy, a, b, c, conversation } = await groupOfThree();
			const mine = await c.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "mine",
			});
			if (!mine?.seq) throw new Error("Cy's message wasn't sent");
			const { key_packages } = await a.api.claimKeyPackages(cy);
			await a.engine.stop();
			await a.host.open(a.user);
			await removeByHand(a, conversation, cy);
			await until(async () => (await groupOf(c, conversation)) === null);
			const away = await b.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "away",
			});
			if (!away?.seq) throw new Error("Bo's message wasn't sent");
			await addByHand(a, conversation, cy, key_packages);
			await until(async () => (await groupOf(c, conversation)) !== null);
			const joined = (await c.api.conversations())
				.find((conv) => conv.id === conversation)!
				.members.find((member) => member.user_id === cy)!.id;
			expect(away.id < joined).toBe(true);
			// The row of Cy's absence isn't on Cy's device, and Cy's own message from before is: the pages go on to it.
			expect(await c.engine.messages(conversation, [away.id])).toEqual([]);
			expect(await c.engine.heldBefore(conversation, away.seq)).toBe(true);
			// Nothing older than it: there they end.
			expect(await c.engine.heldBefore(conversation, mine.seq)).toBe(false);
		},
		SLOW,
	);
});
