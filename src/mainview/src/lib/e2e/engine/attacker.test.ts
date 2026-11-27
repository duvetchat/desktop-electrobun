import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { base64Bytes } from "$lib/activity-thumbnail";
import type { Conversation, DirectMessage } from "$lib/api/conversations";
import type { Identity } from "$lib/api/e2e";
import { bytesBase64 } from "$lib/staged-images";
import { MAX_FILE_NAME } from "../conventions";
import { FakeApi, type GatewayEvent } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	approvedDevice,
	filesOn,
	firstDevice,
	groupOf,
	madeHere,
	rejection,
	resetFrom,
	restarted,
	sameGroup,
	sendWritten,
	shownKey,
	testDevice,
	turnEnded,
	until,
	useFake,
	type TestDevice,
} from "../testing/engines";
import { useXHR } from "../testing/xhr";

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
				expect(a.engine.conversationState(id)).toEqual({ name: "members_changed" });
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
			expect(a.engine.conversationState(conversation)).toEqual({ name: "members_changed" });
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

	// Nothing more goes there: an edit and a deletion wait too, as a message does, while the group holds someone the
	// conversation as drawn doesn't show.
	test(
		"an edit and a deletion wait while the group holds someone its page doesn't draw",
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
			await b.engine.editMessage(id, first.id, "edited");
			await b.engine.deleteMessage(id, second.id);
			await turnEnded(b);
			expect(changes).toEqual([]);
			expect(b.engine.conversationState(id)).toMatchObject({ name: "other_members" });
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
	// desktop-electrobun#553, skipped until the core can let go of a group (the design is in step 5's fixes, desktop
	// batch 4's report). The API's queue is the truth: a device whose group the API doesn't hold leaves its own and
	// takes the API's, made again where the API has none, and what its person typed goes in the group it ends in. The
	// core holds on to its own: create_group answers exists, commit_result {accepted: false} not_found (nothing waits),
	// and reset_group founds generation 1, which an API without a group refuses (409, no group yet). Nor does it take
	// another member's group at the generation it holds: the queue's welcome is ignored there, its key package spent,
	// and join_external takes the API's group only from the epoch its own reached (stale_group_info below it).
	test.skip(
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
