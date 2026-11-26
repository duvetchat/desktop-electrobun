import { describe, expect, test } from "bun:test";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import type { DirectMessage } from "$lib/api/conversations";
import type { EngineEvent } from "../events";
import {
	commitByHand,
	firstDevice,
	groupOf,
	lockedOnce,
	restarted,
	sameGroup,
	testHost,
	turnEnded,
	until,
	useFake,
	watchedHost,
	type TestDevice,
} from "../testing/engines";
import { entryOf, messageEntry } from "./sync";

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
			const { fake, a, b, conversation, requests } = await dmWithGroup();
			await byHand(a);
			const before = queueReads(requests, conversation).length;
			// Three commits whose events come backwards and twice, then three that come in order and twice.
			for (const order of ["reverse", "as_sent"] as const) {
				fake.holdEvents();
				for (let n = 0; n < 3; n++) await commitByHand(a, conversation);
				fake.releaseEvents({ order, repeat: true });
				const held = await sameGroup([a, b], conversation);
				expect(held.blocked).toBe(false);
			}
			expect((await groupOf(b, conversation))!.epoch).toBe(7);
			// Applied in their order from the events alone: no gap, so the queue was never read.
			expect(queueReads(requests, conversation).slice(before)).toEqual([]);
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
		"a queue page that doesn't go past where its read began isn't asked for again in that turn",
		async () => {
			const { fake, a, b, conversation, requests } = await dmWithGroup();
			await byHand(a);
			// A server that lies: the last entry there is, and a hundred more said to come after it, whatever is asked.
			const page = await a.api.queue(conversation, 0);
			const lie = { ...page, entries: [page.entries.at(-1)!], last_seq: page.last_seq + 100 };
			fake.refuse({ method: "GET", path: `/api/users/@me/conversations/${conversation}/mls/queue` }, 200, lie);
			fake.stripData = true;
			const before = queueReads(requests, conversation).length;
			await commitByHand(a, conversation);
			await until(() => queueReads(requests, conversation).length > before);
			await turnEnded(b);
			// Read once, the turn ends, as a gap that doesn't move ends it: the page goes again in a while, not at once.
			expect(queueReads(requests, conversation).length - before).toBe(1);
			b.clock.advance(60_000);
			await sameGroup([a, b], conversation);
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

	// M3: what the device hears while it isn't ready (here its database locked by another instance) isn't kept: the
	// queue has it all, which the device reads once it's ready.
	test(
		"what's heard while the device isn't ready isn't kept: the queue has it",
		async () => {
			const { fake, a, b, conversation } = await dmWithGroup();
			const applies: Record<string, unknown>[] = [];
			const host = watchedHost(lockedOnce(b.host), [], (cmd, command) => {
				if (cmd === "apply" && command.conversation_id === conversation) applies.push(command);
				return null;
			});
			const back = await restarted(fake, b, { host });
			expect(back.engine.state).toEqual({ name: "locked" });
			// Ana's device commits three times meanwhile, and Bo's hears each one.
			await byHand(a);
			for (let n = 0; n < 3; n++) await commitByHand(a, conversation);
			await until(() => back.heard.filter((event) => event.type === "MLS_COMMIT").length === 3);
			// Its database free, it starts: it applies nothing it heard, and the queue brings the three commits.
			back.clock.advance(2_000);
			await sameGroup([a, back], conversation);
			expect(applies[0]).toMatchObject({ entries: [] });
		},
		SLOW,
	);

	// I2: a conversation deleted while the device reads it: the queue is a 404, and the device lists its conversations
	// again. This one gone, it lets it go, its retries with it.
	test(
		"a conversation deleted meanwhile is let go, its retries with it",
		async () => {
			const { fake, a, b, conversation, requests } = await dmWithGroup();
			await byHand(a);
			// Ana's device commits, and the commit's event comes without its data: Bo's device reads the queue for it,
			// which by then is gone.
			fake.stripData = true;
			fake.holdEvents();
			await commitByHand(a, conversation);
			fake.deleteConversation(conversation);
			const before = queueReads(requests, conversation).length;
			fake.releaseEvents();
			await until(() => queueReads(requests, conversation).length > before);
			await turnEnded(b);
			for (let minute = 0; minute < 3; minute++) {
				b.clock.advance(60_000);
				await turnEnded(b);
			}
			expect(queueReads(requests, conversation)).toHaveLength(before + 1);
		},
		SLOW,
	);

	// I1: an external commit that lost its epoch: the welcome where the device's leaf began is stale by then, so it
	// joins again without reading the queue from there (which can be 45 days of it).
	test(
		"after a lost external commit, the device joins again without reading the queue from its first leaf",
		async () => {
			const { fake, a, b, conversation, requests } = await dmWithGroup();
			const listed = (await b.api.conversations()).find((conv) => conv.id === conversation);
			const joined = listed!.mls!.joined_seq!;
			// Bo's device is away while Ana's commits three times, and the queue keeps only the last.
			await b.engine.stop();
			await byHand(a);
			let last = 0;
			for (let n = 0; n < 3; n++) last = (await commitByHand(a, conversation)).seq;
			fake.expireQueue(conversation, last);
			// Back, it joins by an external commit, which loses its epoch to Ana's next commit: they reach the API
			// together, Ana's first.
			const path = `/api/users/@me/conversations/${conversation}/mls/commits`;
			const posts = () => requests.filter((request) => request.startsWith(`POST ${path}`)).length;
			const [posted, read] = [posts(), queueReads(requests, conversation).length];
			fake.gather({ method: "POST", path }, 2);
			const committing = commitByHand(a, conversation);
			await until(() => posts() === posted + 1);
			const back = await restarted(fake, b);
			await committing;
			// Ana's commit, Bo's external commit that lost, and the one that took the next epoch.
			expect(posts()).toBe(posted + 3);
			// What Bo's device read since it came back: never the queue from where its first leaf began.
			const since = queueReads(requests, conversation).slice(read);
			expect(since).not.toContain(`GET ${path.replace("commits", "queue")}?after=${joined - 1}`);
			await sameGroup([await restarted(fake, a), back], conversation);
		},
		SLOW,
	);
});

// What step 5's fuzzing found (PLAN-E2E-CLIENTES.md, «Lo que el paso 5 revisa»), which e2e-fuzz-corpus.json keeps too:
// what the server hands over, made a conversation's entry. Its fields are the server's word, carried as they came.
describe("what the fuzzers found", () => {
	const CONVERSATION = "0193a4b2-0000-7000-8000-0000000000c1";
	const MESSAGE = "0193a4b2-0000-7000-8000-0000000000a2";
	const AUTHOR = "0193a4b2-0000-7000-8000-0000000000b3";
	const DEVICE = "0193a4b2-0000-7000-8000-0000000000d4";
	const message = {
		...{ id: MESSAGE, conversation_id: CONVERSATION, author_id: AUTHOR, sender_device_id: DEVICE, ciphertext: "AAAA" },
		...{ seq: 5, sent_at: 1_763_150_000_123, generation: 0, epoch: 2 },
	};
	// What the server may send in an event's or a message's place, whatever their types say.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the server's word, as the readers take it
	const event = (type: string, data: unknown) => ({ type, data }) as EngineEvent;
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the server's word, as the readers take it
	const sent = (value: unknown) => value as DirectMessage;
	const entry = { seq: 5, kind: "commit", data: "AAAA", sent_at: 1, generation: 0, epoch: 2 };

	test("a message's entry is its message's fields, as they came", () => {
		expect(messageEntry(sent({ ...message, mentions: [AUTHOR], referenced_message: { message_id: MESSAGE } }))).toEqual(
			[
				CONVERSATION,
				{
					...{ seq: 5, kind: "message", data: "AAAA", sent_at: 1_763_150_000_123, generation: 0, epoch: 2 },
					...{ message_id: MESSAGE, sender_user: AUTHOR, sender_device: DEVICE, mentions: [AUTHOR], reply_to: MESSAGE },
				},
			],
		);
	});

	test("an event whose data isn't an object is none, never a throw", () => {
		for (const data of [null, 5, "x", []]) {
			for (const type of ["DM_MESSAGE_CREATE", "MLS_COMMIT", "DM_MESSAGE_UPDATE"])
				expect(entryOf(event(type, data))).toBeNull();
		}
		// Nor one without its entry.
		expect(entryOf(event("MLS_COMMIT", { conversation_id: CONVERSATION, generation: 0, epoch: 2 }))).toBeNull();
	});

	test("a number that isn't one makes no entry: the conversation's number would be NaN", () => {
		for (const seq of ["5", -1, 1.5, null, 2 ** 53]) {
			expect(messageEntry(sent({ ...message, seq }))).toBeNull();
			expect(
				entryOf(
					event("MLS_COMMIT", { conversation_id: CONVERSATION, generation: 0, epoch: 2, entry: { ...entry, seq } }),
				),
			).toBeNull();
		}
		expect(messageEntry(sent({ ...message, generation: "0" }))).toBeNull();
		expect(
			entryOf(event("MLS_WELCOME", { conversation_id: CONVERSATION, generation: "x", epoch: 2, entry })),
		).toBeNull();
		expect(entryOf(event("MLS_COMMIT", { conversation_id: 5, generation: 0, epoch: 2, entry }))).toBeNull();
	});

	test("a message without its time isn't given one", () => {
		const { sent_at: _, ...untimed } = message;
		expect(messageEntry(sent(untimed))).toBeNull();
	});
});
