import { describe, expect, test } from "bun:test";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	commitByHand,
	firstDevice,
	groupOf,
	restarted,
	sameGroup,
	testHost,
	useFake,
	watchedHost,
	type TestDevice,
} from "../testing/engines";

// A conversation's queue (PLAN-E2E-CLIENTES.md, «La cola de una conversación»): the entries the API numbers, from its
// events and its queue, applied by their number, one conversation at a time.
const SLOW = 180_000;

/** Ana's and Bo's first devices, in a DM whose group Ana made as she opened it, which Bo's device joined. */
async function dmWithGroup(given: { bo?: Parameters<typeof firstDevice>[2] } = {}) {
	const fake = new FakeApi();
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	const requests: string[] = [];
	useFake(fake, (request) => {
		const url = new URL(request.url);
		requests.push(`${request.method} ${url.pathname}${url.search}`);
	});
	const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
	const a = await firstDevice(fake, ana);
	const b = await firstDevice(fake, bo, given.bo);
	await a.engine.openConversation(conversation);
	await sameGroup([a, b], conversation);
	return { fake, ana, bo, a, b, conversation, requests };
}

/** Stops the device's engine and opens its core, for commits by hand. */
async function byHand(device: TestDevice) {
	await device.engine.stop();
	await device.host.open(device.user);
}

const queueReads = (requests: string[], conversation: string) =>
	requests.filter((request) => request.startsWith(`GET /api/users/@me/conversations/${conversation}/mls/queue`));

describe.skipIf(!coreLibrary)("a conversation's queue", () => {
	test(
		"entries apply by their number, whatever order they came in",
		async () => {
			const { fake, a, b, conversation } = await dmWithGroup();
			await byHand(a);
			// Three commits whose events come backwards and twice, then three that come in order and twice.
			for (const order of ["reverse", "as_sent"] as const) {
				fake.holdEvents();
				for (let n = 0; n < 3; n++) await commitByHand(a, conversation);
				fake.releaseEvents({ order, repeat: true });
				const held = await sameGroup([a, b], conversation);
				expect(held.blocked).toBe(false);
			}
			expect((await groupOf(b, conversation))!.epoch).toBe(7);
		},
		SLOW,
	);

	test(
		"a gap asks for the queue",
		async () => {
			let deaf = false;
			const { a, b, conversation, requests } = await dmWithGroup({
				bo: { hears: (event) => !(deaf && event.type === "MLS_COMMIT") },
			});
			await byHand(a);
			// Bo's device misses two commits' events, then hears the third's.
			deaf = true;
			await commitByHand(a, conversation);
			await commitByHand(a, conversation);
			deaf = false;
			const before = queueReads(requests, conversation).length;
			const last = await commitByHand(a, conversation);
			await sameGroup([a, b], conversation);
			// It read the queue from where its core was: after the entries it had applied.
			const reads = queueReads(requests, conversation).slice(before);
			expect(reads).toContain(`GET /api/users/@me/conversations/${conversation}/mls/queue?after=${last.seq - 3}`);
		},
		SLOW,
	);

	test(
		"an entry without its data is read from the queue",
		async () => {
			const { fake, a, b, conversation, requests } = await dmWithGroup();
			await byHand(a);
			fake.stripData = true;
			const before = queueReads(requests, conversation).length;
			const taken = await commitByHand(a, conversation);
			await sameGroup([a, b], conversation);
			expect(queueReads(requests, conversation).slice(before)).toEqual([
				`GET /api/users/@me/conversations/${conversation}/mls/queue?after=${taken.seq - 1}`,
			]);
		},
		SLOW,
	);

	test(
		"an expired queue joins again and keeps its database",
		async () => {
			const { fake, ana, bo, a, b, conversation } = await dmWithGroup();
			// A second conversation of theirs, whose group Bo's device keeps through it all.
			const other = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			await a.engine.openConversation(other);
			const kept = await sameGroup([a, b], other);
			const { device_id } = await b.host.handle<{ device_id: string }>({ cmd: "status" });

			// Bo's device is away while Ana's commits three times, and the queue keeps only the last.
			await b.engine.stop();
			await byHand(a);
			let last = 0;
			for (let n = 0; n < 3; n++) last = (await commitByHand(a, conversation)).seq;
			// Ana's engine runs again, and applies the queue to her last commit before it expires.
			const ana2 = await restarted(fake, a);
			fake.expireQueue(conversation, last);
			const back = await restarted(fake, b);
			expect(back.engine.state).toEqual({ name: "ready" });
			// It joined again by an external commit, which Ana's device applies.
			await sameGroup([ana2, back], conversation);
			const after = (await back.api.queue(conversation, last)).entries;
			expect(after).toMatchObject([{ kind: "commit", sender_user: bo }]);
			// The same device, with its other conversation's group as it was.
			expect((await back.host.handle<{ device_id: string }>({ cmd: "status" })).device_id).toBe(device_id);
			expect(await groupOf(back, other)).toMatchObject({ generation: kept.generation, epoch: kept.epoch });
		},
		SLOW,
	);

	test(
		"needs_identities observes those users and goes on",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const requests: string[] = [];
			useFake(fake, (request) => {
				const url = new URL(request.url);
				requests.push(`${request.method} ${url.pathname}${url.search}`);
			});
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const a = await firstDevice(fake, ana);
			const log: string[] = [];
			const b = await firstDevice(fake, bo, { host: watchedHost(testHost(), log) });
			// Bo's device has never observed Ana: the welcome asks for her identity first.
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			const asked = requests.filter((r) => r.startsWith("GET /api/users/identities?"));
			expect(asked.some((r) => decodeURIComponent(r).includes(ana))).toBe(true);
			const applies = log.flatMap((cmd, i) => (cmd === "apply" ? [i] : []));
			const observed = log.lastIndexOf("observe_user");
			expect(observed).toBeGreaterThan(applies[0]!);
			expect(applies.at(-1)!).toBeGreaterThan(observed);
		},
		SLOW,
	);
});
