import { describe, expect, test } from "bun:test";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import { firstDevice, groupOf, memoryStore, refusingStore, sameGroup, until, useFake } from "../testing/engines";
import { LEGACY_RECORDS } from "./legacy";

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

	// #574: what the person made here is let go once this device holds its group; a record from before the cutover
	// stays, whatever the API says of the conversation after (its `legacy`), as the Android app holds it.
	test(
		"a record from before the cutover stays once its group is held, though the API lists it as from after",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo], legacy: true });
			const a = await firstDevice(fake, ana);
			const b = await firstDevice(fake, bo);
			// From now on the API lists the DM as made after the cutover.
			fake.conversationsAs = (view) => ({ ...view, legacy: false });
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			await a.engine.openConversation(conversation);
			expect(a.store.read<unknown>("legacy_records")).toEqual({ [conversation]: { members: [ana, bo] } });
		},
		SLOW,
	);

	test(
		"the person's picks found the conversation they made, and go once this device holds its group",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const a = await firstDevice(fake, ana);
			const b = await firstDevice(fake, bo);
			const { id } = await a.engine.createConversation({ type: 1, user_id: bo });
			await sameGroup([a, b], id);
			expect(a.store.read<Record<string, unknown>>("legacy_records")?.[id]).toBeUndefined();
		},
		SLOW,
	);

	// M4: a record whose storage refuses it (full, or refused) can't keep it: the session holds it all the same, so a
	// later look at the conversation doesn't take the members of that moment for the ones first seen.
	test(
		"a record the storage can't keep holds for the session",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, cy, dee] = [fake.addUser(), fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({
				...{ type: "group", members: [ana, bo, cy], owner: ana },
				legacy: true,
			});
			// Cy's device sees the conversation first, with its three members, on a record that can't keep it.
			const c = await firstDevice(fake, cy, { store: refusingStore(memoryStore(), LEGACY_RECORDS) });
			expect(c.store.read<unknown>(LEGACY_RECORDS)).toBeNull();

			// A member the record doesn't have shows up, and Ana makes the group with the members of today: Cy's device
			// refuses its welcome, as it would with its record kept.
			fake.addMembers(conversation, [dee]);
			const a = await firstDevice(fake, ana);
			await a.engine.openConversation(conversation);
			await until(() => c.engine.conversationState(conversation)?.name === "members_changed", 15_000);
			expect(await groupOf(c, conversation)).toBeNull();
		},
		SLOW,
	);

	// M6: the person's yes where no group was made yet (theirs was refused for its members) makes it, with the members
	// of today.
	test(
		"the person's yes makes the group of a conversation that has none",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, cy, dee] = [fake.addUser(), fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({
				...{ type: "group", members: [ana, bo, cy], owner: ana },
				legacy: true,
			});
			// Cy's device keeps the three members as its record, and a fourth joins before anyone makes the group.
			const c = await firstDevice(fake, cy);
			fake.addMembers(conversation, [dee]);
			const b = await firstDevice(fake, bo);
			// Cy opens it first: the group would have a member her record doesn't, so she's asked before it's made.
			await c.engine.openConversation(conversation);
			expect(c.engine.conversationState(conversation)).toEqual({ name: "members_changed" });
			expect(await groupOf(c, conversation)).toBeNull();

			// Her yes makes it with the members of today, and Bo's device comes in.
			await c.engine.acceptMembers(conversation);
			const listed = (await c.api.conversations()).find((conv) => conv.id === conversation);
			expect(listed?.mls).toMatchObject({ generation: 0 });
			await sameGroup([c, b], conversation);
			expect(c.engine.conversationState(conversation)).toBeNull();
		},
		SLOW,
	);
});
