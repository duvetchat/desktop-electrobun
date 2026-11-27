import { describe, expect, test } from "bun:test";
import { CoreError } from "../errors";
import type { CoreHost } from "../host";
import { FakeApi, type GatewayEvent } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	answeringHost,
	commitByHand,
	firstDevice,
	rejection,
	restarted,
	sameGroup,
	testDevice,
	testHost,
	turnEnded,
	until,
	useFake,
	watchedHost,
	type TestDevice,
} from "../testing/engines";
import { mentionsIn } from "./send";

// What a device sends to a conversation (PLAN-E2E-CLIENTES.md, «Enviar», and «Qué se manda», its message rows): a
// message encrypted by the core, sent with its nonce and bound to the ID the API gives it; one without an answer sent
// again with the same bytes; what waits, sent first and in order; a refusal that keeps the message; an edit and a
// deletion taken from the entries their answers give.
const SLOW = 180_000;
const DAY = 24 * 3600 * 1000;
const messagesPath = (conversation: string) => `/api/users/@me/conversations/${conversation}/messages`;
const commitsPath = (conversation: string) => `/api/users/@me/conversations/${conversation}/mls/commits`;

/** A request the fake took: its method, its path and its body as JSON (null until read, or without one). */
interface Seen {
	method: string;
	path: string;
	body: any;
}

/**
 * Ana's and Bo's first devices, in a DM whose group Ana made (Ana's on `aHost`, hearing what `aHears` lets through), and
 * every request the fake saw.
 */
async function dm(given: { aHost?: CoreHost; aHears?: (event: GatewayEvent) => boolean } = {}) {
	const fake = new FakeApi();
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	const seen: Seen[] = [];
	const reading: Promise<void>[] = [];
	useFake(fake, (request) => {
		const entry: Seen = { method: request.method, path: new URL(request.url).pathname, body: null };
		seen.push(entry);
		reading.push(
			request.text().then((text) => {
				entry.body = text ? JSON.parse(text) : null;
			}),
		);
	});
	const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
	const a = await firstDevice(fake, ana, { host: given.aHost, hears: given.aHears });
	const b = await firstDevice(fake, bo);
	await a.engine.openConversation(conversation);
	await sameGroup([a, b], conversation);
	/** The message posts the fake saw, their bodies read. */
	const posts = async () => {
		await Promise.all(reading);
		return seen.filter((s) => s.method === "POST" && s.path === messagesPath(conversation));
	};
	return { fake, ana, bo, a, b, conversation, seen, posts };
}

/** The text a device's core shows of a message, once it has it: null while it has none. */
async function textOn(device: TestDevice, conversation: string, id: string): Promise<string | null> {
	const [shown] = await device.engine.messages(conversation, [id]);
	return shown?.status === "ok" ? (shown.text ?? null) : null;
}

/** The nonces of the messages that wait on the device, in the order they were made. */
const nonces = (device: TestDevice, conversation: string) =>
	device.engine.pendingMessages(conversation).then((pending) => pending.map((p) => p.nonce));

/** The IDs of the conversation's messages, in their queue's order, as a device reads it. */
const queued = async (device: TestDevice, conversation: string) =>
	(await device.api.queue(conversation, 0)).entries.filter((e) => e.kind === "message").map((e) => e.message_id!);

/** Bo's device moves the group on six epochs by hand (its engine stopped), and Ana's follows: her bytes are stale. */
async function sixEpochs(a: TestDevice, b: TestDevice, conversation: string) {
	await b.engine.stop();
	await b.host.open(b.user);
	for (let i = 0; i < 6; i++) await commitByHand(b, conversation);
	const epochOf = async () =>
		(await a.host.handle<{ epoch: number }>({ cmd: "group", conversation_id: conversation })).epoch;
	await until(async () => (await epochOf()) === 7);
}

/**
 * Three messages of Ana's that wait (each request cut), whose bytes six epochs made stale; Ana's core on `host`.
 * The nonces she sent them with, in order.
 */
async function threeStale(host: CoreHost) {
	const made = await dm({ aHost: host });
	const { fake, a, b, conversation } = made;
	const sent: string[] = [];
	for (const text of ["one", "two", "three"]) {
		const nonce = crypto.randomUUID();
		sent.push(nonce);
		fake.cutRequest({ method: "POST", path: messagesPath(conversation) });
		await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce, text }));
	}
	await sixEpochs(a, b, conversation);
	return { ...made, sent };
}

describe("mentions", () => {
	test("mentions are the users the text names outside code", () => {
		const [x, y, z] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
		const text = `hi <@${x}> and <@${y}>, \`<@${z}>\` in code,\n\`\`\`\n<@${z}>\n\`\`\`\nand <@${x}> again, <@nobody>`;
		expect(mentionsIn(text)).toEqual([x, y]);
		expect(mentionsIn("no one")).toEqual([]);
		// The API takes 20 at most: the first 20 the text names go.
		const many = Array.from({ length: 25 }, () => crypto.randomUUID());
		expect(mentionsIn(many.map((id) => `<@${id}>`).join(" "))).toEqual(many.slice(0, 20));
	});
});

describe.skipIf(!coreLibrary)("a device's messages", () => {
	test(
		"a message is encrypted, sent and bound to its id",
		async () => {
			// Ana's device doesn't hear its own message's event: the queue's copy would bind it too.
			const { a, b, bo, conversation, posts } = await dm({ aHears: (event) => event.type !== "DM_MESSAGE_CREATE" });
			const nonce = crypto.randomUUID();
			const text = `hello <@${bo}>, and \`<@${crypto.randomUUID()}>\``;
			const sent = await a.engine.sendMessage({ conversation_id: conversation, nonce, text });
			if (!sent) throw new Error("the message wasn't sent");
			expect(sent).toMatchObject({ conversation_id: conversation, nonce });
			// The request carries the core's ciphertext and the nonce, whom the text names outside code, and no text.
			const [post] = await posts();
			expect(post!.body).toMatchObject({ nonce, mentions: [bo], ciphertext: expect.any(String) });
			expect(post!.body).not.toHaveProperty("content");
			expect(JSON.stringify(post!.body)).not.toContain("hello");
			// Ana's core binds it to its ID and number: it waits no more.
			expect(await a.engine.messages(conversation, [sent.id])).toMatchObject([
				{ message_id: sent.id, seq: sent.seq, status: "ok", text },
			]);
			expect(await nonces(a, conversation)).toEqual([]);
			// Bo's device opens it.
			await until(async () => (await textOn(b, conversation, sent.id)) === text);
		},
		SLOW,
	);

	test(
		"a message cut before its answer is sent again with the same bytes",
		async () => {
			// Ana's device doesn't hear its own messages' events, which its queue would settle them with first.
			const { fake, a, b, conversation, posts } = await dm({ aHears: (event) => event.type !== "DM_MESSAGE_CREATE" });
			const path = { method: "POST", path: messagesPath(conversation) };
			// The API takes it, and its answer is lost: the message waits on Ana's device.
			const nonce = crypto.randomUUID();
			fake.loseAnswer(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce, text: "once" }));
			expect(await nonces(a, conversation)).toEqual([nonce]);
			// Sent again (the person's Retry): the same bytes, which the API answers with the message it posted.
			const sent = (await a.engine.sendMessage({ conversation_id: conversation, nonce, text: "once" }))!;
			const [first, retried] = await posts();
			expect(retried!.body).toMatchObject({ nonce, ciphertext: first!.body.ciphertext });
			expect(await nonces(a, conversation)).toEqual([]);
			expect(await queued(b, conversation)).toEqual([sent.id]);
			await until(async () => (await textOn(b, conversation, sent.id)) === "once");

			// Its request cut on its way, and the app closed: started again, the device sends it with the same bytes.
			fake.cutRequest(path);
			await rejection(
				a.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: "twice" }),
			);
			const before = (await posts()).length;
			const again = await restarted(fake, a);
			await until(async () => (await nonces(again, conversation)).length === 0);
			const [lost, resent] = (await posts()).slice(before - 1);
			expect(resent!.body).toMatchObject({ nonce: lost!.body.nonce, ciphertext: lost!.body.ciphertext });
			// One message of it, which Bo opens.
			const ids = await queued(b, conversation);
			expect(ids).toHaveLength(2);
			await until(async () => (await textOn(b, conversation, ids[1]!)) === "twice");
		},
		SLOW,
	);

	test(
		"pending messages go first and in order, after the queue",
		async () => {
			const { fake, a, b, conversation, seen, posts } = await dm();
			const path = { method: "POST", path: messagesPath(conversation) };
			// Two messages whose requests never reach the API: they wait, in the order they were made.
			const [first, second, third] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
			fake.cutRequest(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "first" }));
			fake.cutRequest(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: second, text: "second" }));
			expect(await nonces(a, conversation)).toEqual([first, second]);

			// Ana's app closes; meanwhile Bo renews his leaf. Started again, her device reads the queue first, then sends
			// what waits, in its order.
			await a.engine.stop();
			await b.engine.stop();
			await b.host.open(b.user);
			await commitByHand(b, conversation);
			const mark = seen.length;
			const again = await restarted(fake, a);
			await until(async () => (await nonces(again, conversation)).length === 0);
			const after = seen
				.slice(mark)
				.map((s) => (s.path.endsWith("/mls/queue") ? `${s.method} queue` : `${s.method} ${s.path}`));
			const read = after.indexOf("GET queue");
			const sends = after.flatMap((line, i) => (line === `POST ${path.path}` ? [i] : []));
			expect(read).toBeGreaterThanOrEqual(0);
			expect(sends).toHaveLength(2);
			expect(sends[0]!).toBeGreaterThan(read);

			// A new message goes after them. (The second's first try went to the first: what waits goes first.)
			await again.engine.sendMessage({ conversation_id: conversation, nonce: third, text: "third" });
			expect((await posts()).map((post) => post.body.nonce)).toEqual([first, first, first, second, third]);
			const bo = await restarted(fake, b);
			const ids = await queued(bo, conversation);
			expect(ids).toHaveLength(3);
			await until(async () => (await textOn(bo, conversation, ids[2]!)) === "third");
			expect(await Promise.all(ids.map((id) => textOn(bo, conversation, id)))).toEqual(["first", "second", "third"]);
		},
		SLOW,
	);

	test(
		"a stale message is discarded and encrypted again",
		async () => {
			const { fake, a, b, conversation, posts } = await dm();
			const path = { method: "POST", path: messagesPath(conversation) };
			const epochOf = async (device: TestDevice) =>
				(
					await device.host.handle<{ generation: number; epoch: number }>({
						cmd: "group",
						conversation_id: conversation,
					})
				).epoch;
			// A message that never reached the API, while the group moves on six epochs: no member could open it now.
			const nonce = crypto.randomUUID();
			fake.cutRequest(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce, text: "late" }));
			await b.engine.stop();
			await b.host.open(b.user);
			for (let i = 0; i < 6; i++) await commitByHand(b, conversation);
			await until(async () => (await epochOf(a)) === 7);
			// Sent again: the core says it's stale, so it's dropped and its text encrypted again, under another nonce.
			const sent = (await a.engine.sendMessage({ conversation_id: conversation, nonce, text: "late" }))!;
			expect(sent.nonce).not.toBe(nonce);
			expect(await nonces(a, conversation)).toEqual([]);
			const bo = await restarted(fake, b);
			await until(async () => (await textOn(bo, conversation, sent.id)) === "late");

			// The API says it's stale (409): the device encrypts it again, under another nonce.
			const refused = crypto.randomUUID();
			const { generation, epoch } = await a.host.handle<{ generation: number; epoch: number }>({
				...{ cmd: "group", conversation_id: conversation },
			});
			fake.refuse(path, 409, { error: "stale message", generation, epoch });
			const posted = (await a.engine.sendMessage({ conversation_id: conversation, nonce: refused, text: "again" }))!;
			expect(posted.nonce).not.toBe(refused);
			expect((await posts()).filter((post) => post.body.nonce === refused)).toHaveLength(1);
			expect(await nonces(a, conversation)).toEqual([]);
			await until(async () => (await textOn(bo, conversation, posted.id)) === "again");
		},
		SLOW,
	);

	test(
		"a refused send keeps its message",
		async () => {
			const { fake, a, b, conversation, posts } = await dm();
			const path = { method: "POST", path: messagesPath(conversation) };
			// The pause (503) and a refusal (409) keep it, to be sent again; the update (426) too, and the device then
			// waits for its update. What waits goes first, so each refusal is said to what's ahead of the new one too: the
			// refused one stays, and the next goes on; the update stops them all.
			const kept: string[] = [];
			for (const [status, body, times] of [
				[503, undefined, 1],
				[409, { error: "this nonce was sent with another message" }, 2],
				[426, undefined, 1],
			] as const) {
				const nonce = crypto.randomUUID();
				for (let i = 0; i < times; i++) fake.refuse(path, status, body);
				await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce, text: `refused (${status})` }));
				kept.push(nonce);
				expect(await nonces(a, conversation)).toEqual(kept);
			}
			expect(a.engine.state).toMatchObject({ name: "update" });
			expect(await posts()).toHaveLength(4);
			// Dismiss drops one; started again, the device sends the others, once each.
			await a.engine.discardMessage(conversation, kept[1]!);
			expect(await nonces(a, conversation)).toEqual([kept[0], kept[2]]);
			const again = await restarted(fake, a);
			await until(async () => (await nonces(again, conversation)).length === 0);
			const ids = await queued(b, conversation);
			expect(ids).toHaveLength(2);
			await until(async () => (await textOn(b, conversation, ids[1]!)) !== null);
			expect(await Promise.all(ids.map((id) => textOn(b, conversation, id)))).toEqual([
				"refused (503)",
				"refused (426)",
			]);
		},
		SLOW,
	);

	test(
		"an edit and a deletion apply from the entry their answer gives",
		async () => {
			// Ana's device hears none of its own changes' events: what its core takes of them comes from the answers.
			const { fake, a, b, conversation } = await dm({
				aHears: (event) => event.type !== "DM_MESSAGE_UPDATE" && event.type !== "DM_MESSAGE_DELETE",
			});
			const through = async () =>
				(await a.host.handle<{ applied_through: number }>({ cmd: "apply", conversation_id: conversation, entries: [] }))
					.applied_through;
			const text = "first words";
			const sent = (await a.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text }))!;
			await until(async () => (await textOn(b, conversation, sent.id)) === text);

			// Its answer lost, the edit goes again with the same bytes, which the API answers with the same entry.
			fake.loseAnswer({ method: "PATCH", path: `${messagesPath(conversation)}/${sent.id}` });
			await a.engine.editMessage(conversation, sent.id, "second words");
			expect(await textOn(a, conversation, sent.id)).toBe("second words");
			a.clock.advance(2_000);
			await until(async () => (await textOn(b, conversation, sent.id)) === "second words");
			const edits = (await b.api.queue(conversation, 0)).entries.filter((entry) => entry.kind === "edit");
			expect(edits).toHaveLength(1);
			await until(async () => (await through()) === edits[0]!.seq);
			expect(await a.engine.messages(conversation, [sent.id])).toMatchObject([
				{ text: "second words", edited_at: expect.any(Number) },
			]);

			await a.engine.deleteMessage(conversation, sent.id);
			const deletion = (await b.api.queue(conversation, 0)).entries.find((entry) => entry.kind === "delete")!;
			expect(await through()).toBe(deletion.seq);
			expect(await a.engine.messages(conversation, [sent.id])).toEqual([]);
			await until(async () => (await b.engine.messages(conversation, [sent.id])).length === 0);
		},
		SLOW,
	);

	test(
		"a sticker goes in the clear with an empty envelope",
		async () => {
			const envelopes: unknown[] = [];
			const host = watchedHost(testHost(), [], (cmd, command) => {
				if (cmd === "encrypt") envelopes.push(command.envelope);
				return null;
			});
			const { a, b, conversation, posts } = await dm({ aHost: host });
			const sticker = crypto.randomUUID();
			const nonce = crypto.randomUUID();
			const sent = (await a.engine.sendMessage({
				...{ conversation_id: conversation, nonce },
				sticker_attachment_id: sticker,
			}))!;
			// Each time the core gives its bytes, the same empty envelope.
			expect(envelopes.length).toBeGreaterThan(0);
			expect(envelopes.every((envelope) => JSON.stringify(envelope) === "{}")).toBe(true);
			expect((await posts())[0]!.body).toMatchObject({ nonce, sticker_attachment_id: sticker });
			expect(sent.sticker_attachment_id).toBe(sticker);
			// Bo's core opens it: a message without text.
			await until(async () => (await b.engine.messages(conversation, [sent.id]))[0]?.status === "ok");
			expect((await b.engine.messages(conversation, [sent.id]))[0]!.text).toBeNull();
		},
		SLOW,
	);
	// The review's Missing 1: a commit of this device's that waits for its word keeps encrypt from going
	// («pending_commit»): it's settled first, by «Un commit sin respuesta», then the message is encrypted.
	test(
		"a message sent while a commit of this device's waits for its answer goes once the commit settles",
		async () => {
			const due: string[] = [];
			const host = answeringHost(testHost(), (command) =>
				command.cmd === "refresh_due" ? { conversations: [...due] } : undefined,
			);
			const { fake, a, b, conversation, seen } = await dm({ aHost: host });
			const commits = () => seen.filter((s) => s.method === "POST" && s.path === commitsPath(conversation));
			// Ana's leaf renewal reaches the API, and its answer is lost: the commit waits on her device for its word.
			due.push(conversation);
			fake.loseAnswer({ method: "POST", path: commitsPath(conversation) });
			const before = commits().length;
			a.clock.advance(DAY);
			await until(() => commits().length === before + 1);
			due.length = 0;
			// The message settles it (its bytes again, which the API answers as it did), then goes.
			const sent = await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "after it",
			});
			if (!sent) throw new Error("the message wasn't sent");
			await until(async () => (await textOn(b, conversation, sent.id)) === "after it");
		},
		SLOW,
	);

	// I2: a message made again keeps the nonce the person sent it with, and so do the ones made again after it, in
	// their order: the device and the view speak of one message each, which goes once.
	test(
		"a message made again whose request fails is still one message: its Retry sends it once, and Dismiss drops it",
		async () => {
			const { fake, a, b, conversation, posts } = await dm();
			const path = { method: "POST", path: messagesPath(conversation) };
			const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
			fake.cutRequest(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "first" }));
			fake.cutRequest(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: second, text: "second" }));
			// The group moves on six epochs: their bytes are stale.
			await b.engine.stop();
			await b.host.open(b.user);
			for (let i = 0; i < 6; i++) await commitByHand(b, conversation);
			const epochOf = async () =>
				(await a.host.handle<{ epoch: number }>({ cmd: "group", conversation_id: conversation })).epoch;
			await until(async () => (await epochOf()) === 7);
			// Retried, the first is made again, and the second after it; the request is cut. Each keeps its first nonce.
			fake.cutRequest(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "first" }));
			expect(await nonces(a, conversation)).toEqual([first, second]);
			// Dismiss drops the second; Retry sends the first, once: one request, and nothing of the second.
			await a.engine.discardMessage(conversation, second);
			expect(await nonces(a, conversation)).toEqual([first]);
			const before = (await posts()).length;
			const sent = await a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "first" });
			if (!sent) throw new Error("the message wasn't sent");
			expect(await nonces(a, conversation)).toEqual([]);
			expect((await posts()).slice(before).map((post) => post.body.nonce)).toEqual([sent.nonce]);
			const bo = await restarted(fake, b);
			expect(await queued(bo, conversation)).toEqual([sent.id]);
			await until(async () => (await textOn(bo, conversation, sent.id)) === "first");
		},
		SLOW,
	);

	// M3: a message whose request reached the API, its answer and its event lost, still waits here. Dismiss reads the
	// queue first: a message it settles went, and stays.
	test(
		"Dismiss reads the queue first: a message that went isn't dropped",
		async () => {
			const { fake, a, conversation } = await dm({ aHears: (event) => event.type !== "DM_MESSAGE_CREATE" });
			const nonce = crypto.randomUUID();
			fake.loseAnswer({ method: "POST", path: messagesPath(conversation) });
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce, text: "it went" }));
			expect(await nonces(a, conversation)).toEqual([nonce]);
			// The re-review's M3: Dismiss says it went, by the API's ID, which the view shows the API's copy of.
			const went = await a.engine.discardMessage(conversation, nonce);
			const [id] = await queued(a, conversation);
			expect(went).toBe(id!);
			expect(await textOn(a, conversation, id!)).toBe("it went");
			expect(await nonces(a, conversation)).toEqual([]);
		},
		SLOW,
	);

	// M5: the device reads 100 of a conversation's messages that wait; a new one past them is refused.
	test("a message sent before this device is ready is refused, with a code the view says", async () => {
		const fake = new FakeApi();
		const user = fake.addUser();
		useFake(fake);
		const early = testDevice(fake, user);
		const message = { conversation_id: crypto.randomUUID(), nonce: crypto.randomUUID(), text: "early" };
		expect(await rejection(early.engine.sendMessage(message))).toMatchObject({ code: "not_ready" });
	});

	// #510, case 1: a remake makes a message's new row before it drops its old one, so for a moment one more waits, which
	// must stay in the core's page of 100.
	test(
		"a new message is refused once 99 wait, so a remake's extra row stays in sight",
		async () => {
			const { a, conversation, posts } = await dm();
			for (let i = 0; i < 99; i++) {
				await a.host.handle({
					...{ cmd: "encrypt", conversation_id: conversation, nonce: crypto.randomUUID() },
					envelope: { text: `waits ${i}` },
				});
			}
			const before = (await posts()).length;
			// Refused with a code that crosses to another tab, which the view says as the table does (#508).
			expect(
				await rejection(
					a.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: "too many" }),
				),
			).toMatchObject({ code: "too_many_waiting" });
			expect((await posts()).length).toBe(before);
			expect(await a.engine.pendingMessages(conversation)).toHaveLength(99);
		},
		SLOW,
	);

	// I3: an edit or a deletion is the API's word too. One not answered yet is kept in the record (never its text) and
	// made again at the next start; a message's changes go one after the other; one refused for good is told; an update
	// (426) keeps it; the pause (503) waits as long as it says.
	test(
		"an edit or a deletion not answered yet is kept, in its message's order, and made again at start",
		async () => {
			const { fake, a, b, conversation, seen } = await dm();
			const refused: unknown[] = [];
			let device = a;
			const sent = await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "one",
			});
			if (!sent) throw new Error("the message wasn't sent");
			const path = `${messagesPath(conversation)}/${sent.id}`;
			const patches = () => seen.filter((s) => s.method === "PATCH" && s.path === path).length;
			const restart = async () => {
				device = await restarted(fake, device);
				device.engine.onChangeRefused((...told) => refused.push(told));
			};
			// Two edits of one message: the first's request is cut, and the second waits behind it.
			fake.cutRequest({ method: "PATCH", path });
			await a.engine.editMessage(conversation, sent.id, "two");
			await a.engine.editMessage(conversation, sent.id, "three");
			expect(patches()).toBe(1);
			// The app closes before any answer: started again, the device makes them again and sends them.
			await restart();
			await until(async () => (await textOn(b, conversation, sent.id)) === "three");
			// Refused for good, a change is told.
			fake.refuse({ method: "PATCH", path }, 403, { error: "only its author changes a message" });
			await device.engine.editMessage(conversation, sent.id, "four");
			expect(refused).toEqual([[conversation, sent.id, "edit"]]);
			// The pause: tried again once its Retry-After passed, not before.
			fake.refuse({ method: "PATCH", path }, 503, undefined, { "Retry-After": "60" });
			const paused = patches();
			await device.engine.editMessage(conversation, sent.id, "five");
			device.clock.advance(2_000);
			await turnEnded(device);
			expect(patches()).toBe(paused + 1);
			device.clock.advance(58_000);
			await until(async () => (await textOn(b, conversation, sent.id)) === "five");
			// An update (426) keeps it for after the update: started again, it goes.
			fake.refuse({ method: "DELETE", path }, 426);
			await rejection(device.engine.deleteMessage(conversation, sent.id));
			expect(device.engine.state).toMatchObject({ name: "update" });
			await restart();
			await until(async () => (await b.engine.messages(conversation, [sent.id])).length === 0);
			expect(refused).toHaveLength(1);
		},
		SLOW,
	);

	// The re-review's N1: a message made again goes under a new nonce, which the gateway's copy carries. With its answer
	// lost, that copy is what the device hears: it tells the views the message the person sent went, by the nonce they
	// sent it with, as an answer does; and a Retry of it, by that nonce, posts nothing.
	test(
		"a message made again whose answer is lost is told sent by its copy, and its Retry posts nothing",
		async () => {
			const { fake, a, b, conversation, posts } = await dm();
			const path = { method: "POST", path: messagesPath(conversation) };
			const first = crypto.randomUUID();
			const told: string[][] = [];
			a.engine.onSent((id, nonce, message) => told.push([id, nonce, message.id]));
			fake.cutRequest(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "once" }));
			await sixEpochs(a, b, conversation);
			// Retried, it's made again under a new nonce, which the API takes; its answer is lost.
			fake.loseAnswer(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "once" }));
			await until(() => told.length > 0);
			const [id] = await queued(a, conversation);
			expect(told).toEqual([[conversation, first, id!]]);
			// The copy bound it here. Retried again, it's the message sent already: nothing more goes, and its copy shows
			// (#510).
			await until(async () => (await nonces(a, conversation)).length === 0);
			const before = (await posts()).length;
			expect(await a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "once" })).toMatchObject({
				id: id!,
			});
			expect((await posts()).length).toBe(before);
			expect(await queued(a, conversation)).toEqual([id!]);
		},
		SLOW,
	);

	// N3: a message made again keeps its old bytes until its new ones exist, and each keeps its place. A remake cut
	// midway, its second message's encrypt failing, loses nothing, and the next flush sends them all, once, in order.
	test(
		"a remake cut midway loses nothing, and the next flush sends every message once, in order",
		async () => {
			const known = new Set<string>();
			const fresh: string[] = [];
			let failing = false;
			// The second message made again: its new bytes can't be made.
			const host = watchedHost(testHost(), [], (cmd, command) => {
				const nonce = String(command.nonce);
				if (cmd !== "encrypt" || !failing || known.has(nonce)) return null;
				if (!fresh.includes(nonce)) fresh.push(nonce);
				return fresh.indexOf(nonce) === 1 ? new Error("the core couldn't encrypt it") : null;
			});
			const { a, conversation, sent } = await threeStale(host);
			for (const nonce of sent) known.add(nonce);
			failing = true;
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: sent[0]!, text: "one" }));
			failing = false;
			expect(await nonces(a, conversation)).toEqual(sent);
			await a.engine.sendMessage({ conversation_id: conversation, nonce: sent[0]!, text: "one" });
			await until(async () => (await nonces(a, conversation)).length === 0);
			const ids = await queued(a, conversation);
			expect(await Promise.all(ids.map((id) => textOn(a, conversation, id)))).toEqual(["one", "two", "three"]);
		},
		SLOW,
	);

	// N3: the old bytes of a message made again that couldn't be dropped stay beside its new ones: the newer row goes,
	// the older is dropped unsent, and the message goes once, in its place.
	test(
		"a message whose new bytes wait beside its old ones goes once, in its place",
		async () => {
			let failing = false;
			let drops = 0;
			const host = watchedHost(testHost(), [], (cmd) =>
				cmd === "discard" && failing && ++drops === 2 ? new Error("the core couldn't drop it") : null,
			);
			const { a, conversation, sent } = await threeStale(host);
			failing = true;
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: sent[0]!, text: "one" }));
			failing = false;
			expect(await nonces(a, conversation)).toEqual(sent);
			await a.engine.sendMessage({ conversation_id: conversation, nonce: sent[0]!, text: "one" });
			await until(async () => (await nonces(a, conversation)).length === 0);
			const ids = await queued(a, conversation);
			expect(await Promise.all(ids.map((id) => textOn(a, conversation, id)))).toEqual(["one", "two", "three"]);
		},
		SLOW,
	);

	// N5: a deletion the API took, whose answer a restart cut off, goes again with new bytes, and the API answers 404 as
	// the message is gone for everyone: it's done, and nothing says it was refused.
	test(
		"a deletion the API took before a restart is done, not refused",
		async () => {
			const { fake, a, b, conversation, seen } = await dm();
			const sent = await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "gone",
			});
			if (!sent) throw new Error("the message wasn't sent");
			const path = `${messagesPath(conversation)}/${sent.id}`;
			const deletions = () => seen.filter((s) => s.method === "DELETE" && s.path === path).length;
			fake.loseAnswer({ method: "DELETE", path });
			await a.engine.deleteMessage(conversation, sent.id);
			await until(async () => (await b.engine.messages(conversation, [sent.id])).length === 0);
			await a.engine.stop();
			const again = testDevice(fake, a.user, { host: a.host, store: a.store, token: a.token });
			const refused: unknown[] = [];
			again.engine.onChangeRefused((...told) => refused.push(told));
			await again.engine.start();
			await until(() => deletions() === 2);
			await turnEnded(again);
			expect(refused).toEqual([]);
		},
		SLOW,
	);

	// N6: a change whose send throws past its request (the queue a 409 asks for, read here with its request cut) waits as
	// one without an answer does, and goes again: the message's changes don't stop behind it.
	test(
		"a change whose send throws waits, and goes again",
		async () => {
			const { fake, a, b, conversation } = await dm();
			const sent = await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "one",
			});
			if (!sent) throw new Error("the message wasn't sent");
			fake.refuse({ method: "PATCH", path: `${messagesPath(conversation)}/${sent.id}` }, 409, {
				error: "stale message",
			});
			fake.cutRequest({ method: "GET", path: `/api/users/@me/conversations/${conversation}/mls/queue` });
			await a.engine.editMessage(conversation, sent.id, "two");
			a.clock.advance(2_000);
			await until(async () => (await textOn(b, conversation, sent.id)) === "two");
		},
		SLOW,
	);

	// #510, case 2: a remade message whose answer was lost and whose event was missed is bound by the queue alone, past
	// the newest page the flush reads (#bound), which lets go of its link from the person's nonce.
	test(
		"a message made again whose sent row is past the newest hundred is not posted again",
		async () => {
			// Ana's device hears none of its messages' events: its queue alone brings their copies, at a READY.
			const { fake, a, b, conversation, posts } = await dm({ aHears: (event) => event.type !== "DM_MESSAGE_CREATE" });
			const path = { method: "POST", path: messagesPath(conversation) };
			const first = crypto.randomUUID();
			fake.cutRequest(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "once" }));
			await sixEpochs(a, b, conversation);
			// Retried, it's made again under a new nonce, which the API takes; its answer is lost.
			fake.loseAnswer(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "once" }));
			const bo = await restarted(fake, b);
			for (let i = 0; i < 100; i++) {
				await bo.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: `after ${i}` });
			}
			a.connect(a.registered.at(-1)!);
			await until(async () => (await nonces(a, conversation)).length === 0);
			await turnEnded(a);
			// Retried again, it's the message sent already: nothing more goes.
			const before = (await posts()).length;
			expect(await a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "once" })).toBeNull();
			expect((await posts()).length).toBe(before);
		},
		SLOW,
	);

	// #510, case 3: a Retry of a message that went showed nothing until a page listed it.
	test(
		"a Retry of a message that went shows the API's copy",
		async () => {
			const { fake, a, b, conversation, posts } = await dm({ aHears: (event) => event.type !== "DM_MESSAGE_CREATE" });
			const path = { method: "POST", path: messagesPath(conversation) };
			const first = crypto.randomUUID();
			fake.cutRequest(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "once" }));
			await sixEpochs(a, b, conversation);
			fake.loseAnswer(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "once" }));
			// A READY's queue binds its copy here, which the device knows the API's ID of.
			a.connect(a.registered.at(-1)!);
			await until(async () => (await nonces(a, conversation)).length === 0);
			const [id] = await queued(a, conversation);
			const before = (await posts()).length;
			const retried = await a.engine.sendMessage({ conversation_id: conversation, nonce: first, text: "once" });
			expect(retried).toMatchObject({ id, conversation_id: conversation });
			expect((await posts()).length).toBe(before);
		},
		SLOW,
	);

	// #510, case 4: a message made again whose new bytes the API says are stale too was refused, and those after it went
	// first.
	test(
		"a message stale again once made again stops the flush, so none after it goes first",
		async () => {
			const { fake, a, b, conversation } = await dm();
			const path = { method: "POST", path: messagesPath(conversation) };
			const [one, two] = [crypto.randomUUID(), crypto.randomUUID()];
			for (const [nonce, text] of [
				[one, "one"],
				[two, "two"],
			] as const) {
				fake.cutRequest(path);
				await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce, text }));
			}
			await sixEpochs(a, b, conversation);
			// A third: the flush makes the first two again, and the API says the first's new bytes are stale as well.
			const group = await a.host.handle<{ generation: number; epoch: number }>({
				...{ cmd: "group", conversation_id: conversation },
			});
			fake.refuse(path, 409, { error: "stale message", ...group });
			const three = crypto.randomUUID();
			await a.engine.sendMessage({ conversation_id: conversation, nonce: three, text: "three" }).catch(() => null);
			expect(await queued(a, conversation)).toEqual([]);
			// The next flush sends them all, in their order.
			await a.engine.sendMessage({ conversation_id: conversation, nonce: one, text: "one" });
			await until(async () => (await nonces(a, conversation)).length === 0);
			const ids = await queued(a, conversation);
			expect(await Promise.all(ids.map((id) => textOn(a, conversation, id)))).toEqual(["one", "two", "three"]);
		},
		SLOW,
	);

	// #510, case 5: a READY sent a paused conversation's messages, which got the 503 again; its changes waited.
	test(
		"a paused message waits out its pause through a READY",
		async () => {
			const { fake, a, b, conversation, posts } = await dm();
			const path = { method: "POST", path: messagesPath(conversation) };
			fake.refuse(path, 503);
			await rejection(
				a.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: "later" }),
			);
			a.connect(a.registered.at(-1)!);
			await turnEnded(a);
			expect(await posts()).toHaveLength(1);
			// Its Retry-After passed, it goes.
			a.clock.advance(60_000);
			await until(async () => (await posts()).length === 2);
			const [id] = await queued(a, conversation);
			await until(async () => (await textOn(b, conversation, id!)) === "later");
		},
		SLOW,
	);

	// #550 (step 5's engines review, Minor 1): a sent the core refuses is a word on that message, which the API took: it
	// stays for the person's Retry or Dismiss, and the messages after it go.
	test(
		"a sent that answers bad_command keeps its message, and the ones after it go",
		async () => {
			const one = crypto.randomUUID();
			const host = watchedHost(testHost(), [], (cmd, command) =>
				cmd === "sent" && command.nonce === one
					? new CoreError("bad_command", "the row isn't that message", { field: "message_id" })
					: null,
			);
			// Ana's device doesn't hear the messages' copies, whose queue entries would bind the first under its nonce.
			const { a, b, conversation } = await dm({ aHost: host, aHears: (event) => event.type !== "DM_MESSAGE_CREATE" });
			expect(
				await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: one, text: "one" })),
			).toMatchObject({ code: "bad_command", field: "message_id" });
			const two = await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "two",
			});
			expect(two).not.toBeNull();
			expect(await nonces(a, conversation)).toEqual([one]);
			await until(async () => (await textOn(b, conversation, two!.id)) === "two");
		},
		SLOW,
	);

	// #550: a core call cut (internal), its database failing (storage) or another instance holding it (locked) is no word
	// on the message, as the inbox reads them: the flush stops there, so none after it goes first.
	test(
		"a core call cut in a flush stops it, so none after it goes first",
		async () => {
			const one = crypto.randomUUID();
			let cut = false;
			const host = watchedHost(testHost(), [], (cmd, command) => {
				if (!cut || cmd !== "encrypt" || command.nonce !== one) return null;
				cut = false;
				return new CoreError("internal", "the call was cut");
			});
			const { fake, a, b, conversation, posts } = await dm({ aHost: host });
			const path = { method: "POST", path: messagesPath(conversation) };
			fake.cutRequest(path);
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: one, text: "one" }));
			// The next flush: the first message's encrypt is cut, so the second waits behind it, unsent.
			cut = true;
			const two = crypto.randomUUID();
			expect(
				await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce: two, text: "two" })),
			).toMatchObject({ code: "internal" });
			expect((await posts()).map((post) => post.body.nonce)).toEqual([one]);
			expect(await nonces(a, conversation)).toEqual([one, two]);
			// The next flush sends both, in their order.
			await a.engine.sendMessage({ conversation_id: conversation, nonce: two, text: "two" });
			const ids = await queued(a, conversation);
			expect(ids).toHaveLength(2);
			await until(async () => (await textOn(b, conversation, ids[1]!)) !== null);
			expect(await Promise.all(ids.map((id) => textOn(b, conversation, id)))).toEqual(["one", "two"]);
		},
		SLOW,
	);
});
