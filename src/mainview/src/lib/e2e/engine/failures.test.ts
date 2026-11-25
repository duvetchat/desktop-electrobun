import { describe, expect, spyOn, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { base64Bytes } from "$lib/activity-thumbnail";
import { sessionApi } from "$lib/api/api";
import { e2eApi } from "$lib/api/e2e";
import { bytesBase64 } from "$lib/staged-images";
import { CoreError } from "../errors";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	firstDevice,
	groupOf,
	lockedOnce,
	memoryStore,
	refusingStore,
	restarted,
	sameGroup,
	testDevice,
	TestClock,
	testHost,
	until,
	useFake,
	watchedHost,
	type TestDevice,
} from "../testing/engines";
import { Failures } from "./failures";
import { EXTERNAL_SENDER } from "./store";

// What a device fails to open, counted for the API by its kind (PLAN-E2E-API.md, K; decision 40), and the API's external
// sender, which a device pins the first time it sees it (Ruling 32).
const SLOW = 180_000;

/** A message of the device's own, sent by hand with its engine stopped: the core's text, and the API's message. */
async function send(device: TestDevice, conversation: string, text: string, spoil = false) {
	const nonce = crypto.randomUUID();
	const made = await device.host.handle<{ ciphertext: string }>({
		...{ cmd: "encrypt", conversation_id: conversation, nonce, envelope: { text } },
	});
	let { ciphertext } = made;
	if (spoil) {
		// One byte of its tag changed: no member can open it.
		const bytes = base64Bytes(ciphertext);
		bytes[bytes.length - 1]! ^= 0xff;
		ciphertext = bytesBase64(bytes);
	}
	const message = await device.api.sendMessage(conversation, { ciphertext, nonce });
	if (!spoil) {
		const { id: message_id, seq } = message;
		await device.host.handle({ cmd: "sent", conversation_id: conversation, nonce, message_id, seq });
	}
	return message;
}

/** An Ed25519 public key in base64, as the API serves its external sender. */
function newKey(): string {
	const key = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x!;
	return bytesBase64(base64Bytes(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(44, "=")));
}

describe("the reports of what can't be opened", () => {
	// M2: the route takes 60 reports an hour. A 429 stops the round, the other kinds with it, and the next report waits
	// as long as it says, an hour when it doesn't.
	test(
		"a rate limit stops the round, and the next report waits as long as it says",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const route = { method: "POST", path: "/api/e2e/decrypt-failures" };
			let posts = 0;
			useFake(fake, (request) => {
				if (new URL(request.url).pathname === route.path) posts++;
			});
			// Each refusal is logged once its answer is handled, the wait it sets with it.
			const refused = spyOn(console, "error").mockImplementation(() => {});
			const clock = new TestClock();
			const api = e2eApi(sessionApi({ token: fake.signIn(ana).token, sessionToken: null }));
			const failures = new Failures(api, clock);
			const reported = () => [...fake.decryptFailures].sort((one, other) => one.kind.localeCompare(other.kind));
			failures.note("message");
			failures.note("commit");
			fake.refuse(route, 429, { error: "too many requests" }, { "Retry-After": "120" });
			clock.advance(60_000);
			await until(() => refused.mock.calls.length === 1);
			await Bun.sleep(100);
			expect(posts).toBe(1);
			// Not a minute later, but two: then both kinds go.
			clock.advance(60_000);
			await Bun.sleep(100);
			expect(posts).toBe(1);
			clock.advance(60_000);
			await until(() => fake.decryptFailures.length === 2);
			expect(reported()).toEqual([
				{ kind: "commit", count: 1 },
				{ kind: "message", count: 1 },
			]);

			// Refused without a word of when: an hour.
			failures.note("welcome");
			fake.refuse(route, 429, { error: "too many requests" });
			clock.advance(60_000);
			await until(() => refused.mock.calls.length === 2);
			clock.advance(59 * 60_000);
			await Bun.sleep(100);
			expect(posts).toBe(4);
			clock.advance(60_000);
			await until(() => fake.decryptFailures.length === 3);
			failures.stop();
		},
		SLOW,
	);
});

describe.skipIf(!coreLibrary)("what can't be opened", () => {
	test(
		"an entry that can't be opened is reported by its kind; a deleted one isn't",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const a = await firstDevice(fake, ana);
			const b = await firstDevice(fake, bo);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);

			// While Bo's device is away, Ana's sends a message and deletes it, then sends one nobody can open.
			await b.engine.stop();
			await a.engine.stop();
			await a.host.open(ana);
			const gone = await send(a, conversation, "gone");
			const tombstone = await a.host.handle<{ ciphertext: string }>({
				...{ cmd: "delete", conversation_id: conversation, message_id: gone.id },
			});
			await a.api.deleteMessage(conversation, gone.id, tombstone.ciphertext);
			await send(a, conversation, "spoiled", true);

			// Bo's device reads the queue: the deleted message's emptied entry isn't a failure; the spoiled one is, a
			// message, reported within the minute with the others.
			const back = await restarted(fake, b);
			expect(fake.decryptFailures).toEqual([]);
			back.clock.advance(60_000);
			await until(() => fake.decryptFailures.length > 0);
			expect(fake.decryptFailures).toEqual([{ kind: "message", count: 1 }]);
		},
		SLOW,
	);

	test(
		"a message from another device that can't be opened is reported as direct",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			fake.addConversation({ type: "dm", members: [ana, bo] });
			const a = await firstDevice(fake, ana);
			const unreadable = new CoreError("decrypt_failed", "the message didn't open", { kind: "direct" });
			const b = await firstDevice(fake, bo, {
				host: watchedHost(testHost(), [], (cmd) => (cmd === "receive_direct" ? unreadable : null)),
			});
			await a.api.sendToDevice(b.registered[0]!, btoa("sealed for Bo's device"));
			// Read and dropped: it would never open.
			await until(async () => (await b.api.inbox()).length === 0);
			b.clock.advance(60_000);
			await until(() => fake.decryptFailures.length > 0);
			expect(fake.decryptFailures).toEqual([{ kind: "direct", count: 1 }]);
		},
		SLOW,
	);

	test(
		"another external sender is refused, and the pinned one stays",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const warned = spyOn(console, "warn");
			// Ana's device pins the API's key the first time it sees it.
			const a = await firstDevice(fake, ana);
			const pinned = fake.externalSender;
			expect(a.store.read<string>("external_sender")).toBe(pinned);

			// The API then serves another, under which Bo's new device makes their DM's group.
			fake.externalSender = newKey();
			const b = await firstDevice(fake, bo);
			await b.engine.openConversation(conversation);
			expect(await groupOf(b, conversation)).not.toBeNull();

			// Ana's device refuses the group: it can't go on there, and no restart would change its external sender.
			await until(() => a.engine.conversationState(conversation)?.name === "blocked");
			expect(a.engine.conversationState(conversation)).toEqual({ name: "blocked", restart: "none", owner: null });
			expect(await groupOf(a, conversation)).toBeNull();

			// Started again, the API's other key is refused with a notice, and the pinned one stays.
			const again = await restarted(fake, a);
			expect(again.store.read<string>("external_sender")).toBe(pinned);
			expect(warned.mock.calls.some(([said]) => String(said).includes("external sender"))).toBe(true);
			expect(again.engine.conversationState(conversation)).toEqual({ name: "blocked", restart: "none", owner: null });
		},
		SLOW,
	);

	// M4: a record whose storage refuses the pin (full, or refused) can't keep it: the session holds it all the same,
	// so a start that comes again after the API changed its key keeps the one this device saw first.
	test(
		"the pinned key holds for the session where the record can't keep it",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			await firstDevice(fake, bo);
			const warned = spyOn(console, "warn");
			const made: Record<string, unknown>[] = [];
			const host = watchedHost(lockedOnce(testHost()), [], (cmd, command) => {
				if (cmd === "create_group") made.push(command);
				return null;
			});
			// Ana's first device sees the API's key, which its record can't keep, and finds its database locked.
			const a = testDevice(fake, ana, { host, store: refusingStore(memoryStore(), EXTERNAL_SENDER) });
			await a.engine.start();
			expect(a.engine.state).toEqual({ name: "locked" });
			const pinned = fake.externalSender;
			// By its next try, the API serves another key.
			fake.externalSender = newKey();
			a.clock.advance(2_000);
			await until(() => a.engine.state.name === "first_device");
			await a.engine.makeIdentity();
			await a.engine.keySaved();
			await a.engine.openConversation(conversation);
			// Every try of the group's creation (the first asks for Bo's identity) held to the key it saw first.
			expect([...new Set(made.map((command) => command.external_sender))]).toEqual([pinned]);
			expect(warned.mock.calls.some(([said]) => String(said).includes("external sender"))).toBe(true);
		},
		SLOW,
	);
});
