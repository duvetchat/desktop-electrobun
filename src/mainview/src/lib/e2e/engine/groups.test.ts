import { describe, expect, test } from "bun:test";
import { base64Bytes } from "$lib/activity-thumbnail";
import { bytesBase64 } from "$lib/staged-images";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import { firstDevice, groupOf, restarted, sameGroup, until, useFake } from "../testing/engines";

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
			const { fake } = setUp();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			let [a, b, c] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, cy)];
			await a.engine.openConversation(conversation);
			const before = await sameGroup([a, b, c], conversation);

			// A commit no device can process gets in, as a server that takes anything would let it: Ana's leaf renewal,
			// one byte of its signature changed, sent under Bo's session. Ana's own renewal never went.
			await a.engine.stop();
			await a.host.open(ana);
			const made = await a.host.handle<{ commit: string; group_info: string }>({
				cmd: "refresh",
				conversation_id: conversation,
			});
			const bytes = base64Bytes(made.commit);
			bytes[bytes.length - 1]! ^= 0xff;
			const { generation, epoch } = before;
			await b.api.commit(conversation, { generation, epoch, commit: bytesBase64(bytes), group_info: made.group_info });
			await a.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: false, invalid: true });
			a = await restarted(fake, a);

			// Every device finds the group blocked: its owner is offered the restart, the others wait for her.
			await until(() => [a, b, c].every((d) => d.engine.conversationState(conversation)?.name === "blocked"));
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
});
