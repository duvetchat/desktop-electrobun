import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { base64Bytes } from "$lib/activity-thumbnail";
import type { Conversation, DirectMessage } from "$lib/api/conversations";
import type { Identity } from "$lib/api/e2e";
import { bytesBase64 } from "$lib/staged-images";
import { MAX_FILE_NAME } from "../conventions";
import { CoreError } from "../errors";
import { FakeApi, type GatewayEvent } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import type { CoreHost } from "../host";
import {
	answeringHost,
	approvedDevice,
	commitByHand,
	filesOn,
	firstDevice,
	groupOf,
	madeHere,
	memoryStore,
	refusingStore,
	rejection,
	resetFrom,
	restarted,
	sameGroup,
	sayYes,
	sendWritten,
	shownKey,
	testDevice,
	testHost,
	turnEnded,
	until,
	useFake,
	watchedHost,
	type TestDevice,
} from "../testing/engines";
import { useXHR } from "../testing/xhr";
import { LEGACY_RECORDS, keepMade } from "./legacy";
import { PENDING_SENDS, type EngineStore } from "./store";

// Step 5: the server as an attacker, against the desktop's and the web's engine (PLAN-E2E-CLIENTES.md, «Lo que el paso
// 5 revisa»). End-to-end encryption lets the server withhold and delay, but never read, forge, or make a device act on
// its word alone: the device never takes a device, an identity or a key the person didn't accept, never loses or forges
// a message the person holds, confirms only what the server took («Restricciones globales»), and goes on where the plan
// says it goes on. Each case is a lie the fake API tells, on real cores, held to the rule it names; what the server only
// withholds is its right, and no case's. The mobile app's twin task writes the same cases in snake_case.
const SLOW = 240_000;
// A message's files go up as a form, through XMLHttpRequest, which the fake answers.
useXHR();
const IDENTITY = { method: "PUT", path: "/api/users/@me/identity" };
const DEVICE_LIST = { method: "PUT", path: "/api/users/@me/device-list" };
const KEY_PACKAGES = { method: "PUT", path: "/api/users/@me/devices/@me/key-packages" };
const INBOX = { method: "DELETE", path: "/api/users/@me/devices/@me/inbox" };
const messagesPath = (conversation: string) => `/api/users/@me/conversations/${conversation}/messages`;

const said = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;

/** The text a device's core shows of a message, once it has it: null while it has none. */
async function textOn(device: TestDevice, conversation: string, id: string): Promise<string | null> {
	const [shown] = await device.engine.messages(conversation, [id]);
	return shown?.status === "ok" ? (shown.text ?? null) : null;
}

interface Status {
	device_id?: string;
	identity_key?: string;
	has_identity: boolean;
	device_list?: string;
}
const statusOf = (device: TestDevice) => device.host.handle<Status>({ cmd: "status" });

/** A message of the device's, sent through its engine. */
async function send(device: TestDevice, conversation: string, text: string): Promise<DirectMessage> {
	const sent = await device.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text });
	if (!sent) throw new Error(`the message "${text}" wasn't sent`);
	return sent;
}

/** The users the device's core holds in the conversation's group: none without one. */
const heldUsers = async (device: TestDevice, conversation: string) =>
	((await groupOf(device, conversation))?.members ?? []).map((member) => member.user_id);

/** What the conversation's queue holds of `kinds` from `user`, each by the generation and epoch it was made for. */
const madeAt = async (device: TestDevice, conversation: string, user: string, kinds: string[]) =>
	(await device.api.queue(conversation, 0)).entries
		.filter((entry) => kinds.includes(entry.kind) && entry.sender_user === user)
		.map(({ kind, generation, epoch }) => ({ kind, generation, epoch }));

/**
 * A core whose first encrypt once `armed` says so runs `then` after it made its bytes, before it answers: what the
 * server does while the device holds bytes it hasn't sent.
 */
function afterBytes(armed: () => boolean, then: () => Promise<void>): CoreHost {
	const core = testHost();
	let done = false;
	return answeringHost(core, (command) => {
		if (command.cmd !== "encrypt" || done || !armed()) return undefined;
		done = true;
		return core.handle({ ...command, cmd: "encrypt" }).then(async (made) => {
			await then();
			return made;
		});
	});
}

/** Ana's and Bo's first devices in their DM, whose group Ana made; every request the fake saw goes to `seen` first. */
async function dm(given: { seen?: (request: Request) => void; aHears?: (event: GatewayEvent) => boolean } = {}) {
	const fake = new FakeApi();
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	useFake(fake, given.seen);
	const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
	const a = await firstDevice(fake, ana, { hears: given.aHears });
	const b = await firstDevice(fake, bo);
	await a.engine.openConversation(conversation);
	await sameGroup([a, b], conversation);
	return { fake, ana, bo, a, b, conversation };
}

/**
 * Ana's first device and a second one it approved (her list's version 2), Bo's first device, their DM's group, and a
 * message of Bo's that both of Ana's devices hold. `older` is Ana's identity as the API served it before her second
 * device was listed: a list a server could serve again.
 */
async function anaWithTwoDevices(seen?: (request: Request) => void) {
	const fake = new FakeApi();
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	useFake(fake, seen);
	const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
	const a1 = await firstDevice(fake, ana);
	const older = await a1.api.identity(ana);
	const a2 = await approvedDevice(fake, a1);
	const b = await firstDevice(fake, bo);
	await a1.engine.openConversation(conversation);
	await sameGroup([a1, a2, b], conversation);
	const kept = await send(b, conversation, "kept");
	await until(async () => (await textOn(a2, conversation, kept.id)) === "kept");
	return { fake, ana, bo, a1, a2, b, conversation, older, message: kept.id };
}

/** The API serves the user's identity as `served` from now on (none for null), to everyone, by both of its routes. */
function serveAs(fake: FakeApi, user: string, served: Identity | null) {
	fake.servedAs = (view) => (view.user_id === user ? structuredClone(served) : view);
}

/** The server tells the user's devices their identity changed, whatever it serves. */
const identityUpdate = (fake: FakeApi, user: string, served: Identity) =>
	fake.tell(user, {
		type: "IDENTITY_UPDATE",
		data: { user_id: user, identity_key: served.identity_key, device_list_version: served.device_list_version },
	});

/**
 * Counts the device lists put up, and fails each past the third: a device that puts its list up again and again, on a
 * fake whose answers come at once, never yields to a timer, and the test's own time limit couldn't end it.
 */
function listPuts() {
	const puts: string[] = [];
	const seen = (request: Request) => {
		if (said(request) !== `${DEVICE_LIST.method} ${DEVICE_LIST.path}`) return;
		puts.push(said(request));
		if (puts.length > 3) throw new TypeError("fetch failed: this list went up three times already");
	};
	return { puts, seen };
}

describe.skipIf(!coreLibrary)("a list the server hides or rolls back is refused", () => {
	// «Arranque», step 5, and the core's observe_user: a list older than the one the device holds is `older_list`, and
	// the device keeps its own, which names it. Ruling 26 starts over only a device the API never listed; decision 13: a
	// device's data goes on the person's word alone.
	test(
		"an older list of the user's own, from before this device was listed, leaves it ready with what it holds",
		async () => {
			const { puts, seen } = listPuts();
			const { fake, ana, a2, conversation, older, message } = await anaWithTwoDevices(seen);
			const device = (await statusOf(a2)).device_id;
			serveAs(fake, ana, older);
			// And a server that lies there too: whatever list this device puts up, another won.
			const lost = { error: "device list changed", device_list: older.device_list, version: older.device_list_version };
			fake.refuse(DEVICE_LIST, 409, lost, {}, Infinity);
			const before = puts.length;
			const again = await restarted(fake, a2);
			expect(again.engine.state).toEqual({ name: "ready" });
			expect((await statusOf(again)).device_id).toBe(device);
			expect(await textOn(again, conversation, message)).toBe("kept");
			expect(puts.slice(before)).toEqual([]);
			await again.engine.stop();
		},
		SLOW,
	);

	test(
		"an older list whose device's own list the API takes again isn't put up again and again",
		async () => {
			const { puts, seen } = listPuts();
			const { fake, ana, a2, conversation, older, message } = await anaWithTwoDevices(seen);
			serveAs(fake, ana, older);
			const before = puts.length;
			// The API takes the list it holds again (200), and still serves the older one.
			const again = await restarted(fake, a2);
			expect(again.engine.state).toEqual({ name: "ready" });
			expect(await textOn(again, conversation, message)).toBe("kept");
			expect(puts.slice(before)).toEqual([]);
			await again.engine.stop();
		},
		SLOW,
	);

	test(
		"an older list heard of while ready changes nothing, and the device reads on",
		async () => {
			const { fake, ana, a2, b, conversation, older } = await anaWithTwoDevices();
			serveAs(fake, ana, older);
			identityUpdate(fake, ana, older);
			await turnEnded(a2);
			expect(a2.engine.state).toEqual({ name: "ready" });
			const next = await send(b, conversation, "after the lie");
			await until(async () => (await textOn(a2, conversation, next.id)) === "after the lie");
		},
		SLOW,
	);

	// The approving device and a contact hold the newer list too: neither takes the approved device out on the older one.
	test(
		"a device the person approved stays in the approver's and a contact's groups when its list is rolled back",
		async () => {
			const { fake, ana, a1, a2, b, conversation, older } = await anaWithTwoDevices();
			const approved = (await statusOf(a2)).device_id!;
			serveAs(fake, ana, older);
			identityUpdate(fake, ana, older);
			const [a1Again, bAgain] = [await restarted(fake, a1), await restarted(fake, b)];
			await bAgain.engine.openConversation(conversation);
			const next = await send(bAgain, conversation, "to every device of Ana's");
			await until(async () => (await textOn(a2, conversation, next.id)) === "to every device of Ana's");
			for (const device of [a1Again, bAgain]) {
				expect((await groupOf(device, conversation))!.devices.map((one) => one.device_id)).toContain(approved);
			}
			expect(a1Again.engine.state).toEqual({ name: "ready" });
		},
		SLOW,
	);

	// observe_user of the user's own: an identity this device doesn't hold is not_own_identity, which the inbox may
	// explain with a transfer; without one, the plan says the device is off the list (removed). It takes none of it.
	test(
		"another user's identity served as the user's own takes nothing from the device",
		async () => {
			const { fake, ana, bo, a1, conversation, message } = await anaWithTwoDevices();
			const own = await statusOf(a1);
			const bos = await a1.api.identity(bo);
			serveAs(fake, ana, { ...bos, user_id: ana });
			const again = await restarted(fake, a1);
			expect(["ready", "removed"]).toContain(again.engine.state.name);
			const now = await statusOf(again);
			expect([now.device_id, now.identity_key]).toEqual([own.device_id, own.identity_key]);
			expect(await textOn(again, conversation, message)).toBe("kept");
		},
		SLOW,
	);

	// A 404 says the user has no identity: a first device's. A device whose core holds the one the API took is none,
	// and makes no second identity (the core refuses): withholding it is the server's right, starting over the person's.
	test(
		"no identity served leaves a device that holds one as it was, then another served elsewhere deletes nothing",
		async () => {
			const { fake, ana, a2, conversation, message } = await anaWithTwoDevices();
			const own = await statusOf(a2);
			serveAs(fake, ana, null);
			const again = await restarted(fake, a2);
			expect(again.engine.state).toEqual({ name: "ready" });
			expect(await textOn(again, conversation, message)).toBe("kept");
			// Then another device of Ana's starts over, and the API serves its identity: this one is off that list, and
			// what it holds stays until the person's word.
			fake.servedAs = (view) => view;
			const other = testDevice(fake, ana);
			await other.engine.start();
			await other.engine.stop();
			await other.host.open(ana);
			await resetFrom(other);
			await until(() => again.engine.state.name === "removed");
			expect((await statusOf(again)).device_id).toBe(own.device_id);
			expect(await textOn(again, conversation, message)).toBe("kept");
		},
		SLOW,
	);
});

// A case the plan's list implies: «Estados» says a device is removed when another device took it off the list, which
// the signed list proves. DEVICE_REMOVE is the server's word alone, which the engine takes as it comes, for an honest
// removal ends the device's sessions at once and would leave nothing to check it with. The limit, pinned: the server
// can make a listed device say it was removed until its next start, which finds it listed; what it holds stays, unless
// the person starts it over on that word.
describe.skipIf(!coreLibrary)("a removal only the server says of deletes nothing", () => {
	test(
		"a DEVICE_REMOVE of a device still listed shows it removed until its next start, which finds it ready",
		async () => {
			const { fake, ana, a1, conversation, message } = await anaWithTwoDevices();
			const device = (await statusOf(a1)).device_id!;
			fake.tell(ana, { type: "DEVICE_REMOVE", data: { device_id: device } });
			await turnEnded(a1);
			expect(a1.engine.state).toEqual({ name: "removed" });
			const again = await restarted(fake, a1);
			expect(again.engine.state).toEqual({ name: "ready" });
			expect((await statusOf(again)).device_id).toBe(device);
			expect(await textOn(again, conversation, message)).toBe("kept");
		},
		SLOW,
	);
});

describe.skipIf(!coreLibrary)("an event repeated or reordered is applied once, in order", () => {
	// Review Focus 4: the number decides. What's repeated is skipped, a gap asks for the queue, and the queue's pages and
	// the events meet in one order: messages, an edit and a deletion, beside the commits sync.test.ts holds.
	test(
		"messages, an edit and a deletion heard late, backwards and twice end as their author left them",
		async () => {
			const { fake, a, b, conversation } = await dm();
			fake.holdEvents();
			const first = await send(b, conversation, "first");
			const second = await send(b, conversation, "second");
			await b.engine.editMessage(conversation, first.id, "first, edited");
			await b.engine.deleteMessage(conversation, second.id);
			// The edit and the deletion come first, twice: Ana's device reads what they leave out from the queue.
			const changes = (event: GatewayEvent) => event.type === "DM_MESSAGE_UPDATE" || event.type === "DM_MESSAGE_DELETE";
			fake.releaseEvents({ only: changes, order: "reverse", repeat: true });
			await until(async () => (await textOn(a, conversation, first.id)) === "first, edited");
			// Then the messages themselves, backwards and twice, long after.
			fake.releaseEvents({ order: "reverse", repeat: true });
			await turnEnded(a);
			const [shown] = await a.engine.messages(conversation, [first.id]);
			expect(shown).toMatchObject({ status: "ok", text: "first, edited" });
			expect(shown?.edited_at).toBeTruthy();
			expect(await a.engine.messages(conversation, [second.id])).toEqual([]);
			expect(fake.decryptFailures).toEqual([]);
			expect((await groupOf(a, conversation))!.blocked).toBe(false);
		},
		SLOW,
	);

	// «El buzón»: each message is handled, then deleted. An inbox that keeps them (its DELETE answered, nothing deleted)
	// serves them again at every round: each one's work is done once.
	test(
		"an inbox served again and again, and DEVICE_MESSAGE heard twice, take a rotation's transfer once",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a1 = await firstDevice(fake, ana);
			const a2 = await approvedDevice(fake, a1);
			fake.refuse(INBOX, 204, undefined, {}, Infinity);
			await a1.engine.changeKeys();
			await a1.engine.keySaved();
			const rotated = (await a1.api.identity(ana)).identity_key;
			await until(async () => (await statusOf(a2)).identity_key === rotated);
			const device = (await statusOf(a2)).device_id!;
			for (let round = 0; round < 2; round++) {
				fake.tell(ana, { type: "DEVICE_MESSAGE", data: { device_id: device } }, device);
				fake.tell(ana, { type: "DEVICE_MESSAGE", data: { device_id: device } }, device);
				a2.connect(device);
				await turnEnded(a2);
			}
			expect(a2.engine.state).toEqual({ name: "ready" });
			expect((await statusOf(a2)).identity_key).toBe(rotated);
		},
		SLOW,
	);
});

describe.skipIf(!coreLibrary)("an entry served twice with other bytes is refused", () => {
	// Review Focus 4 and the core's apply: an entry under a number already applied is skipped, whatever it holds.
	test(
		"another entry heard under a number the device applied changes nothing there",
		async () => {
			const { fake, ana, a, b, conversation } = await dm();
			const first = await send(b, conversation, "first");
			const second = await send(b, conversation, "second");
			await until(async () => (await textOn(a, conversation, second.id)) === "second");
			// The server tells Ana's device that the first message's number holds the second's bytes.
			fake.tell(ana, { type: "DM_MESSAGE_CREATE", data: { ...first, ciphertext: second.ciphertext } });
			await turnEnded(a);
			expect(await textOn(a, conversation, first.id)).toBe("first");
			expect(await textOn(a, conversation, second.id)).toBe("second");
			expect(fake.decryptFailures).toEqual([]);
		},
		SLOW,
	);

	// The core's apply counts every entry in the group, one it can't open too: the first copy of a number that comes is
	// the one it applies. A changed copy opens nothing and shows no other text, and the queue's own copy, under that
	// number, is skipped: its message waits, as if the server withheld it, which it could as well with a changed copy in
	// both. The device goes on.
	test(
		"a changed copy heard first takes its number: the queue's own copy is skipped, and its message waits",
		async () => {
			let deaf = false;
			const { fake, ana, a, b, conversation } = await dm({ aHears: () => !deaf });
			deaf = true;
			const first = await send(b, conversation, "first");
			deaf = false;
			const bytes = base64Bytes(first.ciphertext!);
			const last = bytes.length - 1;
			bytes[last] = (bytes[last] ?? 0) ^ 1;
			fake.tell(ana, { type: "DM_MESSAGE_CREATE", data: { ...first, ciphertext: bytesBase64(bytes) } });
			await turnEnded(a);
			const second = await send(b, conversation, "second");
			await until(async () => (await textOn(a, conversation, second.id)) === "second", { what: "the next message" });
			expect(await a.engine.messages(conversation, [first.id])).toMatchObject([{ status: "waiting" }]);
			expect((await groupOf(a, conversation))!.blocked).toBe(false);
		},
		SLOW,
	);
});

describe.skipIf(!coreLibrary)("a group whose external sender isn't the API's is refused", () => {
	// The core's contract: the API is the groups' one external sender, and the clients take only removals from it,
	// signed with its key. A welcome under another key: failures.test.ts' «another external sender is refused, and the
	// pinned one stays».
	// «El motor», its external sender: the client pins the key the first time it sees it, and a different one is a
	// warning, never a change (Ruling 32).
	test(
		"another key served after the pinned one, and a removal proposed under it, take no one out, and the group goes on",
		async () => {
			const { fake, a, b, conversation } = await dm();
			const pinned = fake.externalSender;
			expect(a.engine.serverKeyChanged).toBe(false);
			const bos = (await statusOf(b)).device_id!;
			const other = generateKeyPairSync("ed25519");
			fake.externalSender = Buffer.from(other.publicKey.export({ format: "jwk" }).x!, "base64url").toString("base64");
			const again = await restarted(fake, a);
			expect(again.store.read<string>("external_sender")).toBe(pinned);
			// A notice, never a change (#575, M5): the person is told while it's served.
			expect(again.engine.serverKeyChanged).toBe(true);
			fake.proposeRemoval(conversation, bos, other.privateKey);
			await turnEnded(again);
			await turnEnded(b);
			const next = await send(again, conversation, "still here");
			await until(async () => (await textOn(b, conversation, next.id)) === "still here");
			const held = await sameGroup([again, b], conversation);
			expect(held.blocked).toBe(false);
			expect(held.devices.map((one) => one.device_id)).toContain(bos);
			expect(again.engine.conversationState(conversation)).toBeNull();
		},
		SLOW,
	);
});

describe.skipIf(!coreLibrary)("a new conversation's group holds only whom its people account for", () => {
	// #574: a device founds a group only with members it can account for. Its creator, with itself and the person's
	// picks, of the kind they asked for: the API's listing gives their order, never who they are or the kind.
	test(
		"the API lists a third member to the creator's engine, and no group with them is founded",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const claimed: string[] = [];
			useFake(fake, (request) => {
				const claim = /^\/api\/users\/([^/]+)\/key-packages\/claim$/.exec(new URL(request.url).pathname);
				if (claim?.[1]) claimed.push(claim[1]);
			});
			const a = await firstDevice(fake, ana);
			await firstDevice(fake, bo);
			await firstDevice(fake, eve);
			// The server hands out Eve's key packages to Ana, as to a friend of hers.
			fake.befriend(ana, eve);
			// The page's request is answered as asked; the engine's listings after it make each a group Ana owns, with Eve.
			fake.conversationsAs = (view, viewer) => {
				if (viewer !== ana || view.members.some((member) => member.user_id === eve)) return view;
				const added = { ...view.members[0]!, id: crypto.randomUUID(), user_id: eve };
				return { ...view, type: 2, owner_id: ana, members: [...view.members, added] };
			};
			const made = [
				await a.engine.createConversation({ type: 1, user_id: bo }),
				await a.engine.createConversation({ type: 2, name: "the two of them", user_ids: [bo] }),
			];
			await turnEnded(a);
			for (const { id } of made) {
				expect(await groupOf(a, id)).toBeNull();
				expect(a.engine.conversationState(id)).toMatchObject({ name: "members_changed" });
			}
			expect(claimed).not.toContain(eve);
		},
		SLOW,
	);

	// #574, as both apps hold it: a device without a record (the owner's other device) founds with the conversation as
	// its page draws it, which the person sees. A listing that differs from it founds nothing, and says so.
	test(
		"a device without a record founds with the conversation as drawn, and nothing when the listing differs from it",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const claimed: string[] = [];
			useFake(fake, (request) => {
				const claim = /^\/api\/users\/([^/]+)\/key-packages\/claim$/.exec(new URL(request.url).pathname);
				if (claim?.[1]) claimed.push(claim[1]);
			});
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			fake.befriend(ana, eve);
			let drawn: Conversation[] = [];
			const a = await firstDevice(fake, ana, { shown: async (id) => drawn.find((conv) => conv.id === id) ?? null });
			const b = await firstDevice(fake, bo);
			await firstDevice(fake, eve);
			drawn = await a.api.conversations();
			// The engine's listings add Eve; the page draws the group as the API made it.
			fake.conversationsAs = (view, viewer) => {
				if (viewer !== ana || view.id !== conversation) return view;
				return { ...view, members: [...view.members, { ...view.members[0]!, id: crypto.randomUUID(), user_id: eve }] };
			};
			await a.engine.openConversation(conversation);
			expect(await groupOf(a, conversation)).toBeNull();
			expect(a.engine.conversationState(conversation)).toMatchObject({ name: "members_changed" });
			expect(claimed).not.toContain(eve);
			// Listed as drawn again, the group is founded with the people the page shows.
			fake.conversationsAs = (view) => view;
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			expect((await groupOf(a, conversation))!.members.map((member) => member.user_id).sort()).toEqual(
				[ana, bo].sort(),
			);
		},
		SLOW,
	);

	// Its own list is held to what the person sees, not to the engine's listing: a page that draws the conversation
	// without someone its group holds says so, whatever the API lists to the engine.
	test(
		"a group that holds someone its page doesn't draw says so, whatever the engine's listing has",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			let drawn: Conversation[] = [];
			// Bo's page draws Eve's group as a DM between Ana and him; the engine's listing is the API's own.
			const shown = async (id: string) => {
				const conv = drawn.find((one) => one.id === id);
				return conv && { ...conv, type: 1 as const, members: conv.members.filter((m) => m.user_id !== eve) };
			};
			const b = await firstDevice(fake, bo, { shown: async (id) => (await shown(id)) ?? null });
			const e = await firstDevice(fake, eve);
			const { id } = await e.engine.createConversation({ type: 2, name: "three", user_ids: [ana, bo] });
			drawn = await b.api.conversations();
			await b.engine.openConversation(id);
			await until(() => b.engine.conversationState(id)?.name === "other_members", {
				what: "Bo's conversation saying whom its group holds",
			});
			expect(await rejection(send(b, id, "for Ana alone"))).toMatchObject({ code: "other_members" });
			expect((await e.api.queue(id, 0)).entries.filter((entry) => entry.kind === "message")).toEqual([]);
		},
		SLOW,
	);

	// Nothing more goes there: an edit and a deletion asked for while the group holds someone the conversation as drawn
	// doesn't show are refused, made nowhere, as Android refuses them (R-C1's twins).
	test(
		"an edit and a deletion asked for while the group holds someone its page doesn't draw are refused",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const changes: string[] = [];
			useFake(fake, (request) => {
				const change = request.method === "PATCH" || request.method === "DELETE";
				if (change && /\/messages\/[^/]+$/.test(new URL(request.url).pathname)) changes.push(request.method);
			});
			let drawn: Conversation[] = [];
			let hidden = false;
			const shown = async (id: string) => {
				const conv = drawn.find((one) => one.id === id) ?? null;
				return conv && hidden ? { ...conv, members: conv.members.filter((m) => m.user_id !== eve) } : conv;
			};
			const b = await firstDevice(fake, bo, { shown });
			const e = await firstDevice(fake, eve);
			const { id } = await e.engine.createConversation({ type: 2, name: "three", user_ids: [ana, bo] });
			drawn = await b.api.conversations();
			await b.engine.openConversation(id);
			await sameGroup([b, e], id);
			const [first, second] = [await send(b, id, "first"), await send(b, id, "second")];
			// From now on Bo's page draws the group without Eve.
			hidden = true;
			expect(await rejection(b.engine.editMessage(id, first.id, "edited"))).toMatchObject({ code: "other_members" });
			expect(await rejection(b.engine.deleteMessage(id, second.id))).toMatchObject({ code: "other_members" });
			await turnEnded(b);
			expect(changes).toEqual([]);
			expect(b.engine.conversationState(id)).toMatchObject({ name: "other_members" });
			expect(await textOn(b, id, first.id)).toBe("first");
			expect(await textOn(b, id, second.id)).toBe("second");
		},
		SLOW,
	);

	// The group's own list (#574): a device that joins by a welcome can't check who founded it. Whoever its core's group
	// holds that the conversation doesn't (a user, a kind, an owner) is said before anything more goes there.
	test(
		"a welcome whose group holds a user the conversation doesn't: the conversation says so and sends nothing",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			// To Bo, the group Eve makes is a DM between Ana and him.
			fake.conversationsAs = (view, viewer) =>
				viewer === bo && view.owner_id === eve
					? { ...view, type: 1, owner_id: ana, members: view.members.filter((member) => member.user_id !== eve) }
					: view;
			const b = await firstDevice(fake, bo);
			const e = await firstDevice(fake, eve);
			const { id } = await e.engine.createConversation({ type: 2, name: "three", user_ids: [ana, bo] });
			await until(async () => (await groupOf(b, id)) !== null, { what: "Bo's device in Eve's group" });
			await until(() => b.engine.conversationState(id)?.name === "other_members", {
				what: "Bo's conversation saying who its group holds",
			});
			expect(b.engine.conversationState(id)).toEqual({ name: "other_members", users: [eve, ana, bo] });
			expect(await rejection(send(b, id, "for Ana alone"))).toMatchObject({ code: "other_members" });
			expect((await e.api.queue(id, 0)).entries.filter((entry) => entry.kind === "message")).toEqual([]);
		},
		SLOW,
	);

	// N-M10: the yes is to the people its question named, whom this device would go in with: the founding after it goes
	// with exactly them, and a listing that changed meanwhile asks again, naming its own. Nothing goes to whom it adds.
	test(
		"the yes to members_changed takes the people it named, and a listing that changed asks again",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, cy, eve] = [fake.addUser(), fake.addUser(), fake.addUser(), fake.addUser()];
			const claimed: string[] = [];
			useFake(fake, (request) => {
				const claim = /^\/api\/users\/([^/]+)\/key-packages\/claim$/.exec(new URL(request.url).pathname);
				if (claim?.[1]) claimed.push(claim[1]);
			});
			for (const user of [bo, cy, eve]) fake.befriend(ana, user);
			const a = await firstDevice(fake, ana);
			for (const user of [bo, cy, eve]) await firstDevice(fake, user);
			let more = [cy];
			// The API lists Ana's new group with more members than she picked.
			fake.conversationsAs = (view, viewer) => {
				if (viewer !== ana || view.type !== 2 || view.owner_id !== ana) return view;
				const added = more.map((user) => ({ ...view.members[0]!, id: crypto.randomUUID(), user_id: user }));
				return { ...view, members: [...view.members, ...added] };
			};
			const { id } = await a.engine.createConversation({ type: 2, name: "two", user_ids: [bo] });
			const asked = a.engine.conversationState(id);
			if (asked?.name !== "members_changed") throw new Error("Ana's device asked nothing");
			// Before the yes, the listing adds Eve too: the yes to Ana, Bo and Cy doesn't take her in.
			more = [cy, eve];
			await a.engine.acceptMembers(id, asked.people);
			expect(claimed).not.toContain(eve);
			expect(await groupOf(a, id)).toBeNull();
			expect(asked.people).toEqual({ owner: ana, members: [ana, bo, cy] });
			expect(a.engine.conversationState(id)).toEqual({
				name: "members_changed",
				people: { owner: ana, members: [ana, bo, cy, eve] },
			});
			expect(claimed).not.toContain(eve);
		},
		SLOW,
	);

	// The record outlives the app: a restart between the creation and the founding reads the person's picks back from the
	// store (a new page's, with nothing of the session's), and the founding is held to them still.
	test(
		"a restart before the founding reads the person's picks back from the store, and founds with them alone",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const claimed: string[] = [];
			useFake(fake, (request) => {
				const claim = /^\/api\/users\/([^/]+)\/key-packages\/claim$/.exec(new URL(request.url).pathname);
				if (claim?.[1]) claimed.push(claim[1]);
			});
			for (const user of [bo, eve]) fake.befriend(ana, user);
			const a = await firstDevice(fake, ana);
			const b = await firstDevice(fake, bo);
			await firstDevice(fake, eve);
			let lying = true;
			// The API lists Ana's new group with Eve in it, until her device has started again.
			fake.conversationsAs = (view, viewer) => {
				if (!lying || viewer !== ana || view.type !== 2 || view.owner_id !== ana) return view;
				return { ...view, members: [...view.members, { ...view.members[0]!, id: crypto.randomUUID(), user_id: eve }] };
			};
			const { id } = await a.engine.createConversation({ type: 2, name: "two", user_ids: [bo] });
			expect(a.engine.conversationState(id)).toMatchObject({ name: "members_changed" });
			// The app closes before anything is founded, and opens again on the same storage, a new page's.
			const reloaded: EngineStore = {
				read: (key) => a.store.read(key),
				write: (key, value) => a.store.write(key, value),
			};
			const again = await restarted(fake, a, { store: reloaded });
			await again.engine.openConversation(id);
			expect(await groupOf(again, id)).toBeNull();
			expect(claimed).not.toContain(eve);
			lying = false;
			await again.engine.openConversation(id);
			await sameGroup([again, b], id);
			expect((await groupOf(again, id))!.members.map((member) => member.user_id).sort()).toEqual([ana, bo].sort());
		},
		SLOW,
	);

	// The creator's device holds its record while it has no group: a welcome into a group with others than its picks,
	// and the join that would follow, find it held to them, and it goes in with nobody it didn't pick.
	test(
		"a creator's device whose record is kept takes no welcome into a group with other members",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			// The group Eve owns with Ana and Bo is, to Ana, the group she made with Bo.
			const conversation = fake.addConversation({ type: "group", members: [eve, ana, bo], owner: eve });
			fake.conversationsAs = (view, viewer) =>
				viewer === ana && view.id === conversation
					? { ...view, owner_id: ana, members: view.members.filter((member) => member.user_id !== eve) }
					: view;
			const a = await firstDevice(fake, ana);
			keepMade(a.store, conversation, { owner: ana, members: [ana, bo] });
			const [b, e] = [await firstDevice(fake, bo), await firstDevice(fake, eve)];
			await e.engine.openConversation(conversation);
			await sameGroup([b, e], conversation);
			await until(() => a.engine.conversationState(conversation)?.name === "members_changed", {
				what: "Ana's device refusing the welcome",
			});
			expect(await groupOf(a, conversation)).toBeNull();
			// Past the welcome: a READY takes it in by no external commit, nothing Ana sends goes there, and her yes to the
			// people the question names (as the API lists them to her) takes it into no group with anyone else.
			a.connect(a.registered.at(-1) ?? null);
			await turnEnded(a);
			expect(await groupOf(a, conversation)).toBeNull();
			expect(await rejection(send(a, conversation, "to Bo"))).toMatchObject({ code: "blocked" });
			await sayYes(a, conversation);
			await turnEnded(a);
			expect(await heldUsers(a, conversation)).not.toContain(eve);
			expect(await madeAt(e, conversation, ana, ["commit", "message"])).toEqual([]);
		},
		SLOW,
	);

	// A look whose drawing can't be read, as when the page's first listing fails at a start: nothing goes, what waits
	// stays, and it goes at a later READY once the page draws the conversation again.
	test(
		"a look whose page drawing fails sends nothing, and what waits goes at a later READY",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			let failing = false;
			let drawn: Conversation[] = [];
			const shown = async (id: string) => {
				if (failing) throw new Error("the page's listing failed");
				return drawn.find((conv) => conv.id === id) ?? null;
			};
			const a = await firstDevice(fake, ana);
			const b = await firstDevice(fake, bo, { shown });
			drawn = await b.api.conversations();
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			// A message waits, its request unanswered; then the page's drawing can't be read.
			fake.refuse({ method: "POST", path: messagesPath(conversation) }, 500);
			await rejection(send(b, conversation, "waits"));
			failing = true;
			b.connect(b.registered.at(-1) ?? null);
			await turnEnded(b);
			expect(await madeAt(a, conversation, bo, ["message"])).toEqual([]);
			expect(await b.engine.pendingMessages(conversation)).toHaveLength(1);
			failing = false;
			b.connect(b.registered.at(-1) ?? null);
			await until(async () => (await madeAt(a, conversation, bo, ["message"])).length === 1, {
				what: "what waited going at the READY",
			});
			expect(await b.engine.pendingMessages(conversation)).toEqual([]);
		},
		SLOW,
	);

	// The review's untested case: an external join, not a welcome, into a group that holds someone the page doesn't draw.
	// The server's account founds it, and Bo's first device comes in after, by an external commit of its own: what's sent
	// there waits, and nothing goes.
	test(
		"an external join into a group that holds someone the page doesn't draw: what's sent there waits",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "group", members: [eve, ana, bo], owner: eve });
			fake.conversationsAs = (view, viewer) =>
				viewer === bo && view.id === conversation
					? { ...view, owner_id: ana, members: view.members.filter((member) => member.user_id !== eve) }
					: view;
			const [e, a] = [await firstDevice(fake, eve), await firstDevice(fake, ana)];
			await madeHere(e, conversation);
			await e.engine.openConversation(conversation);
			await sameGroup([e, a], conversation);
			const b = await firstDevice(fake, bo);
			await sameGroup([e, a, b], conversation);
			expect(await madeAt(e, conversation, bo, ["commit"])).toHaveLength(1);
			await until(() => b.engine.conversationState(conversation)?.name === "other_members", {
				what: "Bo's conversation saying whom its group holds",
			});
			expect(await rejection(send(b, conversation, "for Ana"))).toMatchObject({ code: "other_members" });
			expect(await madeAt(e, conversation, bo, ["message"])).toEqual([]);
		},
		SLOW,
	);

	// N-C1: the check holds whatever the listings leave out. The API stops listing the conversation after the welcome;
	// the page goes on drawing it as READY's list did: what waits there doesn't go at the next start, nor anything new.
	test(
		"a conversation the API stops listing is held to what its page still draws: nothing goes there, at a start either",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			let unlisted = false;
			// To Bo, the group Eve makes is a DM between Ana and him, until the API leaves it out of his listings.
			fake.conversationsAs = (view, viewer) => {
				if (viewer !== bo || view.owner_id !== eve) return view;
				if (unlisted) return null;
				return { ...view, type: 1, owner_id: ana, members: view.members.filter((member) => member.user_id !== eve) };
			};
			let drawn: Conversation[] = [];
			const shown = async (id: string) => drawn.find((conv) => conv.id === id) ?? null;
			const b = await firstDevice(fake, bo, { shown });
			const e = await firstDevice(fake, eve);
			const { id } = await e.engine.createConversation({ type: 2, name: "three", user_ids: [ana, bo] });
			drawn = await b.api.conversations();
			await until(async () => (await groupOf(b, id)) !== null, { what: "Bo's device in Eve's group" });
			// One waits there, refused.
			expect(await rejection(send(b, id, "waits"))).toMatchObject({ code: "other_members" });
			unlisted = true;
			const again = await restarted(fake, b, { shown });
			await turnEnded(again);
			expect(await rejection(send(again, id, "for Ana alone"))).toMatchObject({ code: "other_members" });
			// And at a READY, which sends what waits again.
			again.connect(again.registered.at(-1) ?? null);
			await turnEnded(again);
			expect((await e.api.queue(id, 0)).entries.filter((entry) => entry.kind === "message")).toEqual([]);
		},
		SLOW,
	);

	// N-I1: a DM is exactly the person and the one its view shows. The server serves, as Bo's DM with Ana, a DM group of
	// Bo and Eve, and lists Eve in the DM Bo's page draws, whose title names Ana: nothing goes there.
	test(
		"a DM drawn with a third member is held to its two people: what goes there waits",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			fake.befriend(bo, eve);
			// To Bo, Eve's DM with him is his DM with Ana, its members Ana's first, as its title names her.
			fake.conversationsAs = (view, viewer) => {
				if (viewer !== bo || view.type !== 1 || !view.members.some((member) => member.user_id === eve)) return view;
				return { ...view, members: [{ ...view.members[0]!, id: crypto.randomUUID(), user_id: ana }, ...view.members] };
			};
			const b = await firstDevice(fake, bo);
			const e = await firstDevice(fake, eve);
			const { id } = await e.engine.createConversation({ type: 1, user_id: bo });
			await until(async () => (await groupOf(b, id)) !== null, { what: "Bo's device in Eve's DM" });
			await until(() => b.engine.conversationState(id)?.name === "other_members", {
				what: "Bo's DM saying whom its group holds",
			});
			expect(await rejection(send(b, id, "for Ana alone"))).toMatchObject({ code: "other_members" });
			expect((await e.api.queue(id, 0)).entries.filter((entry) => entry.kind === "message")).toEqual([]);
		},
		SLOW,
	);

	// N-I2: on the web each tab draws from its own READY, and the one that leads sends for the others. What another tab
	// sends, edits or deletes carries the people it draws: the delivery is held to them too, its own drawing aside.
	test(
		"what another tab sends, edits or deletes is held to the people that tab draws too",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const changes: string[] = [];
			useFake(fake, (request) => {
				const change = request.method === "PATCH" || request.method === "DELETE";
				if (change && /\/messages\/[^/]+$/.test(new URL(request.url).pathname)) changes.push(request.method);
			});
			const b = await firstDevice(fake, bo);
			const e = await firstDevice(fake, eve);
			const { id } = await e.engine.createConversation({ type: 2, name: "three", user_ids: [ana, bo] });
			await b.engine.openConversation(id);
			await sameGroup([b, e], id);
			const first = await send(b, id, "first");
			// Bo's other tab draws the group without Eve.
			const listed = (await b.api.conversations()).find((conv) => conv.id === id)!;
			const drawn = { ...listed, members: listed.members.filter((member) => member.user_id !== eve) };
			const sent = b.engine.sendMessage({ conversation_id: id, nonce: crypto.randomUUID(), text: "for Ana", drawn });
			expect(await rejection(sent)).toMatchObject({ code: "other_members" });
			const edited = b.engine.editMessage(id, first.id, "edited", drawn);
			expect(await rejection(edited)).toMatchObject({ code: "other_members" });
			expect(await rejection(b.engine.deleteMessage(id, first.id, drawn))).toMatchObject({ code: "other_members" });
			await turnEnded(b);
			expect(changes).toEqual([]);
			expect((await e.api.queue(id, 0)).entries.filter((entry) => entry.kind === "message")).toHaveLength(1);
		},
		SLOW,
	);

	// R-M1: what another tab carried outlives the leader's engine. A message that tab left waiting, and its edit kept
	// unanswered, are held to its drawing at the next leader's start too (here the same device's engine started again, on
	// the record the tabs share), whatever that leader's page draws.
	test(
		"what another tab left waiting is held to that tab's drawing after the leader's restart",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const changes: string[] = [];
			useFake(fake, (request) => {
				const change = request.method === "PATCH" || request.method === "DELETE";
				if (change && /\/messages\/[^/]+$/.test(new URL(request.url).pathname)) changes.push(request.method);
			});
			fake.befriend(ana, eve);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			const [a, b, e] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, eve)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			const first = await send(b, conversation, "first");
			// Bo's other tab draws the group as it is now: its edit is made, and finds no answer.
			const listed = (await b.api.conversations()).find((conv) => conv.id === conversation)!;
			const drawn = { type: listed.type, owner_id: listed.owner_id, members: listed.members };
			fake.refuse({ method: "PATCH", path: `${messagesPath(conversation)}/${first.id}` }, 500);
			await b.engine.editMessage(conversation, first.id, "edited", drawn);
			await turnEnded(b);
			// Ana adds Eve, whom that tab doesn't draw: what it sends now waits.
			await a.engine.addMember(conversation, eve);
			await sameGroup([a, b, e], conversation);
			const nonce = crypto.randomUUID();
			const sent = b.engine.sendMessage({ conversation_id: conversation, nonce, text: "for Ana", drawn });
			expect(await rejection(sent)).toMatchObject({ code: "other_members" });
			// The leader's engine starts again, its own page drawing Eve, and sends what waits at its READY and later.
			const again = await restarted(fake, b);
			await turnEnded(again);
			again.connect(again.registered.at(-1) ?? null);
			for (let round = 0; round < 4; round++) {
				again.clock.advance(60_000);
				await turnEnded(again);
			}
			expect(await madeAt(a, conversation, bo, ["message"])).toHaveLength(1);
			expect(changes).toEqual(["PATCH"]);
			expect((await again.engine.pendingMessages(conversation)).map((row) => row.nonce)).toEqual([nonce]);
		},
		SLOW,
	);

	// T-M3: what another tab left waiting goes first, so it holds what's sent after it. A Retry from the page that runs the
	// engine is the person's act on a page that draws the conversation: it takes the message over, as that tab's own
	// Retry would with its drawing, and what waited behind it goes after it.
	test(
		"a Retry from the engine's page takes over what another tab left waiting, freeing what's behind it",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			fake.befriend(ana, cy);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			const [a, b, c] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, cy)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			// Bo's other tab drew the group before Ana added Cy: what it sends waits for that drawing.
			const listed = (await b.api.conversations()).find((conv) => conv.id === conversation)!;
			const drawn = { type: listed.type, owner_id: listed.owner_id, members: listed.members };
			await a.engine.addMember(conversation, cy);
			await sameGroup([a, b, c], conversation);
			const theirs = { conversation_id: conversation, nonce: crypto.randomUUID(), text: "from the other tab" };
			expect(await rejection(b.engine.sendMessage({ ...theirs, drawn }))).toMatchObject({ code: "other_members" });
			const mine = { conversation_id: conversation, nonce: crypto.randomUUID(), text: "from here" };
			expect(await rejection(b.engine.sendMessage(mine))).toMatchObject({ code: "other_members" });
			// The engine's page retries the other tab's message: it goes, then what waited behind it, in the same flush.
			await b.engine.sendMessage(theirs);
			expect(await madeAt(a, conversation, bo, ["message"])).toHaveLength(2);
			expect(await b.engine.pendingMessages(conversation)).toEqual([]);
		},
		SLOW,
	);

	// One the record kept no writer for (a storage that refused it, or a version before writers) waits for its tab, and
	// holds what's sent after it; a Retry from the engine's page takes it over too.
	test(
		"a message kept with no writer waits for its tab, holding what's behind it, until a Retry from here",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const a = await firstDevice(fake, ana);
			const b = await firstDevice(fake, bo, { store: refusingStore(memoryStore(), PENDING_SENDS) });
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			fake.refuse({ method: "POST", path: messagesPath(conversation) }, 500);
			const first = { conversation_id: conversation, nonce: crypto.randomUUID(), text: "kept with no writer" };
			await rejection(b.engine.sendMessage(first));
			const again = await restarted(fake, b);
			await turnEnded(again);
			const next = { conversation_id: conversation, nonce: crypto.randomUUID(), text: "next" };
			expect(await rejection(again.engine.sendMessage(next))).toMatchObject({ code: "other_tab" });
			expect(await madeAt(a, conversation, bo, ["message"])).toEqual([]);
			// Its Retry here sends it, and what waited behind it after it, in the same flush (or one a READY began first).
			await again.engine.sendMessage(first);
			await turnEnded(again);
			expect(await madeAt(a, conversation, bo, ["message"])).toHaveLength(2);
			expect(await again.engine.pendingMessages(conversation)).toEqual([]);
		},
		SLOW,
	);

	// The one honest case: a member who left stays in the group until a member's commit takes them out, under the API's
	// proposal of their removal. It isn't said, and what goes there next commits that removal first.
	test(
		"a member who left and waits for their removal isn't said, and what's sent next goes once it's committed",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			const [a, b, c] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, cy)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b, c], conversation);
			const usersIn = async (device: TestDevice) =>
				(await groupOf(device, conversation))!.members.map((member) => member.user_id);
			// The members' clocks stand still: their due commit waits. Ana's device, started again, lists him gone.
			await c.engine.leaveConversation(conversation);
			const again = await restarted(fake, a);
			await turnEnded(again);
			expect(await usersIn(again)).toContain(cy);
			expect(again.engine.conversationState(conversation)).toBeNull();
			const sent = await send(again, conversation, "after Cy left");
			expect(await usersIn(again)).not.toContain(cy);
			await until(async () => (await textOn(b, conversation, sent.id)) === "after Cy left");
			expect(again.engine.conversationState(conversation)).toBeNull();
		},
		SLOW,
	);

	// The twins' rule, Android's: a removal that's due is committed inside the look, as a member's device would commit it.
	// A message that waited meanwhile goes at its next try, without a Retry, its bytes made after that commit.
	test(
		"a message that waits while a removal is due goes at a READY, its look committing the removal",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			const [a, b, c] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, cy)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b, c], conversation);
			// Bo's message waits, its request unanswered. Cy leaves; the devices' clocks stand still, so her removal is due.
			fake.refuse({ method: "POST", path: messagesPath(conversation) }, 500);
			await rejection(send(b, conversation, "after Cy left"));
			await c.engine.leaveConversation(conversation);
			await turnEnded(b);
			expect(await heldUsers(b, conversation)).toContain(cy);
			// A READY sends what waits: its look commits the removal first.
			b.connect(b.registered.at(-1) ?? null);
			await until(async () => (await madeAt(a, conversation, bo, ["message"])).length === 1, {
				ms: 20_000,
				what: "the waiting message going at the READY",
			});
			const after = (await groupOf(b, conversation))!;
			expect(after.members.map((member) => member.user_id)).not.toContain(cy);
			expect(await madeAt(a, conversation, bo, ["message"])).toEqual([
				{ kind: "message", generation: after.generation, epoch: after.epoch },
			]);
			expect(await b.engine.pendingMessages(conversation)).toEqual([]);
		},
		SLOW,
	);

	// N-M9: an honest removal the page draws before its commit reached this device. The queue is read whole before the
	// group is said to differ: what's sent goes, to the group as it is once the commit is in, and nothing is said.
	test(
		"a removal the page draws before its commit comes: the queue is read first, and what's sent goes",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			let muted = false;
			const a = await firstDevice(fake, ana);
			const b = await firstDevice(fake, bo, { hears: (event) => !(muted && event.type === "MLS_COMMIT") });
			const c = await firstDevice(fake, cy);
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b, c], conversation);
			// Bo's device doesn't hear the commit that takes Cy out; his page, listing again, draws the group without her.
			muted = true;
			await a.engine.removeMember(conversation, cy);
			const sent = await send(b, conversation, "after Cy left");
			await until(async () => (await textOn(a, conversation, sent.id)) === "after Cy left");
			expect((await groupOf(b, conversation))!.members.map((member) => member.user_id)).not.toContain(cy);
			expect(b.engine.conversationState(conversation)).toBeNull();
		},
		SLOW,
	);

	// #575 (M1): `expected` is this device's own record of a conversation, never the API's word. One the server writes on
	// a welcome holds nothing to it: a device without a record joins the group as founded.
	test(
		"an expected the API writes on a welcome holds the device to nothing",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			let deaf = false;
			const a = await firstDevice(fake, ana);
			const b = await firstDevice(fake, bo, { hears: (event) => !deaf || !event.type.startsWith("MLS_") });
			// Bo's device reads the welcome from the queue, where the server writes an `expected` of its own on it.
			fake.queueAs = (entry, _conversation, viewer) => {
				if (viewer !== bo || entry.kind !== "welcome") return entry;
				const lie = { ...entry, expected: { members: [bo, eve] } };
				return lie;
			};
			deaf = true;
			await a.engine.openConversation(conversation);
			const again = await restarted(fake, b);
			await sameGroup([a, again], conversation);
			expect(again.engine.conversationState(conversation)).toBeNull();
		},
		SLOW,
	);
});

describe.skipIf(!coreLibrary)("what goes is made for the group that was compared", () => {
	// R-C1: the look answers for the group as its read left it. What goes is made after that read, for that group, and
	// only a comparison that reads nothing runs between the bytes and their request; bytes the core kept from before the
	// group moved (it gives them back while the group is within 5 epochs of them) are made again. The server here takes
	// stale bytes, as it could: its 409 guards nothing.

	/** Ana's and Eve's devices in the group Eve's founded, of Eve (its owner), Ana and Bo: Bo's page draws it as Ana's
	 * group of Ana and him (from `hidden` on, when given). */
	async function evesGroup(hidden: () => boolean = () => true) {
		const fake = new FakeApi();
		fake.takesStale = true;
		const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
		useFake(fake);
		const conversation = fake.addConversation({ type: "group", members: [eve, ana, bo], owner: eve });
		fake.conversationsAs = (view, viewer) =>
			viewer === bo && view.id === conversation && hidden()
				? { ...view, owner_id: ana, members: view.members.filter((member) => member.user_id !== eve) }
				: view;
		const [e, a] = [await firstDevice(fake, eve), await firstDevice(fake, ana)];
		await madeHere(e, conversation);
		await e.engine.openConversation(conversation);
		await sameGroup([e, a], conversation);
		return { fake, ana, bo, eve, e, a, conversation };
	}

	/** Eve leaves, and Ana's device commits her removal, as the API proposes it. */
	async function eveLeaves(e: TestDevice, a: TestDevice, eve: string, conversation: string) {
		await e.engine.leaveConversation(conversation);
		await until(async () => (a.clock.advance(5_000), !(await heldUsers(a, conversation)).includes(eve)), {
			what: "Ana's device committing Eve's removal",
		});
	}

	/** What a promise settles to: null, or what it rejects with. */
	const outcome = (promise: Promise<unknown>) =>
		promise.then(
			() => null,
			(error: unknown) => error,
		);

	// Attack 1: Ana takes Cy out once Bo's device made his message's bytes, of the epoch that holds Cy. The server keeps
	// her commit from his device until his look reads the queue: the look passes on the group as it became.
	test(
		"a removal Bo's device reads only once its bytes are made: nothing of the epoch that held Cy goes",
		async () => {
			const fake = new FakeApi();
			fake.takesStale = true;
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			let deaf = false;
			const a = await firstDevice(fake, ana);
			const host = afterBytes(
				() => deaf,
				() => a.engine.removeMember(conversation, cy),
			);
			const b = await firstDevice(fake, bo, { host, hears: (event) => !(deaf && event.type.startsWith("MLS_")) });
			const c = await firstDevice(fake, cy);
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b, c], conversation);
			deaf = true;
			const sent = await send(b, conversation, "after Cy left");
			const after = (await groupOf(a, conversation))!;
			expect(await heldUsers(a, conversation)).not.toContain(cy);
			expect(await madeAt(a, conversation, bo, ["message"])).toEqual([
				{ kind: "message", generation: after.generation, epoch: after.epoch },
			]);
			expect(sent).toMatchObject({ generation: after.generation, epoch: after.epoch });
			await until(async () => (await textOn(a, conversation, sent.id)) === "after Cy left");
		},
		SLOW,
	);

	// Attack 2: the server's own account founds the group, and Bo's first device comes in by an external commit, into a
	// group that holds Eve. She leaves once his message's bytes are made, and Ana's device commits her removal, which the
	// server keeps from his device until his look reads it.
	test(
		"an external join into a group that holds Eve, her removal read by the look: nothing of her epoch goes",
		async () => {
			const { fake, bo, eve, e, a, conversation } = await evesGroup();
			let deaf = false;
			const host = afterBytes(
				() => deaf,
				() => eveLeaves(e, a, eve, conversation),
			);
			const b = await firstDevice(fake, bo, { host, hears: (event) => !(deaf && event.type.startsWith("MLS_")) });
			await sameGroup([e, a, b], conversation);
			expect(await madeAt(a, conversation, bo, ["commit"])).toHaveLength(1);
			expect(await heldUsers(b, conversation)).toContain(eve);
			deaf = true;
			const sent = await send(b, conversation, "for Ana");
			const after = (await groupOf(a, conversation))!;
			expect(await madeAt(a, conversation, bo, ["message"])).toEqual([
				{ kind: "message", generation: after.generation, epoch: after.epoch },
			]);
			expect(sent).toMatchObject({ generation: after.generation, epoch: after.epoch });
		},
		SLOW,
	);

	// An edit and a deletion asked for while the group holds someone the page doesn't draw: refused, made nowhere, as
	// nothing more goes there. Eve's removal comes after, read by the look of whatever Bo's device would try: nothing of
	// her epoch goes.
	test(
		"an edit or a deletion made while the group differs is never sent as made",
		async () => {
			let hidden = false;
			const { fake, bo, eve, e, a, conversation } = await evesGroup(() => hidden);
			let deaf = false;
			const b = await firstDevice(fake, bo, { hears: (event) => !(deaf && event.type.startsWith("MLS_")) });
			await sameGroup([e, a, b], conversation);
			const [first, second] = [await send(b, conversation, "first"), await send(b, conversation, "second")];
			// From now on Bo's page draws the group as Ana's, without Eve, and his device hears none of its commits.
			hidden = true;
			deaf = true;
			const edited = await outcome(b.engine.editMessage(conversation, first.id, "edited"));
			const deleted = await outcome(b.engine.deleteMessage(conversation, second.id));
			await eveLeaves(e, a, eve, conversation);
			const after = (await groupOf(a, conversation))!;
			for (let round = 0; round < 4; round++) {
				b.clock.advance(60_000);
				await turnEnded(b);
			}
			const made = await madeAt(a, conversation, bo, ["edit", "delete"]);
			expect(made.filter((entry) => entry.generation !== after.generation || entry.epoch < after.epoch)).toEqual([]);
			expect(edited).toMatchObject({ code: "other_members" });
			expect(deleted).toMatchObject({ code: "other_members" });
			expect(await textOn(b, conversation, first.id)).toBe("first");
			expect(await textOn(b, conversation, second.id)).toBe("second");
		},
		SLOW,
	);

	// Bytes kept from an epoch gone by: a message whose request had no answer, and an edit's. The group moves (Cy's
	// removal, which Bo's device applies as it comes), and what goes after is made again for the group as it is.
	test(
		"a message's or an edit's bytes made before the group moved are made again before they go",
		async () => {
			const fake = new FakeApi();
			fake.takesStale = true;
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			const [a, b, c] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, cy)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b, c], conversation);
			const first = await send(b, conversation, "first");
			// His next message and his edit find no answer.
			fake.refuse({ method: "POST", path: messagesPath(conversation) }, 500);
			fake.refuse({ method: "PATCH", path: `${messagesPath(conversation)}/${first.id}` }, 500);
			const message = { conversation_id: conversation, nonce: crypto.randomUUID(), text: "second" };
			await rejection(b.engine.sendMessage(message));
			await b.engine.editMessage(conversation, first.id, "edited");
			await a.engine.removeMember(conversation, cy);
			const after = await sameGroup([a, b], conversation);
			const sent = await b.engine.sendMessage(message);
			await until(async () => (b.clock.advance(2_000), (await madeAt(a, conversation, bo, ["edit"])).length > 0), {
				what: "Bo's edit",
			});
			const at = { generation: after.generation, epoch: after.epoch };
			expect(sent).toMatchObject(at);
			expect(await madeAt(a, conversation, bo, ["edit"])).toEqual([{ kind: "edit", ...at }]);
			await until(async () => (await textOn(a, conversation, first.id)) === "edited");
		},
		SLOW,
	);

	// A change the record kept from an earlier start, made again at the next while the group holds someone the page
	// doesn't draw: nothing is made then. What goes is made once the look passes, after Eve's removal, which the server
	// keeps from Bo's device until that look reads it.
	test(
		"a kept change made again at a start while the group differs goes with bytes made after the look",
		async () => {
			const fake = new FakeApi();
			fake.takesStale = true;
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			fake.befriend(ana, eve);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			fake.conversationsAs = (view, viewer) =>
				viewer === bo && view.id === conversation
					? { ...view, members: view.members.filter((member) => member.user_id !== eve) }
					: view;
			const [a, b, e] = [await firstDevice(fake, ana), await firstDevice(fake, bo), await firstDevice(fake, eve)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			const first = await send(b, conversation, "first");
			// His edit finds no answer, and his app closes; meanwhile Ana adds Eve, whom his page doesn't draw.
			fake.refuse({ method: "PATCH", path: `${messagesPath(conversation)}/${first.id}` }, 500);
			await b.engine.editMessage(conversation, first.id, "edited");
			await b.engine.stop();
			await a.engine.addMember(conversation, eve);
			await sameGroup([a, e], conversation);
			const again = await restarted(fake, b, { hears: (event) => !event.type.startsWith("MLS_") });
			await turnEnded(again);
			expect(await heldUsers(again, conversation)).toContain(eve);
			await eveLeaves(e, a, eve, conversation);
			const after = (await groupOf(a, conversation))!;
			await until(async () => (again.clock.advance(60_000), (await madeAt(a, conversation, bo, ["edit"])).length > 0), {
				what: "Bo's edit",
			});
			expect(await madeAt(a, conversation, bo, ["edit"])).toEqual([
				{ kind: "edit", generation: after.generation, epoch: after.epoch },
			]);
		},
		SLOW,
	);

	// The comparison after the bytes (`differs`): the look passed, and the page stopped drawing Eve while Bo's device made
	// the message's bytes, of the group that holds her. The look ran before; the bytes are of the group now: only the
	// comparison after them holds the message, as nothing more goes where the group holds someone the page doesn't draw.
	test(
		"someone the page stops drawing once the bytes are made holds them, though the look before passed",
		async () => {
			let hidden = false;
			const { fake, bo, e, a, conversation } = await evesGroup(() => hidden);
			// A core that, once armed, hides Eve from Bo's page right after it makes bytes again under a nonce it has: the
			// delivery's, after the look.
			let armed = false;
			const made = new Set<string>();
			const core = testHost();
			const host = answeringHost(core, (command) => {
				if (command.cmd !== "encrypt" || !armed) return undefined;
				const nonce = String(command.nonce);
				if (!made.has(nonce)) return void made.add(nonce);
				armed = false;
				return core.handle({ ...command, cmd: "encrypt" }).then((bytes) => {
					hidden = true;
					return bytes;
				});
			});
			const b = await firstDevice(fake, bo, { host });
			await sameGroup([e, a, b], conversation);
			armed = true;
			expect(await rejection(send(b, conversation, "for Ana"))).toMatchObject({ code: "other_members" });
			expect(await madeAt(a, conversation, bo, ["message"])).toEqual([]);
			expect(b.engine.conversationState(conversation)).toMatchObject({ name: "other_members" });
		},
		SLOW,
	);
});

describe.skipIf(!coreLibrary)("the server's deleted IDs delete nothing the client holds", () => {
	// The core's contract: a deletion is its author's tombstone (decision 16); backup_import's `deleted` erases only what
	// an import brought; and an entry the queue serves with `deleted` opens nothing. The device's files of it may go from
	// memory (task 18's review, M4), its row never.
	test(
		"a message the server lists as deleted, its author never having deleted it, stays where it's held",
		async () => {
			const { fake, ana, a, b, conversation } = await dm();
			const kept = await send(b, conversation, "kept");
			await until(async () => (await textOn(a, conversation, kept.id)) === "kept");
			fake.markDeleted(conversation, kept.id);
			const deleted = {
				...{ seq: kept.seq, kind: "message", data: "", deleted: true, sent_at: kept.sent_at, message_id: kept.id },
				...{ generation: kept.generation, epoch: kept.epoch, sender_user: kept.author_id },
				sender_device: kept.sender_device_id,
			};
			fake.tell(ana, {
				type: "DM_MESSAGE_DELETE",
				data: { id: kept.id, conversation_id: conversation, entry: deleted },
			});
			fake.tell(ana, { type: "DM_MESSAGE_DELETE", data: { id: kept.id, conversation_id: conversation } });
			await turnEnded(a);
			expect(await textOn(a, conversation, kept.id)).toBe("kept");
			expect((await a.api.deletedMessages(conversation)).ids).toContain(kept.id);
			const again = await restarted(fake, a);
			expect(await textOn(again, conversation, kept.id)).toBe("kept");
		},
		SLOW,
	);
});

describe.skipIf(!coreLibrary)("a hostile file name stays a name", () => {
	// Review Focus 7 and «Convenciones entre clientes»: the name is the sender's word, cleaned again as it's read: its
	// last part, without what hides what it is, 255 characters at most. Here the sender is hostile; the server only
	// carries the file. A view shows and saves a file by that name (SealedFile, saveFile), and Settings → Attachments
	// lists it (fileNames).
	test(
		"a sender's names with paths, unseen characters and bidirectional controls are shown and listed as names",
		async () => {
			const { a, b, conversation } = await dm();
			const names: [string, string][] = [
				["C:\\Users\\Ana\\Desktop\\evil.exe", "evil.exe"],
				["../../.ssh/authorized_keys", "authorized_keys"],
				["invoice\u202Efdp.exe", "invoicefdp.exe"],
				["zero\u200Bwidth\u2060word\uFEFF.txt", "zerowidthword.txt"],
				["line\u2028and\u2029paragraph.txt", "lineandparagraph.txt"],
				["nul\u0000bell\u0007tab\t.txt", "nulbelltab.txt"],
				["\u200B\u200C\u061C", "file"],
				["..", "file"],
				[`${"a".repeat(300)}.txt`, "a".repeat(MAX_FILE_NAME)],
			];
			const bytes = crypto.getRandomValues(new Uint8Array(16));
			const sent = await sendWritten(
				a,
				conversation,
				names.map(([name]) => ({ bytes, said: { name } })),
			);
			const files = await filesOn(b, conversation, sent.id);
			expect(files.map((file) => file.name)).toEqual(names.map(([, name]) => name));
			const listed = await b.engine.fileNames();
			expect(files.map((file) => listed.get(file.id))).toEqual(names.map(([, name]) => name));
		},
		SLOW,
	);
});

describe.skipIf(!coreLibrary)("a 2xx that stored nothing loses nothing", () => {
	// «Confirmar solo lo que el servidor tomó»: a confirmation follows a 2xx, which the client can't tell from a lie. What
	// it confirmed it keeps: nothing the person holds is lost, no second identity or key is made, and the device goes on.
	// One case per row of «Qué se manda y qué se le dice al núcleo»; the report says what the others cost.
	test(
		"an identity the API answered for and never kept stays on the device, which makes no second one",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a = testDevice(fake, ana);
			await a.engine.start();
			await a.engine.makeIdentity();
			expect(shownKey(a.engine.state)).not.toBeNull();
			fake.refuse(IDENTITY, 200, { identity_id: crypto.randomUUID(), device_list_version: 1 });
			await a.engine.keySaved();
			const made = await statusOf(a);
			expect(made.has_identity).toBe(true);
			// The person taps again: the core makes no second identity, so the key they saved stays this identity's.
			await a.engine.makeIdentity().catch(() => {});
			expect(shownKey(a.engine.state)).toBeNull();
			expect((await statusOf(a)).identity_key).toBe(made.identity_key);
			await a.engine.stop();
		},
		SLOW,
	);

	test(
		"a list the API answered for and never kept stays the device's, its removal holding",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			useFake(fake);
			const a1 = await firstDevice(fake, ana);
			const a2 = await approvedDevice(fake, a1);
			const second = (await statusOf(a2)).device_id!;
			await a2.engine.stop();
			fake.refuse(DEVICE_LIST, 200, { version: 3 });
			await a1.engine.removeDevice(second);
			expect(a1.engine.state).toEqual({ name: "ready" });
			// The API still lists it, and this device keeps the list it signed without it.
			expect((await a1.api.identity(ana)).device_list_version).toBe(2);
			const held = (await statusOf(a1)).device_list!;
			const again = await restarted(fake, a1);
			expect(again.engine.state).toEqual({ name: "ready" });
			expect((await statusOf(again)).device_list).toBe(held);
		},
		SLOW,
	);

	test(
		"key packages the API answered for and never kept leave the device to join by its own commit",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			// Bo's device's one upload as it starts.
			fake.refuse(KEY_PACKAGES, 200, { handed_out: [] });
			const b = await firstDevice(fake, bo);
			const a = await firstDevice(fake, ana);
			await a.engine.openConversation(conversation);
			const hello = await send(a, conversation, "hello");
			await until(async () => (await textOn(b, conversation, hello.id)) === "hello");
		},
		SLOW,
	);

	// The API's own answers from here on, with nothing kept and no event sent (forget).
	//
	// #553: the API's queue is the truth. A device whose group the API doesn't hold leaves its own (forget_group) and
	// takes the API's, made again where the API has none, and what its person typed goes in the group it ends in. The
	// rule's other cases are in «a group the API doesn't hold is let go for the API's».
	test(
		"a group the API answered for and never kept is made again, and what its maker typed goes in the group they end in",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const a = await firstDevice(fake, ana);
			const b = await firstDevice(fake, bo);
			fake.forget({ method: "POST", path: `/api/users/@me/conversations/${conversation}/mls/commits` });
			await a.engine.openConversation(conversation);
			const kept = await send(a, conversation, "kept here");
			await b.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			await until(async () => (await textOn(b, conversation, kept.id)) === "kept here", {
				what: "Ana's message read on Bo's device",
			});
		},
		SLOW,
	);

	test(
		"an edit the API answered for and never kept is its author's alone, and what follows goes",
		async () => {
			const { fake, a, b, conversation } = await dm();
			const message = await send(b, conversation, "as written");
			await until(async () => (await textOn(a, conversation, message.id)) === "as written");
			fake.forget({ method: "PATCH", path: `${messagesPath(conversation)}/${message.id}` });
			await b.engine.editMessage(conversation, message.id, "edited");
			expect(await textOn(b, conversation, message.id)).toBe("edited");
			const next = await send(b, conversation, "next");
			await until(async () => (await textOn(a, conversation, next.id)) === "next");
			expect(await textOn(a, conversation, message.id)).toBe("as written");
		},
		SLOW,
	);

	test(
		"a deletion the API answered for and never kept is its author's alone, and what follows goes",
		async () => {
			const { fake, a, b, conversation } = await dm();
			const message = await send(b, conversation, "still on Ana's");
			await until(async () => (await textOn(a, conversation, message.id)) === "still on Ana's");
			fake.forget({ method: "DELETE", path: `${messagesPath(conversation)}/${message.id}` });
			await b.engine.deleteMessage(conversation, message.id);
			expect(await b.engine.messages(conversation, [message.id])).toEqual([]);
			const next = await send(b, conversation, "next");
			await until(async () => (await textOn(a, conversation, next.id)) === "next");
			expect(await textOn(a, conversation, message.id)).toBe("still on Ana's");
		},
		SLOW,
	);

	test(
		"a history package, or its key in the inbox, the API answered for and never kept is offered to no one",
		async () => {
			const { fake, bo, a, b, conversation } = await dm();
			await send(a, conversation, "shared");
			const share = /^\/api\/users\/@me\/conversations\/[^/]+\/history-shares\/[^/]+\/complete$/;
			const inbox = /^\/api\/devices\/[^/]+\/inbox$/;
			for (const lost of [share, inbox]) {
				fake.forget({ method: "POST", path: lost });
				expect(await a.engine.shareHistory(conversation, bo, "all")).toMatchObject({ sent: true });
				await turnEnded(a);
				await turnEnded(b);
				expect(b.engine.offers(conversation)).toEqual([]);
			}
		},
		SLOW,
	);

	test(
		"a message the API answered for and never kept stays its sender's",
		async () => {
			const { fake, ana, a, conversation } = await dm();
			const { last_seq } = await a.api.queue(conversation, 0);
			const at = new Date().toISOString();
			const answered = {
				...{ id: crypto.randomUUID(), conversation_id: conversation, author_id: ana, content: null, type: 0 },
				...{ created_at: at, updated_at: at, seq: last_seq + 1, attachments: [] },
			};
			fake.refuse({ method: "POST", path: messagesPath(conversation) }, 201, answered);
			const nonce = crypto.randomUUID();
			const sent = await a.engine.sendMessage({ conversation_id: conversation, nonce, text: "never kept" });
			expect(sent?.id).toBe(answered.id);
			expect(await textOn(a, conversation, answered.id)).toBe("never kept");
			expect((await a.engine.pendingMessages(conversation)).map((one) => one.nonce)).toEqual([]);
		},
		SLOW,
	);
});

describe.skipIf(!coreLibrary)("a group the API doesn't hold is let go for the API's", () => {
	// #553 (the design in step 5's fixes, desktop batch 4's report; the core's forget_group, duvetchat/e2e#55): the API's
	// queue is the truth. A device whose group the API doesn't hold, as it lists none or holds another one at the
	// device's generation, lets its own go, its record kept exact, and takes the API's: made again where the API has none
	// and its person may make it, by the owner's welcome otherwise, or by an external commit into another member's. The
	// record holds whatever brings the group back to exactly its users and owner. What waited to be sent in the group let
	// go goes again under a new nonce, in the group the device ends in.
	const commits = (conversation: string) => ({
		method: "POST",
		path: `/api/users/@me/conversations/${conversation}/mls/commits`,
	});
	const LIST = { method: "GET", path: "/api/users/@me/conversations" };
	const isCommit = (request: Request, conversation: string) =>
		said(request) === `POST /api/users/@me/conversations/${conversation}/mls/commits`;

	/** The texts of the messages the device's core holds, bound to the API's: what it reads there. */
	async function textsOn(device: TestDevice, conversation: string): Promise<string[]> {
		const { messages } = await device.host.handle<{ messages: { message_id: string | null; text: string | null }[] }>({
			cmd: "messages",
			conversation_id: conversation,
			limit: 100,
		});
		return messages.flatMap(({ message_id, text }) => (message_id && text ? [text] : []));
	}

	/** Whom the fake was asked for key packages of, as each claim goes. */
	function claims(fake: FakeApi, seen?: (request: Request) => void) {
		const claimed: string[] = [];
		useFake(fake, (request) => {
			const claim = /^\/api\/users\/([^/]+)\/key-packages\/claim$/.exec(new URL(request.url).pathname);
			if (claim?.[1]) claimed.push(claim[1]);
			seen?.(request);
		});
		return claimed;
	}

	/**
	 * Ana's and Bo's DM, a device each, and Ana's founding of its group, which the API answers for and keeps nothing of
	 * (forget). With `stopBefore`, the list after its answer is refused, and her device stops before it lists again: it
	 * holds the group it founded, as its own.
	 */
	async function foundingForgotten(stopBefore = false) {
		const fake = new FakeApi();
		const [ana, bo] = [fake.addUser(), fake.addUser()];
		let refuseList = stopBefore;
		const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
		const claimed = claims(fake, (request) => {
			if (!refuseList || !isCommit(request, conversation)) return;
			refuseList = false;
			fake.refuse(LIST, 500);
		});
		const b = await firstDevice(fake, bo);
		const a = await firstDevice(fake, ana);
		fake.forget(commits(conversation));
		await a.engine.openConversation(conversation).catch(() => {});
		if (stopBefore) await a.engine.stop();
		return { fake, ana, bo, a, b, conversation, claimed };
	}

	// No group on the API: a group it held and lost (a database restored from before its founding). Ana's message, made
	// for it, never reached the API. Her next session makes the group again at generation 0, epoch 1, its numbers those
	// of the one let go: what waited there is stale all the same (the core's outbox), and goes under a new nonce.
	test(
		"a group the API no longer holds is made again, and what waited in it goes there under a new nonce",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			// Bo's device is away until the end: it hears nothing of the group the API loses.
			const b = await firstDevice(fake, bo);
			await b.engine.stop();
			let a = await firstDevice(fake, ana);
			await a.engine.openConversation(conversation);
			const lost = (await groupOf(a, conversation))!;
			fake.cutRequest({ method: "POST", path: messagesPath(conversation) });
			const nonce = crypto.randomUUID();
			await rejection(a.engine.sendMessage({ conversation_id: conversation, nonce, text: "cut" }));
			fake.loseGroup(conversation);
			a = await restarted(fake, a);
			const made = (await groupOf(a, conversation))!;
			expect(made).toMatchObject({ generation: 0, epoch: lost.epoch, blocked: false });
			expect(made.authenticator).not.toBe(lost.authenticator);
			// What waited goes with the start's resend, before the next message.
			await turnEnded(a);
			await send(a, conversation, "next");
			const back = await restarted(fake, b);
			await sameGroup([a, back], conversation);
			await until(async () => (await textsOn(back, conversation)).toSorted().join() === "cut,next", {
				what: "both of Ana's messages on Bo's device",
			});
			const { messages } = await a.host.handle<{ messages: { nonce?: string; text: string | null }[] }>({
				...{ cmd: "messages", conversation_id: conversation, limit: 100 },
			});
			const cut = messages.find((message) => message.text === "cut");
			expect(cut?.nonce).toBeTruthy();
			expect(cut?.nonce).not.toBe(nonce);
			expect(await a.engine.pendingMessages(conversation)).toEqual([]);
		},
		SLOW,
	);

	// Another member's group: Ana's device holds the group it founded, which the API never kept, and Bo then makes the
	// API's, its welcome to her device in the queue. The welcome is another_group: her device lets its own go and comes
	// in by an external commit, held to the record.
	test(
		"another member's group at the generation the device holds is taken by an external commit, its own let go",
		async () => {
			const { fake, ana, a, b, conversation } = await foundingForgotten(true);
			await a.host.open(ana);
			const own = (await groupOf(a, conversation))!;
			await b.engine.openConversation(conversation);
			const again = await restarted(fake, a);
			const held = await sameGroup([again, b], conversation);
			expect(held.authenticator).not.toBe(own.authenticator);
			expect(await madeAt(b, conversation, ana, ["commit"])).toEqual([{ kind: "commit", generation: 0, epoch: 1 }]);
			const hello = await send(again, conversation, "hello");
			await until(async () => (await textOn(b, conversation, hello.id)) === "hello", { what: "Ana's message on Bo's" });
			expect(again.engine.conversationState(conversation)).toBeNull();
		},
		SLOW,
	);

	// Its epoch's variant: Ana's own group moved past the API's epoch, by a renewal the API answered for with a 201 it
	// made up. A group info of an epoch below her own is stale_group_info while she holds her group: once she lets it go,
	// join_external takes the API's.
	test(
		"another member's group behind the epoch the device's own reached is taken all the same, its own let go",
		async () => {
			const { fake, ana, a, b, conversation } = await foundingForgotten(true);
			await a.host.open(ana);
			fake.refuse(commits(conversation), 201, { seq: 2, generation: 0, epoch: 2 });
			await commitByHand(a, conversation);
			expect((await groupOf(a, conversation))!.epoch).toBe(2);
			await b.engine.openConversation(conversation);
			expect((await groupOf(b, conversation))!.epoch).toBe(1);
			const again = await restarted(fake, a);
			await sameGroup([again, b], conversation);
			const hello = await send(again, conversation, "hello");
			await until(async () => (await textOn(b, conversation, hello.id)) === "hello", { what: "Ana's message on Bo's" });
		},
		SLOW,
	);

	// The welcome another_group answers is spent as the core applies it: the engine's note of it is all that brings the
	// device to let its own group go (#584, FG-M1). A forget that fails for the moment leaves the note for the turn's
	// retry, and a close before the forget leaves it in the record for the next start.
	test(
		"another member's group is taken by the turn's retry after a forget that failed for the moment",
		async () => {
			const { fake, a, b, conversation } = await foundingForgotten(true);
			await b.engine.openConversation(conversation);
			let fails = 1;
			const host = answeringHost(a.host, (command) =>
				command.cmd === "forget_group" && fails-- > 0 ? Promise.reject(new Error("the call was cut")) : undefined,
			);
			const again = await restarted(fake, a, { host });
			// The turn's retry, 2 s on.
			again.clock.advance(2_000);
			await sameGroup([again, b], conversation);
		},
		SLOW,
	);

	test(
		"another member's group is taken at the next start after the app closed before its forget",
		async () => {
			const { fake, ana, a, b, conversation } = await foundingForgotten(true);
			await a.host.open(ana);
			const own = (await groupOf(a, conversation))!;
			await b.engine.openConversation(conversation);
			// The welcome is applied, and the app goes before the forget: its core's worker with it.
			const host = answeringHost(a.host, (command) =>
				command.cmd === "forget_group" ? Promise.reject(new Error("the core's worker went")) : undefined,
			);
			const closed = await restarted(fake, a, { host });
			expect((await groupOf(closed, conversation))?.authenticator).toBe(own.authenticator);
			const again = await restarted(fake, closed, { host: a.host });
			const held = await sameGroup([again, b], conversation);
			expect(held.authenticator).not.toBe(own.authenticator);
		},
		SLOW,
	);

	// The note of another group is of the generation its welcome came for, and any forget lets it go (#584, FG-M7): a
	// group the device took since, or made again, is the device's to keep.
	test(
		"a restart's welcome taken in the same read as another group's is the group the device keeps",
		async () => {
			const { fake, ana, bo, a, b, conversation } = await foundingForgotten(true);
			await b.engine.openConversation(conversation);
			// Bo restarts the API's group by hand, his engine stopped: its next generation, a key package of Ana's in it.
			await b.engine.stop();
			await b.host.open(bo);
			const key_packages: Record<string, string[]> = {};
			for (const user of [ana, bo]) {
				key_packages[user] = (await b.api.claimKeyPackages(user)).key_packages.map((kp) => kp.data);
			}
			const made = await b.host.handle<{
				generation: number;
				commit: string;
				group_info: string;
				initial_group_info: string;
				welcome: string;
			}>({
				...{ cmd: "reset_group", conversation_id: conversation, members: [ana, bo], key_packages },
			});
			const { generation, commit, group_info, initial_group_info, welcome } = made;
			const taken = await b.api.commit(conversation, {
				generation,
				epoch: 0,
				commit,
				group_info,
				initial_group_info,
				welcome,
			});
			await b.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: true, seq: taken.seq });
			// Ana's next session reads Bo's founding's welcome, which is another_group, then the restart's, which it takes.
			const told: string[] = [];
			const again = await restarted(fake, a, { host: watchedHost(a.host, told) });
			const back = await restarted(fake, b);
			expect((await sameGroup([again, back], conversation)).generation).toBe(1);
			expect(told).not.toContain("forget_group");
			expect(await madeAt(back, conversation, ana, ["commit"])).toEqual([]);
		},
		SLOW,
	);

	test(
		"a group made again after another group's note, its own let go on another path, is the group the device keeps",
		async () => {
			const { fake, ana, a, b, conversation } = await foundingForgotten(true);
			await b.engine.openConversation(conversation);
			let fails = 1;
			const told: string[] = [];
			const host = watchedHost(
				answeringHost(a.host, (command) =>
					command.cmd === "forget_group" && fails-- > 0 ? Promise.reject(new Error("the call was cut")) : undefined,
				),
				told,
			);
			// Ana's next session takes Bo's welcome (another_group), and its forget fails: the note waits for the retry.
			const cut = await restarted(fake, a, { host });
			// The API loses its group first: her next start lets her own go, as a group the API doesn't hold, and makes the
			// DM's again, which the API holds from then on.
			fake.loseGroup(conversation);
			const again = await restarted(fake, cut, { host });
			await turnEnded(again);
			expect(told.filter((cmd) => cmd === "forget_group")).toHaveLength(2);
			expect(await madeAt(again, conversation, ana, ["commit"])).toEqual([{ kind: "commit", generation: 0, epoch: 0 }]);
		},
		SLOW,
	);

	// Who may not make the group: a member of a group the API lost lets it go and waits for its owner, and the owner's
	// founding made again brings their device in by its welcome, held to the record.
	test(
		"a member of a group the API no longer holds lets it go and waits, and the owner's founding brings it in",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			let a = await firstDevice(fake, ana);
			let b = await firstDevice(fake, bo);
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			const lost = await sameGroup([a, b], conversation);
			await a.engine.stop();
			fake.loseGroup(conversation);
			b = await restarted(fake, b);
			expect(await groupOf(b, conversation)).toBeNull();
			expect(b.engine.conversationState(conversation)).toEqual({ name: "wait_owner", owner: ana });
			a = await restarted(fake, a);
			const made = await sameGroup([a, b], conversation);
			expect(made.authenticator).not.toBe(lost.authenticator);
			// Bo's device came in by the owner's welcome: no commit of his own is in the queue.
			expect(await madeAt(a, conversation, bo, ["commit"])).toEqual([]);
			await until(() => b.engine.conversationState(conversation) === null, { what: "Bo's notice gone" });
		},
		SLOW,
	);

	// The record holds the users: a DM listed with someone else once its group is let go founds nothing with them, and
	// asks the person first, as the founding of a group with members other than its record's does.
	test(
		"a DM the API lists with someone else once its group is let go founds nothing with them, and says so",
		async () => {
			const { fake, ana, bo, a, conversation, claimed } = await foundingForgotten();
			const eve = fake.addUser();
			await firstDevice(fake, eve);
			fake.befriend(ana, eve);
			fake.conversationsAs = (view, viewer) =>
				viewer === ana && view.id === conversation
					? { ...view, members: view.members.map((m) => (m.user_id === bo ? { ...m, user_id: eve } : m)) }
					: view;
			const before = claimed.length;
			expect(await rejection(send(a, conversation, "for Bo"))).toMatchObject({ code: "blocked" });
			expect(a.engine.conversationState(conversation)).toMatchObject({ name: "members_changed" });
			expect(await groupOf(a, conversation)).toBeNull();
			expect(claimed.slice(before)).toEqual([]);
		},
		SLOW,
	);

	// The record holds the users at the epoch it was let go: a group info of an epoch before a member's removal, which
	// that member can read, is refused to a device that let its group go.
	test(
		"an old epoch's group info served to a device that let its group go is refused for the member removed since",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			const a = await firstDevice(fake, ana);
			let b = await firstDevice(fake, bo);
			const c = await firstDevice(fake, cy);
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b, c], conversation);
			const withCy = await b.api.groupInfo(conversation);
			await a.engine.removeMember(conversation, cy);
			await sameGroup([a, b], conversation);
			// Bo's next session is told the group is none: his device lets it go.
			let lying = true;
			fake.conversationsAs = (view, viewer) =>
				lying && viewer === bo && view.id === conversation ? { ...view, mls: null } : view;
			b = await restarted(fake, b);
			expect(await groupOf(b, conversation)).toBeNull();
			// Then the group again, with the group info of the epoch that held Cy.
			lying = false;
			const groupInfo = { method: "GET", path: `/api/users/@me/conversations/${conversation}/mls/group-info` };
			fake.refuse(groupInfo, 200, withCy, {}, Infinity);
			await b.engine.openConversation(conversation);
			await until(() => b.engine.conversationState(conversation)?.name === "members_changed", {
				what: "Bo's device refusing the epoch that held Cy",
			});
			expect(await groupOf(b, conversation)).toBeNull();
		},
		SLOW,
	);

	// The core forgets a blocked group like any other, and its block with it. The listing that adds Eve founds nothing
	// with her; once it doesn't, the group made again holds the record's users alone, unblocked.
	test(
		"a blocked group the API no longer holds is let go, block and all, and the one made again holds its record's users",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, eve] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const claimed = claims(fake);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			let a = await firstDevice(fake, ana);
			let b = await firstDevice(fake, bo);
			await firstDevice(fake, eve);
			fake.befriend(ana, eve);
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			const made = await sameGroup([a, b], conversation);
			// A commit no device can process, as groups.test.ts' blockedGroup makes one: Ana's renewal, one byte of its
			// signature changed, sent under Bo's session.
			await a.engine.stop();
			await a.host.open(ana);
			const refresh = await a.host.handle<{ commit: string; group_info: string }>({
				...{ cmd: "refresh", conversation_id: conversation },
			});
			const bytes = base64Bytes(refresh.commit);
			bytes[bytes.length - 1]! ^= 0xff;
			const { generation, epoch } = made;
			await b.api.commit(conversation, {
				generation,
				epoch,
				commit: bytesBase64(bytes),
				group_info: refresh.group_info,
			});
			await a.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: false, invalid: true });
			a = await restarted(fake, a);
			await until(async () => (await groupOf(a, conversation))?.blocked === true, { what: "Ana's group blocked" });
			fake.loseGroup(conversation);
			fake.addMembers(conversation, [eve]);
			a = await restarted(fake, a);
			expect(await groupOf(a, conversation)).toBeNull();
			expect(a.engine.conversationState(conversation)).toMatchObject({ name: "members_changed" });
			expect(claimed).not.toContain(eve);
			fake.dropMembers(conversation, [eve]);
			b = await restarted(fake, b);
			await a.engine.openConversation(conversation);
			const again = await sameGroup([a, b], conversation);
			expect(again.blocked).toBe(false);
			expect(again.members.map((member) => member.user_id).sort()).toEqual([ana, bo].sort());
		},
		SLOW,
	);

	// The record is exact (the core's `exact`), and a client that dropped it would hold the group made again to the
	// looser rule of a record from before the cutover: kept as the core gave it, across a restart.
	test(
		"the record of a group let go outlives a restart, exact, and the group made again is held to it",
		async () => {
			const { fake, ana, bo, a, b, conversation } = await foundingForgotten();
			expect(await groupOf(a, conversation)).toBeNull();
			const kept = a.store.read<Record<string, { members: string[]; exact?: boolean }>>(LEGACY_RECORDS);
			expect(kept?.[conversation]?.exact).toBe(true);
			expect(kept?.[conversation]?.members.toSorted()).toEqual([ana, bo].toSorted());
			const expected: unknown[] = [];
			const host = answeringHost(a.host, (command) => {
				if (command.cmd === "create_group") expected.push(command.expected);
				return undefined;
			});
			const again = await restarted(fake, a, { host });
			// Her next open makes it again, held to the record as the store kept it.
			await again.engine.openConversation(conversation);
			await b.engine.openConversation(conversation);
			await sameGroup([again, b], conversation);
			expect(expected).toEqual([kept?.[conversation]]);
			// Held again, the record goes.
			expect(again.store.read(LEGACY_RECORDS)).toBeNull();
		},
		SLOW,
	);

	// A row without its group (an external commit the API refused): the device can't let it go nor found one, and waits
	// for the API's group to pass the epoch it saw. Here the API then loses its group, and Bo founds it again, behind
	// that epoch until his next commit. What waited to be sent stays, and goes once Ana's device is back in.
	test(
		"a row without its group waits for the API's group to pass its epoch, and what waited goes then",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const claimed = claims(fake);
			let b = await firstDevice(fake, bo);
			let a = await firstDevice(fake, ana);
			await b.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			fake.cutRequest({ method: "POST", path: messagesPath(conversation) });
			await rejection(
				a.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: "typed" }),
			);
			// Bo's renewal takes the group to epoch 2; then an external commit of Ana's there, which the API refused.
			await b.engine.stop();
			await b.host.open(bo);
			await commitByHand(b, conversation);
			await until(async () => (await groupOf(a, conversation))?.epoch === 2, { what: "Ana's device at epoch 2" });
			await a.engine.stop();
			await a.host.open(ana);
			const { group_info } = await a.api.groupInfo(conversation);
			await a.host.handle({ cmd: "join_external", conversation_id: conversation, generation: 0, group_info });
			await a.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: false, invalid: true });
			fake.loseGroup(conversation);
			const told: string[] = [];
			const before = claimed.length;
			a = await restarted(fake, a, { host: watchedHost(a.host, told) });
			await a.engine.openConversation(conversation);
			await turnEnded(a);
			expect(a.engine.conversationState(conversation)).toEqual({ name: "wait_rejoin" });
			expect(told).not.toContain("create_group");
			expect(claimed.slice(before)).toEqual([]);
			expect((await a.engine.pendingMessages(conversation)).map((message) => message.text)).toEqual(["typed"]);
			// Bo founds the group again, at epoch 1: Ana's device still waits.
			b = await restarted(fake, b);
			await b.engine.openConversation(conversation);
			await turnEnded(a);
			expect(await groupOf(a, conversation)).toBeNull();
			expect(a.engine.conversationState(conversation)).toEqual({ name: "wait_rejoin" });
			// His next commit takes it to epoch 2, which Ana's device saw: it comes in, and what waited goes.
			await b.engine.stop();
			await b.host.open(bo);
			await commitByHand(b, conversation);
			b = await restarted(fake, b);
			await sameGroup([a, b], conversation);
			await send(a, conversation, "next");
			await until(async () => (await textsOn(b, conversation)).toSorted().join() === "next,typed", {
				what: "both of Ana's messages on Bo's device",
			});
		},
		SLOW,
	);

	// duplicate_device (duvetchat/e2e#57): a join the core refuses for a second leaf under one device ID is a rule's
	// refusal like any other: the members observed, one more try, and the device waits for another member's commit.
	test(
		"a join refused for a second leaf under one device ID waits for another member's commit, as any rule's",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const b = await firstDevice(fake, bo);
			// Bo founds the group before Ana has a device: hers comes in by an external commit.
			await b.engine.openConversation(conversation);
			let joins = 0;
			const host = answeringHost(testHost(), (command) => {
				if (command.cmd !== "join_external") return undefined;
				joins++;
				return Promise.reject(
					new CoreError("rule_violation", "two leaves of one device", { rule: "duplicate_device" }),
				);
			});
			const a = await firstDevice(fake, ana, { host });
			await turnEnded(a);
			expect(a.engine.conversationState(conversation)).toEqual({ name: "wait_rejoin" });
			// Each try is one more after the members are observed.
			expect(joins).toBeGreaterThanOrEqual(2);
			expect(joins % 2).toBe(0);
			expect(await groupOf(a, conversation)).toBeNull();
			expect(fake.decryptFailures).toEqual([]);
		},
		SLOW,
	);
});
