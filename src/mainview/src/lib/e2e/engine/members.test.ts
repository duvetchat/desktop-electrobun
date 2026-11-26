import { describe, expect, test } from "bun:test";
import { base64Bytes } from "$lib/activity-thumbnail";
import { bytesBase64 } from "$lib/staged-images";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	approvedDevice,
	firstDevice,
	groupOf,
	rejection,
	restarted,
	sameGroup,
	turnEnded,
	until,
	useFake,
	type TestDevice,
} from "../testing/engines";

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

/** Ana's group with Bo and Cy, a device each, its group made by Ana's device and joined by the others' welcomes. */
async function groupOfThree() {
	const setup = setUp();
	const { fake } = setup;
	const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
	const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
	const [a, b, c] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, cy)];
	await a.engine.openConversation(conversation);
	const made = await sameGroup([a, b, c], conversation);
	return { ...setup, ana, bo, cy, a, b, c, conversation, made };
}

/**
 * The same group, blocked by a commit no device can process, as a server that takes anything would let it in: Ana's
 * leaf renewal, one byte of its signature changed, sent under Bo's session. Every device says so, Ana's started again.
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

/** The users a group's leaves are of, each once, in order. */
const usersOf = (held: { devices: { user_id: string }[] }) => [...new Set(held.devices.map((d) => d.user_id))].sort();

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

	// The same rule where the list still has the user as their leave goes: another device of theirs left first, and the
	// API's 403 (they aren't a member any more) is this device's leave too, which the list then confirms.
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

	// Review Focus 3: an addition whose answer is lost goes again with its bytes, which the API answers as it did.
	test(
		"an addition whose answer is lost is sent again with its bytes, and the user is added once",
		async () => {
			const { fake, requests, bodies } = setUp();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			const [a, b] = [await firstDevice(fake, ana), await firstDevice(fake, bo)];
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
			expect(c.engine.conversationState(conversation)).toEqual({ name: "members_changed" });
			expect((await groupOf(c, conversation))?.generation).toBe(0);
			expect(requests.filter((request) => request.endsWith(`/${conversation}/mls/group-info`))).toEqual([]);
			// On his yes, it joins the new generation by an external commit.
			await c.engine.acceptMembers(conversation);
			const held = await sameGroup([b, c], conversation);
			expect(held.generation).toBe(1);
			expect(c.engine.conversationState(conversation)).toBeNull();
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
			await back.engine.acceptMembers(conversation);
			const held = await sameGroup([a, back], conversation);
			expect(held.generation).toBe(1);
			expect(usersOf(held)).toEqual([ana, bo].sort());
		},
		SLOW,
	);
});
