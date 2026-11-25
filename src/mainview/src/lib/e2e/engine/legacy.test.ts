import { describe, expect, test } from "bun:test";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import { firstDevice, groupOf, sameGroup, until, useFake } from "../testing/engines";

// A conversation from before the cutover (PLAN-E2E-CLIENTES.md, «Entrar a un grupo», its record; Ruling 14): its members
// as this device first saw them, which its group must have, until the person says the members of today are fine.
const SLOW = 180_000;

describe.skipIf(!coreLibrary)("a conversation from before the cutover", () => {
	test(
		"a legacy group is held to its record; the person's yes drops the record and joins by external commit",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, cy, dee] = [fake.addUser(), fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({
				...{ type: "group", members: [ana, bo, cy], owner: ana },
				legacy: true,
			});
			// Cy's device sees the conversation first, with its three members: that's its record.
			const c = await firstDevice(fake, cy);
			expect(c.store.read<unknown>("legacy_records")).toEqual({
				[conversation]: { owner: ana, members: [ana, bo, cy] },
			});

			// Then a member the record doesn't have shows up, and Ana makes the group with the members of today.
			fake.addMembers(conversation, [dee]);
			const a = await firstDevice(fake, ana);
			await a.engine.openConversation(conversation);
			const made = (await groupOf(a, conversation))!;
			expect(made.epoch).toBe(1);

			// Cy's device refuses its welcome: the group isn't the one it knew. It says so, and offers to go on.
			await until(() => c.engine.conversationState(conversation)?.name === "members_changed");
			expect(await groupOf(c, conversation)).toBeNull();

			// Cy says yes: the record goes, and the device joins by an external commit, with no record to hold it to.
			await c.engine.acceptMembers(conversation);
			await sameGroup([a, c], conversation);
			expect(c.engine.conversationState(conversation)).toBeNull();
			expect(c.store.read<unknown>("legacy_records")).toEqual({ [conversation]: false });
			const entries = (await c.api.queue(conversation, 2)).entries;
			expect(entries).toMatchObject([{ kind: "commit", sender_user: cy }]);
		},
		SLOW,
	);
});
