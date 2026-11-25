import { describe, expect, spyOn, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { base64Bytes } from "$lib/activity-thumbnail";
import { bytesBase64 } from "$lib/staged-images";
import { CoreError } from "../errors";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	firstDevice,
	groupOf,
	restarted,
	sameGroup,
	testHost,
	until,
	useFake,
	watchedHost,
	type TestDevice,
} from "../testing/engines";

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
			const key = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x!;
			fake.externalSender = bytesBase64(base64Bytes(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(44, "=")));
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
});
