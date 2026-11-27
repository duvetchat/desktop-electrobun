import { describe, expect, test } from "bun:test";
import { base64Bytes } from "$lib/activity-thumbnail";
import { bytesBase64 } from "$lib/staged-images";
import type { MlsEntry } from "$lib/types";
import { CoreError } from "../errors";
import type { CoreHost } from "../host";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	answeringHost,
	approvedDevice,
	commitByHand,
	firstDevice,
	groupOf,
	madeHere,
	rejection,
	restarted,
	sameGroup,
	sayYes,
	testHost,
	turnEnded,
	until,
	useFake,
	type TestDevice,
} from "../testing/engines";
import { drawnIn, type Drawn } from "./members";

// Who is in a conversation (PLAN-E2E-CLIENTES.md, Task 22; «Qué se manda», its members' rows): a new conversation's
// group made at once, the owner's additions and removals, one user and one commit a request, a member's leave and the
// commit that takes them out, the cap of 20; and a blocked group's restart, which names whom it leaves out, and a
// restart the device's core never took, which waits for the person's yes (#46).
const SLOW = 180_000;
const CONVERSATIONS = "/api/users/@me/conversations";
const commitsOf = (conversation: string) => `${CONVERSATIONS}/${conversation}/mls/commits`;

/** The fake, its requests (method and path) and their bodies. */
function setUp() {
	const fake = new FakeApi();
	const requests: string[] = [];
	const bodies: Promise<string>[] = [];
	useFake(fake, (request) => {
		requests.push(`${request.method} ${new URL(request.url).pathname}`);
		bodies.push(request.text());
	});
	return { fake, requests, bodies };
}

/** The body of each request the fake took that `match` names, in order. */
async function bodiesOf(requests: string[], bodies: Promise<string>[], match: string): Promise<string[]> {
	const taken: string[] = [];
	for (const [n, request] of requests.entries()) if (request === match) taken.push(await bodies[n]!);
	return taken;
}

/**
 * Ana's group with Bo and Cy, a device each (Cy's core behind `cyHost` when given), its group made by Ana's device and
 * joined by the others' welcomes.
 */
async function groupOfThree(cyHost?: (host: CoreHost) => CoreHost) {
	const setup = setUp();
	const { fake } = setup;
	const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
	const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
	const a = await firstDevice(fake, ana);
	const b = await firstDevice(fake, bo);
	const c = await firstDevice(fake, cy, cyHost ? { host: cyHost(testHost()) } : {});
	await madeHere(a, conversation);
	await a.engine.openConversation(conversation);
	const made = await sameGroup([a, b, c], conversation);
	return { ...setup, ana, bo, cy, a, b, c, conversation, made };
}

/**
 * The same group, blocked by a commit no device can process, as a server that takes anything would let it in: Ana's
 * leaf renewal, one byte of its signature changed, sent under Bo's session. Every device says so, Ana's started again.
 */
async function blockedGroup(cyHost?: (host: CoreHost) => CoreHost) {
	const group = await groupOfThree(cyHost);
	const { fake, b, c, conversation } = group;
	const a = await block(fake, group.a, b, conversation);
	await until(() => [a, b, c].every((d) => d.engine.conversationState(conversation)?.name === "blocked"));
	return { ...group, a };
}

/**
 * The group of `a`, in whatever generation, blocked as blockedGroup's is: `a`'s leaf renewal, one byte of its
 * signature changed, sent under `b`'s session. `a`'s device again, started anew.
 */
async function block(fake: FakeApi, a: TestDevice, b: TestDevice, conversation: string): Promise<TestDevice> {
	await a.engine.stop();
	await a.host.open(a.user);
	const { generation, epoch } = (await groupOf(a, conversation))!;
	const refresh = await a.host.handle<{ commit: string; group_info: string }>({
		cmd: "refresh",
		conversation_id: conversation,
	});
	const bytes = base64Bytes(refresh.commit);
	bytes[bytes.length - 1]! ^= 0xff;
	await b.api.commit(conversation, { generation, epoch, commit: bytesBase64(bytes), group_info: refresh.group_info });
	await a.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: false, invalid: true });
	return restarted(fake, a);
}

/**
 * `a` restarts the blocked group without those the server drops from it without a word, the person confirming them,
 * while every other device misses it: the restart's events go without their data, and the queue they'd be read from
 * is gone by the time the events go out.
 */
async function missedRestart(fake: FakeApi, a: TestDevice, conversation: string, dropped: string[]) {
	fake.stripData = true;
	fake.holdEvents();
	fake.dropMembers(conversation, dropped);
	expect(await a.engine.restartGroup(conversation)).toEqual(dropped);
	expect(await a.engine.restartGroup(conversation, dropped)).toEqual([]);
	const listed = (await a.api.conversations()).find((conv) => conv.id === conversation);
	fake.expireQueue(conversation, listed!.mls!.last_seq + 1);
	fake.stripData = false;
	fake.releaseEvents();
}

/** Users with a first device each, friends of `owner`'s, who may add them. */
async function friendsOf(fake: FakeApi, owner: string, count: number): Promise<TestDevice[]> {
	const devices: TestDevice[] = [];
	for (let n = 0; n < count; n++) {
		const user = fake.addUser();
		fake.befriend(owner, user);
		devices.push(await firstDevice(fake, user));
	}
	return devices;
}

/**
 * A host whose core is said to refuse the welcomes of `generation`, as one its group can't let found (a non-owner's
 * reset): an honest core can't be made to with the same members, so each such welcome's bytes are spoiled for the real
 * core, which stays out, and its result is said as that refusal.
 */
function refusingWelcomes(host: CoreHost, generation: number): CoreHost {
	return answeringHost(host, (command) => {
		if (command.cmd !== "apply") return undefined;
		const spoiled = new Set<number>();
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine's own apply command
		const entries = (command.entries as MlsEntry[]).map((entry) => {
			if (entry.kind !== "welcome" || entry.generation !== generation || entry.data === null) return entry;
			spoiled.add(entry.seq);
			return { ...entry, data: bytesBase64(base64Bytes(entry.data).map((byte) => byte ^ 0xff)) };
		});
		return host.handle<{ results: { seq: number }[] }>({ ...command, cmd: "apply", entries }).then((applied) => ({
			...applied,
			results: applied.results.map((result) =>
				spoiled.has(result.seq) ? { ...result, result: "rejected", rule: "members_changed_by_non_owner" } : result,
			),
		}));
	});
}

/** A host that runs what `before` gives, when it gives anything, before each `cmd` it's asked. */
function hooked(host: CoreHost, cmd: string, before: () => (() => Promise<void>) | null): CoreHost {
	return new Proxy(host, {
		get(target, name) {
			if (name === "handle") {
				return async (command: { cmd: string } & Record<string, unknown>) => {
					if (command.cmd === cmd) await before()?.();
					return target.handle(command);
				};
			}
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/** The users a group's leaves are of, each once, in order. */
const usersOf = (held: { devices: { user_id: string }[] }) => [...new Set(held.devices.map((d) => d.user_id))].sort();

/** The device's commit takes the group's epoch, made by hand on its core with its engine stopped: the device again. */
async function epochTaken(fake: FakeApi, device: TestDevice, conversation: string): Promise<TestDevice> {
	await device.engine.stop();
	await device.host.open(device.user);
	await commitByHand(device, conversation);
	return restarted(fake, device);
}

/** The API's members of the conversation, as the device's session lists them. */
const membersOf = async (device: TestDevice, conversation: string) =>
	(await device.api.conversations()).find((conv) => conv.id === conversation)?.members.map((m) => m.user_id) ?? [];

// R-M1: a drawing the record kept, read back: as it was, or nothing a page could have drawn.
test("a kept drawing is read as a drawing, or not at all", () => {
	const drawn: Drawn = { type: 2, owner_id: "ana", members: [{ user_id: "ana" }, { user_id: "bo" }] };
	expect(drawnIn(drawn)).toEqual(drawn);
	expect(drawnIn({ ...drawn, members: [{ user_id: "ana", extra: 1 }] })).toEqual({
		...drawn,
		members: [{ user_id: "ana" }],
	});
	expect(drawnIn(null)).toBeNull();
	for (const odd of [undefined, "group", { ...drawn, type: 3 }, { ...drawn, owner_id: 1 }, { ...drawn, members: {} }]) {
		expect(drawnIn(odd)).toBeUndefined();
	}
	expect(drawnIn({ ...drawn, members: [{ user_id: 2 }] })).toBeUndefined();
	expect(drawnIn({ ...drawn, members: [null] })).toBeUndefined();
});

describe.skipIf(!coreLibrary)("who is in a conversation", () => {
	test(
		"making a DM makes its group at once",
		async () => {
			const { fake, requests } = setUp();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const [a, b, c] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, cy)];
			// Ana starts a DM with Bo: by the time it's made, so is its group, though nobody opened it.
			const dm = await a.engine.createConversation({ type: 1, user_id: bo });
			expect((await a.api.conversations()).find((conv) => conv.id === dm.id)?.mls).toMatchObject({ generation: 0 });
			expect(requests).toContain(`POST ${commitsOf(dm.id)}`);
			await sameGroup([a, b], dm.id);
			// A group too, its owner's: the members come in by its welcome.
			const group = await a.engine.createConversation({ type: 2, name: "trio", user_ids: [bo, cy] });
			expect((await a.api.conversations()).find((conv) => conv.id === group.id)?.mls).toMatchObject({ generation: 0 });
			const held = await sameGroup([a, b, c], group.id);
			expect(usersOf(held)).toEqual([ana, bo, cy].sort());
		},
		SLOW,
	);

	test(
		"the owner adds a member with one commit, and their devices join by its welcome",
		async () => {
			const { fake, requests } = setUp();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			const [a, b] = [await firstDevice(fake, ana), await firstDevice(fake, bo)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			const [d] = await friendsOf(fake, ana, 1);
			const before = requests.length;
			const member = await a.engine.addMember(conversation, d!.user);
			expect(member).toMatchObject({ conversation_id: conversation, user_id: d!.user });
			// One request, with its one commit, and only the new member's key packages claimed for it.
			const sent = requests.slice(before);
			expect(sent.filter((request) => request.startsWith(`POST ${CONVERSATIONS}/${conversation}/`))).toEqual([
				`POST ${CONVERSATIONS}/${conversation}/members`,
			]);
			expect(sent.filter((request) => request.endsWith("/key-packages/claim"))).toEqual([
				`POST /api/users/${d!.user}/key-packages/claim`,
			]);
			// Dee's device comes in by its welcome, not by an external commit of its own.
			const held = await sameGroup([a, b, d!], conversation);
			expect(usersOf(held)).toEqual([ana, bo, d!.user].sort());
			const commits = (await a.api.queue(conversation, 0)).entries.filter((entry) => entry.kind === "commit");
			expect(commits.map((entry) => entry.sender_user)).toEqual([ana, ana]);
		},
		SLOW,
	);

	// Review Focus 4: five additions asked at once are five commits, one after another, each on the epoch the one before
	// made, and every device ends in one epoch.
	test(
		"five members are five commits, in turn",
		async () => {
			const { fake } = setUp();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			const [a, b] = [await firstDevice(fake, ana), await firstDevice(fake, bo)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			const five = await friendsOf(fake, ana, 5);
			await Promise.all(five.map((device) => a.engine.addMember(conversation, device.user)));
			const commits = (await a.api.queue(conversation, 0)).entries.filter((entry) => entry.kind === "commit");
			// The creation's, then one for each addition, on epochs 1 to 5 in turn.
			expect(commits.map((entry) => [entry.sender_user, entry.epoch])).toEqual(
				[0, 1, 2, 3, 4, 5].map((epoch) => [ana, epoch]),
			);
			const held = await sameGroup([a, b, ...five], conversation);
			expect(held.epoch).toBe(6);
			expect(usersOf(held)).toEqual([ana, bo, ...five.map((device) => device.user)].sort());
		},
		SLOW,
	);

	test(
		"the 21st member is refused before a key package is asked for",
		async () => {
			const { fake, requests } = setUp();
			const ana = fake.addUser();
			const others = Array.from({ length: 19 }, () => fake.addUser());
			const conversation = fake.addConversation({ type: "group", members: [ana, ...others], owner: ana });
			const a = await firstDevice(fake, ana);
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			const extra = fake.addUser();
			fake.befriend(ana, extra);
			const before = requests.length;
			expect(await rejection(a.engine.addMember(conversation, extra))).toMatchObject({ code: "too_many_members" });
			// Nor is a new group past 20, its owner among them.
			const creating = a.engine.createConversation({ type: 2, name: "too many", user_ids: [...others, extra] });
			expect(await rejection(creating)).toMatchObject({ code: "too_many_members" });
			const asked = requests.slice(before);
			expect(asked.filter((request) => /key-packages\/claim|\/members$|conversations$/.test(request))).toEqual([
				`GET ${CONVERSATIONS}`,
			]);
		},
		SLOW,
	);

	test(
		"removing a member takes their devices out",
		async () => {
			const { requests, ana, bo, cy, a, b, c, conversation } = await groupOfThree();
			await a.engine.removeMember(conversation, cy);
			expect(requests).toContain(`DELETE ${CONVERSATIONS}/${conversation}/members/${cy}`);
			const held = await sameGroup([a, b], conversation);
			expect(usersOf(held)).toEqual([ana, bo].sort());
			// Cy's device was taken out with him, and lets the group go; the API no longer lists him.
			await until(async () => (await groupOf(c, conversation)) === null);
			const listed = (await a.api.conversations()).find((conv) => conv.id === conversation);
			expect(listed?.members.map((member) => member.user_id)).toEqual([ana, bo]);
		},
		SLOW,
	);

	test(
		"leaving sends a signed statement, and the next member's commit takes the leaver out",
		async () => {
			const { requests, bodies, ana, bo, cy, a, b, c, conversation } = await groupOfThree();
			await c.engine.leaveConversation(conversation);
			const [left] = await bodiesOf(requests, bodies, `DELETE ${CONVERSATIONS}/${conversation}/members/@me`);
			const { statement } = JSON.parse(left!);
			expect(statement).toEqual(expect.any(String));
			// The API proposed the removal of his leaf, with his statement: a member's commit, after its random wait,
			// makes it, and it takes one commit.
			await until(async () => {
				for (const device of [a, b]) device.clock.advance(5_000);
				const held = await groupOf(a, conversation);
				return !!held && !usersOf(held).includes(cy);
			});
			const held = await sameGroup([a, b], conversation);
			expect(usersOf(held)).toEqual([ana, bo].sort());
			const entries = (await a.api.queue(conversation, 0)).entries;
			const proposal = entries.findIndex((entry) => entry.kind === "proposal");
			expect(entries[proposal]).toMatchObject({ statement });
			expect(entries.slice(proposal).filter((entry) => entry.kind === "commit")).toHaveLength(1);
			// His device let the conversation go.
			expect(c.engine.conversationState(conversation)).toBeNull();
		},
		SLOW,
	);

	// Step 3's closing review (M6): a leave whose answer was lost, sent again, is a 403, as its user isn't a member any
	// more: the list says so, and that's the leave.
	test(
		"a leave sent again after its answer was lost is the leave",
		async () => {
			const { fake, requests, a, b, c, conversation } = await groupOfThree();
			const path = `${CONVERSATIONS}/${conversation}/members/@me`;
			fake.loseAnswer({ method: "DELETE", path });
			expect(await rejection(c.engine.leaveConversation(conversation))).toBeInstanceOf(TypeError);
			// Asked again, the API's list has him out already: that was the leave, and nothing is sent again.
			await c.engine.leaveConversation(conversation);
			expect((await c.api.conversations()).some((conv) => conv.id === conversation)).toBe(false);
			expect(requests.filter((request) => request === `DELETE ${path}`)).toHaveLength(1);
			await sameGroup([a, b], conversation);
		},
		SLOW,
	);

	// The same rule where the list still has the user as their leave goes: another device of theirs left at once, and
	// the API's 404 (its second leave found no membership: task 22's review, M2) is this device's leave too, which the
	// list then confirms.
	test(
		"a leave the API refuses as its user is out already, from another of their devices, is the leave",
		async () => {
			const { fake, requests, a, b, c, conversation } = await groupOfThree();
			const c2 = await approvedDevice(fake, c);
			await sameGroup([a, b, c, c2], conversation);
			const path = `${CONVERSATIONS}/${conversation}/members/@me`;
			fake.gather({ method: "DELETE", path }, 2);
			await Promise.all([c.engine.leaveConversation(conversation), c2.engine.leaveConversation(conversation)]);
			expect(requests.filter((request) => request === `DELETE ${path}`)).toHaveLength(2);
			expect((await a.api.conversations()).find((conv) => conv.id === conversation)?.members).toHaveLength(2);
		},
		SLOW,
	);

	// Task 23's review, M6 (both apps): the API takes a leave only from a device in the group, with its statement. One
	// that holds no group here (before its join, or waiting to be let back in) says so, and asks the API nothing.
	test(
		"leaving from a device that holds no group says so, and sends nothing",
		async () => {
			const { fake, requests } = setUp();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			const a = await firstDevice(fake, ana);
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			// Bo's first device comes after the group was made, and its external commit is refused each time.
			const refused = new CoreError("rule_violation", "the group info doesn't verify", { rule: "invalid_group_info" });
			const host = answeringHost(testHost(), (command) =>
				command.cmd === "join_external" ? Promise.reject(refused) : undefined,
			);
			const b = await firstDevice(fake, bo, { host });
			await until(() => b.engine.conversationState(conversation)?.name === "wait_rejoin");
			expect(await rejection(b.engine.leaveConversation(conversation))).toMatchObject({ code: "not_in_group" });
			expect(requests.filter((request) => request.endsWith(`/${conversation}/members/@me`))).toEqual([]);
			expect(await membersOf(a, conversation)).toEqual([ana, bo, cy]);
		},
		SLOW,
	);

	// Review Focus 3: an addition whose answer is lost goes again with its bytes, which the API answers as it did.
	test(
		"an addition whose answer is lost is sent again with its bytes, and the user is added once",
		async () => {
			const { fake, requests, bodies } = setUp();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			const [a, b] = [await firstDevice(fake, ana), await firstDevice(fake, bo)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			const [d] = await friendsOf(fake, ana, 1);
			const members = `POST ${CONVERSATIONS}/${conversation}/members`;
			fake.loseAnswer({ method: "POST", path: `${CONVERSATIONS}/${conversation}/members` });
			expect(await rejection(a.engine.addMember(conversation, d!.user))).toMatchObject({ code: "unanswered" });
			await until(() => (a.clock.advance(2_000), requests.filter((request) => request === members).length >= 2));
			const sent = await bodiesOf(requests, bodies, members);
			expect(new Set(sent).size).toBe(1);
			await sameGroup([a, b, d!], conversation);
			const listed = (await a.api.conversations()).find((conv) => conv.id === conversation);
			expect(listed?.members.map((member) => member.user_id)).toEqual([ana, bo, d!.user]);
		},
		SLOW,
	);

	// Task 22's review, I1: an addition that got no answer goes again with its bytes; when another commit took its epoch
	// meanwhile, the API answers 409, and the addition is made again on top of it, as a tap's is.
	test(
		"an addition whose resend loses its epoch is made again",
		async () => {
			const { fake, requests } = setUp();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			const a = await firstDevice(fake, ana);
			let b = await firstDevice(fake, bo);
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			const [d] = await friendsOf(fake, ana, 1);
			const members = `${CONVERSATIONS}/${conversation}/members`;
			// The pause answers the addition: no answer came yet, and its bytes wait to go again.
			fake.refuse({ method: "POST", path: members }, 503);
			expect(await rejection(a.engine.addMember(conversation, d!.user))).toMatchObject({ code: "unanswered" });
			// Bo's device takes the epoch meanwhile: the resend's 409 makes it again, on his commit.
			b = await epochTaken(fake, b, conversation);
			await until(async () => {
				a.clock.advance(2_000);
				return (await membersOf(a, conversation)).includes(d!.user);
			}, 20_000);
			expect(requests.filter((request) => request === `POST ${members}`)).toHaveLength(3);
			const held = await sameGroup([a, b, d!], conversation);
			expect(usersOf(held)).toEqual([ana, bo, d!.user].sort());
		},
		SLOW,
	);

	// Task 22's review, M4 (b), Review Focus 4: another commit takes the epoch an addition was made on before it goes up,
	// and the API answers 409. The addition is made again on the epoch that commit made, and goes.
	test(
		"an addition another commit beats to its epoch is made again on top of it",
		async () => {
			const { fake, requests } = setUp();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			let before: (() => Promise<void>) | null = null;
			const a = await firstDevice(fake, ana, { host: hooked(testHost(), "add_members", () => before) });
			let b = await firstDevice(fake, bo);
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			const [d] = await friendsOf(fake, ana, 1);
			await b.engine.stop();
			await b.host.open(bo);
			// Bo's renewal lands as Ana's core makes the addition, on the epoch both hold.
			before = async () => {
				before = null;
				await commitByHand(b, conversation);
			};
			const member = await a.engine.addMember(conversation, d!.user);
			expect(member).toMatchObject({ conversation_id: conversation, user_id: d!.user });
			expect(requests.filter((request) => request === `POST ${CONVERSATIONS}/${conversation}/members`)).toHaveLength(2);
			b = await restarted(fake, b);
			const held = await sameGroup([a, b, d!], conversation);
			expect(usersOf(held)).toEqual([ana, bo, d!.user].sort());
		},
		SLOW,
	);

	// The same for a removal.
	test(
		"a removal another commit beats to its epoch is made again on top of it",
		async () => {
			const { fake, requests } = setUp();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			let before: (() => Promise<void>) | null = null;
			const a = await firstDevice(fake, ana, { host: hooked(testHost(), "remove_members", () => before) });
			let b = await firstDevice(fake, bo);
			const c = await firstDevice(fake, cy);
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b, c], conversation);
			await b.engine.stop();
			await b.host.open(bo);
			before = async () => {
				before = null;
				await commitByHand(b, conversation);
			};
			await a.engine.removeMember(conversation, cy);
			const path = `DELETE ${CONVERSATIONS}/${conversation}/members/${cy}`;
			expect(requests.filter((request) => request === path)).toHaveLength(2);
			b = await restarted(fake, b);
			const held = await sameGroup([a, b], conversation);
			expect(usersOf(held)).toEqual([ana, bo].sort());
			expect(await membersOf(a, conversation)).toEqual([ana, bo]);
		},
		SLOW,
	);

	// Task 22's review, M1: the person taps the same friend again after «No answer came yet». The first addition goes
	// again first, and lands: the list read again has them, and nothing more is made, nor any key package claimed.
	test(
		"adding the same user again while the first addition waits for its answer adds them once",
		async () => {
			const { fake, requests } = setUp();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			const [a, b] = [await firstDevice(fake, ana), await firstDevice(fake, bo)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			const [d] = await friendsOf(fake, ana, 1);
			fake.refuse({ method: "POST", path: `${CONVERSATIONS}/${conversation}/members` }, 503);
			expect(await rejection(a.engine.addMember(conversation, d!.user))).toMatchObject({ code: "unanswered" });
			const member = await a.engine.addMember(conversation, d!.user);
			expect(member).toMatchObject({ conversation_id: conversation, user_id: d!.user });
			expect(requests.filter((request) => request === `POST /api/users/${d!.user}/key-packages/claim`)).toHaveLength(1);
			await sameGroup([a, b, d!], conversation);
		},
		SLOW,
	);

	// The same for a removal: the second tap finds them out, and takes nothing more out of the core's group.
	test(
		"removing the same member again while the first removal waits for its answer removes them once",
		async () => {
			const { fake, requests, ana, bo, cy, a, b, conversation } = await groupOfThree();
			const path = `${CONVERSATIONS}/${conversation}/members/${cy}`;
			fake.refuse({ method: "DELETE", path }, 503);
			expect(await rejection(a.engine.removeMember(conversation, cy))).toMatchObject({ code: "unanswered" });
			await a.engine.removeMember(conversation, cy);
			expect(requests.filter((request) => request === `DELETE ${path}`)).toHaveLength(2);
			expect(await membersOf(a, conversation)).toEqual([ana, bo]);
			const held = await sameGroup([a, b], conversation);
			expect(usersOf(held)).toEqual([ana, bo].sort());
		},
		SLOW,
	);

	// The same for a removal: the member ends up out, with every device of theirs.
	test(
		"a removal whose resend loses its epoch is made again",
		async () => {
			const group = await groupOfThree();
			const { fake, requests, ana, bo, cy, a, c, conversation } = group;
			const path = `${CONVERSATIONS}/${conversation}/members/${cy}`;
			fake.refuse({ method: "DELETE", path }, 503);
			expect(await rejection(a.engine.removeMember(conversation, cy))).toMatchObject({ code: "unanswered" });
			const b = await epochTaken(fake, group.b, conversation);
			await until(async () => {
				a.clock.advance(2_000);
				return !(await membersOf(a, conversation)).includes(cy);
			}, 20_000);
			expect(requests.filter((request) => request === `DELETE ${path}`)).toHaveLength(3);
			const held = await sameGroup([a, b], conversation);
			expect(usersOf(held)).toEqual([ana, bo].sort());
			await until(async () => (await groupOf(c, conversation)) === null);
		},
		SLOW,
	);

	// #46's client rule: before a restart, the core's members and the API's are compared, and the person confirms whom
	// the restart leaves out.
	test(
		"a restart names whom it leaves out, and goes only once the person confirms them",
		async () => {
			const { requests, ana, bo, cy, a, b, c, conversation } = await blockedGroup();
			// Cy leaves the blocked group: the API takes him off at once, and no commit can take his leaf out.
			await c.engine.leaveConversation(conversation);
			const commits = () => requests.filter((request) => request === `POST ${commitsOf(conversation)}`).length;
			const before = commits();
			expect(await a.engine.restartGroup(conversation)).toEqual([cy]);
			expect(commits()).toBe(before);
			// Confirmed, it restarts with the members the API has.
			expect(await a.engine.restartGroup(conversation, [cy])).toEqual([]);
			const held = await sameGroup([a, b], conversation);
			expect(held).toMatchObject({ generation: 1, blocked: false });
			expect(usersOf(held)).toEqual([ana, bo].sort());
		},
		SLOW,
	);

	// Task 22's review, M8: a successor's restart the core refuses (the owner left the blocked group, and nothing the
	// successor's device holds lets her go) is said once, and Restart is off until a new entry comes, so no member's key
	// packages are claimed for tries that can only be refused.
	test(
		"a restart the core refuses is offered again only once a new entry comes",
		async () => {
			const { fake, requests, ana, bo, a, b, c, conversation } = await blockedGroup();
			fake.hideStatements(bo);
			await a.engine.leaveConversation(conversation);
			const mine = () => {
				const said = b.engine.conversationState(conversation);
				return said?.name === "blocked" && said.restart === "mine";
			};
			await until(mine);
			expect(await b.engine.restartGroup(conversation)).toEqual([ana]);
			const claims = () => requests.filter((request) => request.endsWith("/key-packages/claim")).length;
			const before = claims();
			expect(await rejection(b.engine.restartGroup(conversation, [ana]))).toMatchObject({ code: "rule_violation" });
			expect(claims()).toBeGreaterThan(before);
			expect(b.engine.conversationState(conversation)).toEqual({ name: "blocked", restart: "none", owner: bo });
			const tried = claims();
			expect(await b.engine.restartGroup(conversation, [ana])).toEqual([]);
			expect(claims()).toBe(tried);
			// A new entry: Cy leaves too, and Restart is Bo's to try again.
			await c.engine.leaveConversation(conversation);
			await until(mine);
		},
		SLOW,
	);

	// #550 (step 5's engines review, Minor 4): a restart the API's validator refuses (422) is said as one the core
	// refuses, and Restart is off until a new entry comes, as on Android: no tap claims every member's key packages again
	// for a refusal that wouldn't change.
	test(
		"a restart the API refuses says so, and isn't offered again before a new entry",
		async () => {
			const { fake, requests, ana, a, c, conversation } = await blockedGroup();
			const mine = () => {
				const said = a.engine.conversationState(conversation);
				return said?.name === "blocked" && said.restart === "mine";
			};
			expect(mine()).toBe(true);
			fake.refuse({ method: "POST", path: commitsOf(conversation) }, 422, { error: "commit refused" });
			const claims = () => requests.filter((request) => request.endsWith("/key-packages/claim")).length;
			const before = claims();
			expect(await rejection(a.engine.restartGroup(conversation))).toMatchObject({
				code: "rule_violation",
				rule: "restart_refused",
			});
			expect(claims()).toBeGreaterThan(before);
			expect(a.engine.conversationState(conversation)).toEqual({ name: "blocked", restart: "none", owner: ana });
			const tried = claims();
			expect(await a.engine.restartGroup(conversation)).toEqual([]);
			expect(claims()).toBe(tried);
			// A new entry: Cy leaves, and Restart is Ana's to try again.
			await c.engine.leaveConversation(conversation);
			await until(mine);
		},
		SLOW,
	);

	// #550 (step 5's engines review, Minor 6): the API hands a group on to its next owner as its owner leaves, and says so
	// with CONVERSATION_UPDATE: the engine lists the conversation again then, so what it says goes by the new owner at
	// once, a group's making and a blocked group's restart, not at the conversation's next turn.
	test(
		"an owner who leaves hands the group's making and its restart to the next owner at once",
		async () => {
			// A group no one made yet: its members wait for Ana, until she leaves and it's Bo's to make.
			const { fake } = setUp();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			const [a, b, c] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, cy)];
			for (const device of [b, c]) await device.engine.openConversation(conversation);
			expect(c.engine.conversationState(conversation)).toEqual({ name: "wait_owner", owner: ana });
			await a.engine.leaveConversation(conversation);
			await until(() => {
				const said = c.engine.conversationState(conversation);
				return said?.name === "wait_owner" && said.owner === bo;
			});
			expect(b.engine.conversationState(conversation)).toBeNull();
			await Promise.all([a, b, c].map((device) => device.engine.stop()));

			// A blocked group: Bo hears only that its owner is his now, and Restart is his.
			const blocked = await blockedGroup();
			blocked.fake.holdEvents();
			await blocked.a.engine.leaveConversation(blocked.conversation);
			blocked.fake.releaseEvents({ only: (event) => event.type === "CONVERSATION_UPDATE" });
			await until(() => {
				const said = blocked.b.engine.conversationState(blocked.conversation);
				return said?.name === "blocked" && said.restart === "mine";
			});
		},
		SLOW,
	);

	// #46's client rule: a restart's welcome the core refuses leaves the device out of the next generation, which it joins
	// only on its person's yes, never by an external commit of its own.
	test(
		"a restart's welcome the core refuses waits for the person's yes, never an external commit on its own",
		async () => {
			const { fake, requests, ana, cy, a, b, c, conversation } = await blockedGroup();
			// The server keeps leave statements from Cy. Ana, the owner, leaves the blocked group: the API names Bo the
			// owner, whose device holds her statement, so his restart may leave her out. Cy's holds none.
			fake.hideStatements(cy);
			await a.engine.leaveConversation(conversation);
			await until(() => {
				const said = b.engine.conversationState(conversation);
				return said?.name === "blocked" && said.restart === "mine";
			});
			expect(await b.engine.restartGroup(conversation)).toEqual([ana]);
			expect(await b.engine.restartGroup(conversation, [ana])).toEqual([]);
			// Cy's core refuses its welcome, as nothing it holds lets Ana go: his device says the members changed, and
			// stays out, minutes on.
			await until(() => c.engine.conversationState(conversation)?.name === "members_changed");
			for (let minute = 0; minute < 3; minute++) {
				c.clock.advance(60_000);
				await turnEnded(c);
			}
			expect(c.engine.conversationState(conversation)).toMatchObject({ name: "members_changed" });
			expect((await groupOf(c, conversation))?.generation).toBe(0);
			expect(requests.filter((request) => request.endsWith(`/${conversation}/mls/group-info`))).toEqual([]);
			// On his yes, it joins the new generation by an external commit.
			await sayYes(c, conversation);
			const held = await sameGroup([b, c], conversation);
			expect(held.generation).toBe(1);
			expect(c.engine.conversationState(conversation)).toBeNull();
		},
		SLOW,
	);

	// Task 22's review, M4 (a): the refused welcome's own mark, where the API's members are the core's, so nothing else
	// would ask: the device stays out of the new generation, asks the API nothing about it, and goes in on the yes.
	test(
		"a restart's welcome refused with the same members waits for the person's yes",
		async () => {
			const { requests, a, b, c, conversation } = await blockedGroup((host) => refusingWelcomes(host, 1));
			expect(await a.engine.restartGroup(conversation)).toEqual([]);
			await sameGroup([a, b], conversation);
			await until(() => c.engine.conversationState(conversation)?.name === "members_changed");
			for (let minute = 0; minute < 3; minute++) {
				c.clock.advance(60_000);
				await turnEnded(c);
			}
			expect(c.engine.conversationState(conversation)).toMatchObject({ name: "members_changed" });
			expect((await groupOf(c, conversation))?.generation).toBe(0);
			expect(requests.filter((request) => request.endsWith(`/${conversation}/mls/group-info`))).toEqual([]);
			await sayYes(c, conversation);
			expect((await sameGroup([a, b, c], conversation)).generation).toBe(1);
		},
		SLOW,
	);

	// Task 22's review, I3: that refusal is kept in the engine's record, so a restart of the app still asks, though the
	// core keeps nothing of it and a welcome read again is no longer refused.
	test(
		"a restart's welcome refused before the app restarted still waits for the person's yes",
		async () => {
			const { fake, requests, a, b, c, conversation } = await blockedGroup((host) => refusingWelcomes(host, 1));
			expect(await a.engine.restartGroup(conversation)).toEqual([]);
			await sameGroup([a, b], conversation);
			await until(() => c.engine.conversationState(conversation)?.name === "members_changed");
			const back = await restarted(fake, c);
			await until(() => back.engine.conversationState(conversation)?.name === "members_changed", 20_000);
			await turnEnded(back);
			expect((await groupOf(back, conversation))?.generation).toBe(0);
			expect(requests.filter((request) => request.endsWith(`/${conversation}/mls/group-info`))).toEqual([]);
			await sayYes(back, conversation);
			expect((await sameGroup([a, b, back], conversation)).generation).toBe(1);
		},
		SLOW,
	);

	// Task 23's review, item 11 (against the desktop): whether a newer generation's members are those the core holds is
	// asked of the API's list as it is now, not of the one this device last read.
	test(
		"a newer generation is held to the API's members as they are now, not as last listed",
		async () => {
			const { fake, ana, bo, cy, a, b, conversation } = await blockedGroup();
			// Bo's device last listed the conversation with Cy. The server drops Cy without a word, Ana restarts without
			// him, and the welcome and the queue it would be read from are kept from Bo's device.
			await missedRestart(fake, a, conversation, [cy]);
			await until(() => b.engine.conversationState(conversation)?.name === "members_changed", 20_000);
			expect((await groupOf(b, conversation))?.generation).toBe(0);
			await sayYes(b, conversation);
			const held = await sameGroup([a, b], conversation);
			expect(held.generation).toBe(1);
			expect(usersOf(held)).toEqual([ana, bo].sort());
		},
		SLOW,
	);

	// Task 22's review, M5: a yes holds for the generation it was given for. Bo's device said yes to generation 1 with
	// Ana and Bo; Dee joined it later, and its reset leaves her out. The members are those of the old yes again, but in
	// another generation, whose welcome Bo's device missed too: it asks again.
	test(
		"a yes to a generation's members holds for that generation only",
		async () => {
			const { fake, ana, cy, b, conversation, ...group } = await blockedGroup();
			let { a } = group;
			await missedRestart(fake, a, conversation, [cy]);
			await until(() => b.engine.conversationState(conversation)?.name === "members_changed", 20_000);
			await sayYes(b, conversation);
			expect((await sameGroup([a, b], conversation)).generation).toBe(1);
			// Dee joins generation 1 with no device yet, then it's blocked, and restarted without her.
			const dee = fake.addUser();
			fake.befriend(ana, dee);
			await a.engine.addMember(conversation, dee);
			await until(async () => !!(await groupOf(b, conversation))?.members.some((m) => m.user_id === dee));
			a = await block(fake, a, b, conversation);
			await until(() => [a, b].every((d) => d.engine.conversationState(conversation)?.name === "blocked"));
			await missedRestart(fake, a, conversation, [dee]);
			await until(() => b.engine.conversationState(conversation)?.name === "members_changed", 20_000);
			expect((await groupOf(b, conversation))?.generation).toBe(1);
			await sayYes(b, conversation);
			expect((await sameGroup([a, b], conversation)).generation).toBe(2);
		},
		SLOW,
	);

	// The same rule where no welcome came at all (its queue gone by the time the device is back): a newer generation whose
	// members aren't those the core holds goes on only on the person's yes.
	test(
		"a newer generation with other members, which this device had no welcome for, waits for the person's yes",
		async () => {
			const { fake, ana, bo, cy, a, b, conversation } = await blockedGroup();
			// Bo's device is away. The server drops Cy without his word; Ana, told whom it leaves out, restarts without him.
			await b.engine.stop();
			fake.dropMembers(conversation, [cy]);
			expect(await a.engine.restartGroup(conversation)).toEqual([cy]);
			expect(await a.engine.restartGroup(conversation, [cy])).toEqual([]);
			// The queue Bo's device would read its welcome from is gone by the time it's back.
			const { last_seq } = await a.api.queue(conversation, 0);
			fake.expireQueue(conversation, last_seq + 1);
			const back = await restarted(fake, b);
			await until(() => back.engine.conversationState(conversation)?.name === "members_changed");
			expect((await groupOf(back, conversation))?.generation).toBe(0);
			await sayYes(back, conversation);
			const held = await sameGroup([a, back], conversation);
			expect(held.generation).toBe(1);
			expect(usersOf(held)).toEqual([ana, bo].sort());
		},
		SLOW,
	);
});
